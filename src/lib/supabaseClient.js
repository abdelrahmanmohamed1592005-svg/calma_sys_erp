import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !key) {
  // eslint-disable-next-line no-console
  console.warn(
    "[Calma] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY مش متظبطين. " +
      "انسخ .env.example إلى .env وحط بيانات مشروع Supabase بتاعك."
  );
}

export const supabase = createClient(url || "https://placeholder.supabase.co", key || "placeholder-anon-key");
export const supabaseConfigured = Boolean(url && key);
