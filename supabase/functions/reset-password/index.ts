// Supabase Edge Function: reset-password
// بتشتغل على سيرفرات Supabase مش في متصفح المستخدم، عشان كده هي المكان الوحيد
// المسموح فيه استخدام مفتاح service_role (اللي بيقدر يغيّر باسورد أي حساب).
//
// بتتأكد أول حاجة إن اللي طالب العملية عنده جلسة دخول صحيحة وإن دوره "gm"
// قبل ما تنفذ أي حاجة.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { buildCorsHeaders, isRateLimited, validatePasswordStrength, safeServerError, bearerToken, readJsonBody } from "../_shared/security.ts";

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
    if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: safeServerError("reset-password:env", "missing Supabase env vars") }, 500, corsHeaders);

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: callerData, error: callerErr } = await callerClient.auth.getUser();
    if (callerErr || !callerData?.user) return json({ error: "جلسة غير صالحة" }, 401, corsHeaders);

    if (isRateLimited(`reset-password:${callerData.user.id}`)) {
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
    const username = String(payload.username || "").trim().toLowerCase();
    const newPassword = payload.newPassword;
    if (!/^[a-z0-9_]{3,30}$/.test(username)) return json({ error: "بيانات ناقصة" }, 400, corsHeaders);
    if (typeof newPassword !== "string" || newPassword.length > 128) return json({ error: "كلمة المرور غير صالحة" }, 400, corsHeaders);

    const pwCheck = validatePasswordStrength(newPassword);
    if (!pwCheck.ok) return json({ error: pwCheck.message }, 400, corsHeaders);

    const adminClient = createClient(supabaseUrl, serviceKey);

    const { data: targetProfile, error: targetErr } = await adminClient
      .from("profiles")
      .select("id")
      .eq("username", username)
      .maybeSingle();
    if (targetErr || !targetProfile) return json({ error: "المستخدم مش موجود" }, 404, corsHeaders);

    const { error: updateErr } = await adminClient.auth.admin.updateUserById(targetProfile.id, {
      password: newPassword,
    });
    if (updateErr) return json({ error: safeServerError("reset-password:updateUser", updateErr) }, 500, corsHeaders);

    return json({ success: true }, 200, corsHeaders);
  } catch (e) {
    return json({ error: safeServerError("reset-password:unhandled", e) }, 500, corsHeaders);
  }
});

function json(body: unknown, status: number, corsHeaders: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
