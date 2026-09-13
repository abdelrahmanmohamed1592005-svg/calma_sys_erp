// Supabase Edge Function: reset-password
// بتشتغل على سيرفرات Supabase مش في متصفح المستخدم، عشان كده هي المكان الوحيد
// المسموح فيه استخدام مفتاح service_role (اللي بيقدر يغيّر باسورد أي حساب).
//
// بتتأكد أول حاجة إن اللي طالب العملية عنده جلسة دخول صحيحة وإن دوره "gm"
// قبل ما تنفذ أي حاجة.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace("Bearer ", "");
    if (!jwt) return json({ error: "لازم تكون مسجّل دخول" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

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

    const { username, newPassword } = await req.json();
    if (!username || !newPassword || String(newPassword).length < 6) {
      return json({ error: "بيانات ناقصة أو كلمة المرور أقل من ٦ حروف" }, 400);
    }

    const adminClient = createClient(supabaseUrl, serviceKey);

    const { data: targetProfile, error: targetErr } = await adminClient
      .from("profiles")
      .select("id")
      .eq("username", String(username).toLowerCase())
      .maybeSingle();
    if (targetErr || !targetProfile) return json({ error: "المستخدم مش موجود" }, 404);

    const { error: updateErr } = await adminClient.auth.admin.updateUserById(targetProfile.id, {
      password: newPassword,
    });
    if (updateErr) return json({ error: updateErr.message }, 500);

    return json({ success: true });
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
