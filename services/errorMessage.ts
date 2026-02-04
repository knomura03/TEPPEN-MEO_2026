type SupabaseLikeError = {
  message?: string;
  code?: string;
  details?: string;
  hint?: string;
  status?: number;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export const getErrorMessage = (error: unknown): string => {
  if (!error) return '';
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  if (!isObject(error)) return String(error);

  const e = error as SupabaseLikeError;
  const parts: string[] = [];

  if (typeof e.status === 'number') parts.push(`status=${e.status}`);
  if (e.code) parts.push(`code=${e.code}`);
  if (e.message) parts.push(e.message);
  if (e.details) parts.push(`details=${e.details}`);
  if (e.hint) parts.push(`hint=${e.hint}`);

  return parts.filter(Boolean).join(' / ') || JSON.stringify(error);
};

