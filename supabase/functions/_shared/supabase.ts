import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export const requireEnv = (name: string): string => {
  const value = Deno.env.get(name);
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing ${name}`);
  }
  return value.trim();
};

export const createServiceRoleClient = () => {
  const supabaseUrl = requireEnv('SUPABASE_URL');
  const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return {
    supabaseUrl,
    serviceRoleKey,
    client,
  };
};
