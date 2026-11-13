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
import { buildCorsHeaders, isRateLimited, validatePasswordStrength, safeServerError, bearerToken, readJsonBody } from "../_shared/security.ts";

const EMAIL_DOMAIN = "calma.internal";
const VALID_ROLES = ["staff", "reservations", "accounts", "gm"];

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "الطريقة غير مسموحة" }, 405, corsHeaders);

  try {
    const jwt = bearerToken(req);
    if (!jwt) return json({ error: "لازم تكون مسجّل دخول" }, 401, corsHeaders);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: safeServerError("create-user:env", "missing Supabase env vars") }, 500, corsHeaders);

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

    let payload: Record<string, unknown>;
    try { payload = await readJsonBody(req); } catch (_) { return json({ error: "طلب غير صالح" }, 400, corsHeaders); }
    const { username, password, name, role } = payload as { username?: string; password?: string; name?: string; role?: string };
    const cleanUsername = String(username || "").trim().toLowerCase();
    const cleanName = String(name || "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 80);

    if (!cleanUsername || !/^[a-z0-9_]{3,30}$/.test(cleanUsername)) {
      return json({ error: "اسم المستخدم غير صالح (٣-٣٠ حرف، إنجليزي/أرقام/_ بس)" }, 400, corsHeaders);
    }
    if (!cleanName) return json({ error: "الاسم مطلوب" }, 400, corsHeaders);
    if (typeof role !== "string" || !VALID_ROLES.includes(role)) return json({ error: "دور غير معروف" }, 400, corsHeaders);

    if (typeof password !== "string" || password.length > 128) return json({ error: "كلمة المرور غير صالحة" }, 400, corsHeaders);
    const pwCheck = validatePasswordStrength(password);
    if (!pwCheck.ok) return json({ error: pwCheck.message }, 400, corsHeaders);

    const adminClient = createClient(supabaseUrl, serviceKey);
    const email = `${cleanUsername}@${EMAIL_DOMAIN}`;
    const ok = (id: string, reused: boolean) =>
      json({ success: true, reused, data: { id, username: cleanUsername, name: cleanName, role, active: true } }, 200, corsHeaders);
    const weakPassword = (e: { code?: string; message?: string }) => {
      const m = (e.message || "").toLowerCase();
      return e.code === "weak_password" || m.includes("weak password") || m.includes("password should");
    };
    const WEAK_MSG = "كلمة المرور ضعيفة حسب إعدادات الأمان - اختار كلمة أقوى (حروف كبيرة وصغيرة وأرقام ورمز)";

    // 0) الاسم متسجّل في جدول الموظفين قبل كده؟
    //    - موظف شغّال بنفس الاسم: ده تكرار حقيقي، مانكتبش فوق حساب حد شغّال.
    //    - موظف قديم متعطّل: بنرجّع نفس الحساب بالاسم/الدور/كلمة المرور الجداد (سجله القديم بيفضل مربوط بيه).
    const { data: existing, error: existingErr } = await adminClient
      .from("profiles").select("id, name, active").eq("username", cleanUsername).maybeSingle();
    if (existingErr) return json({ error: safeServerError("create-user:lookupProfile", existingErr) }, 500, corsHeaders);
    if (existing) {
      if (existing.active) {
        return json({ error: `اسم المستخدم ده شغّال حاليًا للموظف "${existing.name}" - اختار اسم مستخدم تاني، أو عطّله الأول لو عايز تستبدله` }, 409, corsHeaders);
      }
      const { error: authErr } = await adminClient.auth.admin.updateUserById(existing.id, { email, password, email_confirm: true });
      if (authErr) {
        if (weakPassword(authErr)) return json({ error: WEAK_MSG }, 400, corsHeaders);
        return json({ error: safeServerError("create-user:reuseAuth", authErr) }, 500, corsHeaders);
      }
      const { error: upErr } = await adminClient.from("profiles").update({ name: cleanName, role, active: true }).eq("id", existing.id);
      if (upErr) return json({ error: safeServerError("create-user:reuseProfile", upErr) }, 500, corsHeaders);
      return ok(existing.id, true);
    }

    // 1) إنشاء حساب الدخول - email_confirm:true عشان يقدر يدخل على طول
    let userId = "";
    let createdNow = false;
    const { data: created, error: createErr } = await adminClient.auth.admin.createUser({ email, password, email_confirm: true });
    if (createErr) {
      if (weakPassword(createErr)) return json({ error: WEAK_MSG }, 400, corsHeaders);
      // حساب دخول قديم بنفس الاسم من غير ملف موظف (محاولة قديمة ماكملتش، أو موظف اتمسح ملفه): بنستخدمه بدل ما نرفض
      const orphan = await findAuthUserByEmail(adminClient, email);
      if (!orphan) return json({ error: safeServerError("create-user:createUser", createErr) }, 500, corsHeaders);
      const { data: owner } = await adminClient.from("profiles").select("username, name").eq("id", orphan).maybeSingle();
      if (owner) {
        return json({ error: `حساب الدخول ده مربوط بالموظف "${owner.name}" (@${owner.username}) - اختار اسم مستخدم تاني` }, 409, corsHeaders);
      }
      const { error: authErr } = await adminClient.auth.admin.updateUserById(orphan, { password, email_confirm: true });
      if (authErr) {
        if (weakPassword(authErr)) return json({ error: WEAK_MSG }, 400, corsHeaders);
        return json({ error: safeServerError("create-user:adoptAuth", authErr) }, 500, corsHeaders);
      }
      userId = orphan;
    } else {
      userId = created.user?.id || "";
      createdNow = true;
    }
    if (!userId) return json({ error: safeServerError("create-user:noUserId", "createUser returned no id") }, 500, corsHeaders);

    // 2) إنشاء صف الـ profile - service_role هنا مش محتاج RLS، بس تحققنا
    //    من صلاحية المدير العام فوق قبل ما نوصل للسطر ده أصلاً
    const { error: insertErr } = await adminClient
      .from("profiles")
      .insert({ id: userId, username: cleanUsername, name: cleanName, role, active: true });

    if (insertErr) {
      // نظافة: حساب دخول اتعمل دلوقتي ومالوش profile مايفضلش معلّق (الحساب القديم اللي استخدمناه مابنمسحوش)
      if (createdNow) await adminClient.auth.admin.deleteUser(userId);
      // اتنين ضافوا نفس الاسم في نفس اللحظة
      if ((insertErr as { code?: string }).code === "23505") {
        return json({ error: "اسم المستخدم ده اتسجّل حالًا من جهاز تاني - حدّث الصفحة وراجع قايمة الموظفين" }, 409, corsHeaders);
      }
      return json({ error: safeServerError("create-user:insertProfile", insertErr) }, 500, corsHeaders);
    }

    return ok(userId, !createdNow);
  } catch (e) {
    return json({ error: safeServerError("create-user:unhandled", e) }, 500, corsHeaders);
  }
});

// بيدوّر على حساب دخول بالإيميل الداخلي (مفيش بحث مباشر بالإيميل في الـ admin API) - عدد الحسابات صغير
// deno-lint-ignore no-explicit-any
async function findAuthUserByEmail(adminClient: any, email: string): Promise<string | null> {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage: 200 });
    if (error || !data?.users?.length) return null;
    const hit = data.users.find((u: { id: string; email?: string }) => (u.email || "").toLowerCase() === email);
    if (hit) return hit.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

function json(body: unknown, status: number, corsHeaders: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
