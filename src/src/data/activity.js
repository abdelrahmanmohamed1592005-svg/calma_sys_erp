import { supabase } from "../lib/supabaseClient";

function activityFromRow(r) {
  return { id: r.id, ts: new Date(r.ts).getTime(), user: r.user_name, username: r.username, role: r.role, action: r.action };
}

export async function getActivity(limit = 300) {
  const { data, error } = await supabase.from("activity_log").select("*").order("ts", { ascending: false }).limit(limit);
  if (error || !data) return [];
  return data.map(activityFromRow);
}

export async function addActivity({ userName, username, role, action }) {
  const { error } = await supabase.from("activity_log").insert({ user_name: userName, username, role, action });
  return { error: error?.message };
}
