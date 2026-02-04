import { isSupabaseConfigured, supabase } from './supabaseClient';

type UploadedMedia = {
  storagePath: string;
  mime?: string | null;
  size?: number | null;
};

const BUCKET_ID = 'post-media';

const requireSupabase = () => {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabaseが未設定のため、メディアをアップロードできません。');
  }
  return supabase;
};

const sanitizeFileName = (name: string) => {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
};

const buildStoragePath = (storeId: string, postId: string, fileName: string) => {
  const safeName = sanitizeFileName(fileName);
  const randomId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`;
  return `${storeId}/${postId}/${randomId}-${safeName}`;
};

export const postMediaService = {
  async uploadForPost(params: { storeId: string; postId: string; files: File[] }): Promise<UploadedMedia[]> {
    const client = requireSupabase();
    if (params.files.length === 0) return [];

    const uploaded: UploadedMedia[] = [];

    for (const file of params.files) {
      const path = buildStoragePath(params.storeId, params.postId, file.name);
      const { error } = await client.storage
        .from(BUCKET_ID)
        .upload(path, file, {
          upsert: false,
          contentType: file.type || undefined,
        });
      if (error) throw error;
      uploaded.push({
        storagePath: path,
        mime: file.type || null,
        size: Number.isFinite(file.size) ? file.size : null,
      });
    }

    if (uploaded.length > 0) {
      const { error } = await client.from('post_media').insert(
        uploaded.map((item) => ({
          post_id: params.postId,
          store_id: params.storeId,
          storage_path: item.storagePath,
          mime: item.mime,
          size: item.size,
        }))
      );
      if (error) throw error;
    }

    return uploaded;
  },

  async createSignedUrlMap(paths: string[], expiresInSeconds = 3600): Promise<Map<string, string>> {
    const client = requireSupabase();
    const uniquePaths = Array.from(new Set(paths)).filter(Boolean);
    const result = new Map<string, string>();
    if (uniquePaths.length === 0) return result;

    const { data, error } = await client.storage.from(BUCKET_ID).createSignedUrls(uniquePaths, expiresInSeconds);
    if (error) throw error;

    (data || []).forEach((item) => {
      if (item.path && item.signedUrl) {
        result.set(item.path, item.signedUrl);
      }
    });
    return result;
  },
};

