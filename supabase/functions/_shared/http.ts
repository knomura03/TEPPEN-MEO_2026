export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

export const optionsResponse = () => new Response('ok', { headers: corsHeaders });

export const jsonResponse = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });

export const readString = (source: Record<string, unknown>, keys: string[]): string => {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return '';
};

export const toFormBody = (input: Record<string, string>): string => {
  const body = new URLSearchParams();
  Object.entries(input).forEach(([key, value]) => {
    body.append(key, value);
  });
  return body.toString();
};

export const fetchJson = async (
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<{ ok: boolean; status: number; body: unknown; text: string }> => {
  const response = await fetch(input, init);
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { ok: response.ok, status: response.status, body, text };
};

export const extractProviderErrorMessage = (body: unknown): string => {
  if (!body) return '';
  if (typeof body === 'string') return body;
  if (typeof body !== 'object') return String(body);

  const typed = body as Record<string, unknown>;
  const error = typed.error;
  if (error && typeof error === 'object') {
    const errorMessage = readString(error as Record<string, unknown>, ['message']);
    if (errorMessage) return errorMessage;
  }

  return readString(typed, ['message', 'error_description', 'error']);
};

export const normalizeJsonObject = (value: unknown): Record<string, unknown> => {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as Record<string, unknown>;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  return typeof value === 'object' ? (value as Record<string, unknown>) : {};
};
