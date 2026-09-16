import { supabase } from "./supabaseClient";

/*
  بنستخدم Supabase Auth الحقيقي (bcrypt على السيرفر + جلسات JWT حقيقية) بدل أي نظام
  باسورد مُعمل يدويًا. يوزر نيم بسيط زي "ahmed" بيتحول داخليًا لإيميل وهمي ثابت
  (ahmed@calma.internal) عشان يستخدم نظام Supabase العادي من غير ما المستخدم يحس.
*/

const EMAIL_DOMAIN = "calma.internal";
const usernameToEmail = (u) => `${u.trim().toLowerCase()}@${EMAIL_DOMAIN}`;

export async function checkSetupNeeded() {
  const { data, error } = await supabase.rpc("profiles_exist");
  if (error) return true;
  return data === false;
}

export async function signUpUser({ username, password, name, role }) {
  const email = usernameToEmail(username);
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) return { error: mapAuthError(error) };
  const userId = data.user?.id;
  if (!userId) return { error: "تعذر إنشاء الحساب، حاول تاني" };

  const { error: profileError } = await supabase
    .from("profiles")
    .insert({ id: userId, username: username.trim().toLowerCase(), name, role, active: true });

  if (profileError) return { error: profileError.message || "الاسم ده مستخدم بالفعل أو حصل خطأ" };
  return { data: { id: userId, username: username.trim().toLowerCase(), name, role, active: true } };
}

export async function signIn({ username, password }) {
  const email = usernameToEmail(username);
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: mapAuthError(error) };
  return { data };
}

export async function signOut() {
  await supabase.auth.signOut();
}

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session || null;
}

export function onAuthStateChange(callback) {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => callback(session));
  return () => data.subscription.unsubscribe();
}

export async function getMyProfile() {
  const { data: userData } = await supabase.auth.getUser();
  const uid = userData?.user?.id;
  if (!uid) return null;
  const { data, error } = await supabase.from("profiles").select("*").eq("id", uid).maybeSingle();
  if (error || !data) return null;
  return data;
}

export async function listProfiles() {
  const { data, error } = await supabase.from("profiles").select("*").order("created_at", { ascending: true });
  if (error) return [];
  return data || [];
}

export async function setProfileActive(profileId, active) {
  const { error } = await supabase.from("profiles").update({ active }).eq("id", profileId);
  return { error: error?.message };
}

export async function changeOwnPassword(newPassword) {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  return { error: mapAuthError(error) };
}

export async function adminResetPassword(targetUsername, newPassword) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) return { error: "لازم تكون مسجّل دخول" };
  const { data, error } = await supabase.functions.invoke("reset-password", {
    body: { username: targetUsername, newPassword },
    headers: { Authorization: `Bearer ${token}` },
  });
  if (error) return { error: error.message || "تعذر تغيير كلمة المرور" };
  if (data?.error) return { error: data.error };
  return { data };
}

/*
  مهم: دي الدالة اللي المفروض تُستخدم لإضافة موظف جديد من "إدارة المستخدمين"
  (مش signUpUser). سبب وجودها: supabase.auth.signUp() لما بيتنفذ من متصفح
  المدير العام نفسه بيستبدل جلسة دخوله بجلسة المستخدم الجديد فورًا، وده كان
  بيسبب حسابات دخول من غير profile (المشكلة اللي حصلت مع "seif"). الدالة دي
  بتنادي Edge Function بتشتغل بمفتاح service_role على السيرفر، فجلسة
  المتصفح متتأثرش خالص.
*/
export async function adminCreateUser({ username, password, name, role }) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) return { error: "لازم تكون مسجّل دخول" };
  const { data, error } = await supabase.functions.invoke("create-user", {
    body: { username, password, name, role },
    headers: { Authorization: `Bearer ${token}` },
  });
  if (error) return { error: error.message || "تعذر إنشاء الحساب" };
  if (data?.error) return { error: data.error };
  return { data: data?.data };
}

function mapAuthError(error) {
  if (!error) return null;
  const msg = (error.message || "").toLowerCase();
  if (msg.includes("invalid login credentials")) return "بيانات الدخول غير صحيحة";
  if (msg.includes("already registered") || msg.includes("already exists")) return "اسم المستخدم ده موجود بالفعل";
  if (msg.includes("password") && msg.includes("6")) return "كلمة المرور لازم تكون ٦ حروف على الأقل";
  if (msg.includes("email not confirmed")) return "لازم توقف خاصية Confirm Email من إعدادات Supabase Auth (README)";
  return error.message || "حصل خطأ غير متوقع";
}
