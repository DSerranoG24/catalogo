import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

if (!supabaseUrl) {
  throw new Error("SUPABASE_URL no está configurado");
}

if (!supabaseSecretKey) {
  throw new Error("SUPABASE_SECRET_KEY no está configurado");
}

export const supabase = createClient(
  supabaseUrl,
  supabaseSecretKey
);