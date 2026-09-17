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

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const EMAIL_DOMAIN = "calma.internal";
const VALID_ROLES = ["staff", "reservations", "accounts", "gm"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace("Bearer ", "");
    if (!jwt) return json({ error: "لازم تكون مسجّل دخول" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    // تحقّق إن اللي طالب العملية مدير عام فعّال - بنفس أسلوب reset-password
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: callerData, error: callerErr } = await callerClient.auth.getUser();
    if (callerErr || !callerData?.user) return json({ error: "جلسة غير صالحة" }, 401);

    const { data: callerProfile, error: profileErr } = await callerClient
      .from("profiles")
      .select("role, active")
      .eq("id", callerData.user.id)
      .maybeSingle();
    if (profileErr || !callerProfile || callerProfile.role !== "gm" || !callerProfile.active) {
      return json({ error: "الصلاحية دي للمدير العام بس" }, 403);
    }

    const { username, password, name, role } = await req.json();
    const cleanUsername = String(username || "").trim().toLowerCase();
    const cleanName = String(name || "").trim();

    if (!cleanUsername || !password || String(password).length < 6) {
      return json({ error: "بيانات ناقصة أو كلمة المرور أقل من ٦ حروف" }, 400);
    }
    if (!cleanName) return json({ error: "الاسم مطلوب" }, 400);
    if (!VALID_ROLES.includes(role)) return json({ error: "دور غير معروف" }, 400);

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
        return json({ error: "اسم المستخدم ده موجود بالفعل" }, 409);
      }
      return json({ error: createErr.message }, 500);
    }

    const userId = created.user?.id;
    if (!userId) return json({ error: "تعذر إنشاء الحساب، حاول تاني" }, 500);

    // 2) إنشاء صف الـ profile - service_role هنا مش محتاج RLS، بس تحققنا
    //    من صلاحية المدير العام فوق قبل ما نوصل للسطر ده أصلاً
    const { error: insertErr } = await adminClient
      .from("profiles")
      .insert({ id: userId, username: cleanUsername, name: cleanName, role, active: true });

    if (insertErr) {
      // نظافة: لو فشل حفظ الـ profile، امسحي حساب الدخول اليتيم بدل ما يفضل معلّق
      await adminClient.auth.admin.deleteUser(userId);
      return json({ error: insertErr.message || "تعذر حفظ بيانات المستخدم" }, 500);
    }

    return json({ success: true, data: { id: userId, username: cleanUsername, name: cleanName, role, active: true } });
  } catch (e) {
    return json({ error: String(e?.message || e) }, 500);
  }
});

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
