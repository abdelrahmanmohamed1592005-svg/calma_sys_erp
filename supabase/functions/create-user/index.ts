// Supabase Edge Function: create-user
// بتشتغل على سيرفرات Supabase مش في متصفح المستخدم، لنفس السبب بالظبط اللي
// خلّى reset-password Edge Function - استخدام service_role لازم يبقى سيرفر-سايد.
//
// السبب الحقيقي لعمل الفنكشن دي: لو عملنا supabase.auth.signUp() من متصفح
// المدير العام نفسه (زي ما كان بيحصل قبل كده)، Supabase بيستبدل جلسة تسجيل
// الدخول الحالية بجلسة المستخدم الجديد فورًا - فالمدير العام بيفقد جلسته
// والـ insert بعد كده بيتنفذ بهوية المستخدم الجديد (اللي لسه مالوش صلاحيات)
// فالـ RLS بيرفضه، وينتج حساب دخول من غير profile (بالظبط المشكلة اللي حصلت).
//
// الحل: إنشاء المستخدم بالكامل (auth + profile) من السيرفر باستخدام
// service_role، من غير ما يلمس جلسة المتصفح خالص.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { buildCorsHeaders, isRateLimited, validatePasswordStrength, safeServerError } from "../_shared/security.ts";

const EMAIL_DOMAIN = "calma.internal";
const VALID_ROLES = ["staff", "reservations", "accounts", "gm"];

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace("Bearer ", "");
    if (!jwt) return json({ error: "لازم تكون مسجّل دخول" }, 401, corsHeaders);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    // تحقّق إن اللي طالب العملية مدير عام فعّال - بنفس أسلوب reset-password
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: callerData, error: callerErr } = await callerClient.auth.getUser();
    if (callerErr || !callerData?.user) return json({ error: "جلسة غير صالحة" }, 401, corsHeaders);

    // Rate limiting بأفضل جهد ممكن - مربوط بهوية المدير العام الطالب نفسه
    if (isRateLimited(`create-user:${callerData.user.id}`)) {
      return json({ error: "طلبات كتير قوي في وقت قصير، استنى شوية وجرّب تاني" }, 429, corsHeaders);
    }

    const { data: callerProfile, error: profileErr } = await callerClient
      .from("profiles")
      .select("role, active")
      .eq("id", callerData.user.id)
      .maybeSingle();
    if (profileErr || !callerProfile || callerProfile.role !== "gm" || !callerProfile.active) {
      return json({ error: "الصلاحية دي للمدير العام بس" }, 403, corsHeaders);
    }

    const { username, password, name, role } = await req.json();
    const cleanUsername = String(username || "").trim().toLowerCase();
    const cleanName = String(name || "").trim().slice(0, 80);

    if (!cleanUsername || !/^[a-z0-9_]{3,30}$/.test(cleanUsername)) {
      return json({ error: "اسم المستخدم غير صالح (٣-٣٠ حرف، إنجليزي/أرقام/_ بس)" }, 400, corsHeaders);
    }
    if (!cleanName) return json({ error: "الاسم مطلوب" }, 400, corsHeaders);
    if (!VALID_ROLES.includes(role)) return json({ error: "دور غير معروف" }, 400, corsHeaders);

    const pwCheck = validatePasswordStrength(password);
    if (!pwCheck.ok) return json({ error: pwCheck.message }, 400, corsHeaders);

    const adminClient = createClient(supabaseUrl, serviceKey);

    // 1) إنشاء حساب الدخول - email_confirm:true عشان يقدر يدخل على طول
    const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
      email: `${cleanUsername}@${EMAIL_DOMAIN}`,
      password,
      email_confirm: true,
    });
    if (createErr) {
      const msg = (createErr.message || "").toLowerCase();
      if (msg.includes("already registered") || msg.includes("already exists")) {
        return json({ error: "اسم المستخدم ده موجود بالفعل" }, 409, corsHeaders);
      }
      return json({ error: safeServerError("create-user:createUser", createErr) }, 500, corsHeaders);
    }

    const userId = created.user?.id;
    if (!userId) return json({ error: "تعذر إنشاء الحساب، حاول تاني" }, 500, corsHeaders);

    // 2) إنشاء صف الـ profile - service_role هنا مش محتاج RLS، بس تحققنا
    //    من صلاحية المدير العام فوق قبل ما نوصل للسطر ده أصلاً
    const { error: insertErr } = await adminClient
      .from("profiles")
      .insert({ id: userId, username: cleanUsername, name: cleanName, role, active: true });

    if (insertErr) {
      // نظافة: لو فشل حفظ الـ profile، امسحي حساب الدخول اليتيم بدل ما يفضل معلّق
      await adminClient.auth.admin.deleteUser(userId);
      return json({ error: safeServerError("create-user:insertProfile", insertErr) }, 500, corsHeaders);
    }

    return json({ success: true, data: { id: userId, username: cleanUsername, name: cleanName, role, active: true } }, 200, corsHeaders);
  } catch (e) {
    return json({ error: safeServerError("create-user:unhandled", e) }, 500, corsHeaders);
  }
});

function json(body: unknown, status: number, corsHeaders: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
