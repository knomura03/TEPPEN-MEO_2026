import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export const extractBearerToken = (headerValue: string | null): string => {
  if (!headerValue) return '';
  const matched = headerValue.match(/Bearer\s+([^,\s]+)/i);
  if (matched?.[1]) return matched[1].trim();
  return headerValue.trim();
};

export const resolveAuthenticatedUserId = async (
  req: Request,
  supabaseUrl: string,
  serviceRoleKey: string
): Promise<{ userId: string | null; error: string | null }> => {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader || authHeader.trim().length === 0) {
    return { userId: null, error: 'Missing auth token' };
  }

  const token = extractBearerToken(authHeader);
  if (!token) {
    return { userId: null, error: 'Missing auth token' };
  }

  const requestApiKey = req.headers.get('apikey') || req.headers.get('x-api-key');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('SUPABASE_PUBLISHABLE_KEY');

  const keysToTry = [
    requestApiKey,
    anonKey,
    serviceRoleKey,
  ].filter((item): item is string => Boolean(item && item.length > 0));

  let lastError: { message?: string } | null = null;
  for (const key of keysToTry) {
    const authClient = createClient(supabaseUrl, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data, error } = await authClient.auth.getUser(token);
    if (!error && data?.user?.id) {
      return { userId: data.user.id, error: null };
    }

    if (error) {
      lastError = error as { message?: string };
    }
  }

  if (lastError?.message) {
    return { userId: null, error: lastError.message };
  }

  const fallbackKey = requestApiKey || anonKey || serviceRoleKey;
  if (!fallbackKey) {
    return { userId: null, error: 'Invalid auth token' };
  }

  const authVerifyResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
    method: 'GET',
    headers: {
      apikey: fallbackKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!authVerifyResponse.ok) {
    const raw = await authVerifyResponse.text();
    const parsed = (() => {
      try {
        return JSON.parse(raw)?.message;
      } catch {
        return raw || 'Invalid auth token';
      }
    })();
    return { userId: null, error: typeof parsed === 'string' && parsed ? parsed : 'Invalid auth token' };
  }

  const userInfo = await authVerifyResponse.json();
  const userId = typeof userInfo?.id === 'string' ? userInfo.id : '';
  if (!userId) {
    return { userId: null, error: 'Invalid auth token' };
  }

  return { userId, error: null };
};
