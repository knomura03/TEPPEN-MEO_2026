import { isSupabaseConfigured, supabase } from './supabaseClient';

const AVATAR_BUCKET = 'avatars';

const requireSupabase = () => {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabaseが未設定のため、プロフィール画像を更新できません。');
  }
  return supabase;
};

const sanitizeFileName = (name: string) => name.replace(/[^a-zA-Z0-9._-]/g, '_');

const extractAvatarPath = (url?: string | null): string | null => {
  if (!url) return null;
  const marker = `/storage/v1/object/public/${AVATAR_BUCKET}/`;
  const index = url.indexOf(marker);
  if (index < 0) return null;
  return url.slice(index + marker.length);
};

export const avatarService = {
  async uploadForUser(params: { userId: string; file: File; previousAvatarUrl?: string | null }): Promise<string> {
    const client = requireSupabase();
    const extension = params.file.name.includes('.') ? params.file.name.split('.').pop() : 'png';
    const safeFileName = sanitizeFileName(params.file.name.replace(/\.[^.]+$/, ''));
    const suffix = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`;
    const path = `${params.userId}/${suffix}-${safeFileName}.${extension}`;

    const { error: uploadError } = await client.storage
      .from(AVATAR_BUCKET)
      .upload(path, params.file, {
        upsert: false,
        contentType: params.file.type || undefined,
      });

    if (uploadError) throw uploadError;

    const oldPath = extractAvatarPath(params.previousAvatarUrl);
    if (oldPath && oldPath !== path) {
      const { error: removeError } = await client.storage.from(AVATAR_BUCKET).remove([oldPath]);
      if (removeError) {
        console.warn('[avatarService] Failed to remove old avatar:', removeError.message);
      }
    }

    const { data } = client.storage.from(AVATAR_BUCKET).getPublicUrl(path);
    if (!data?.publicUrl) {
      throw new Error('プロフィール画像URLの生成に失敗しました。');
    }

    return data.publicUrl;
  },
};

