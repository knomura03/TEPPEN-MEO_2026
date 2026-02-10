import { isSupabaseConfigured, supabase } from './supabaseClient';

const BUCKET_ID = 'survey-media';

const requireSupabase = () => {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabaseが未設定のため、アンケート画像をアップロードできません。');
  }
  return supabase;
};

const sanitizeFileName = (name: string) => {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
};

const buildStoragePath = (storeId: string, surveyId: string, fileName: string) => {
  const safeName = sanitizeFileName(fileName);
  const randomId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`;
  return `${storeId}/surveys/${surveyId}/${randomId}-${safeName}`;
};

export const surveyMediaService = {
  async uploadHeaderImage(params: { storeId: string; surveyId: string; file: File }): Promise<{ storagePath: string; publicUrl: string }> {
    const client = requireSupabase();
    const path = buildStoragePath(params.storeId, params.surveyId, params.file.name);
    const { error } = await client.storage
      .from(BUCKET_ID)
      .upload(path, params.file, { upsert: false, contentType: params.file.type || undefined });
    if (error) throw error;

    const { data } = client.storage.from(BUCKET_ID).getPublicUrl(path);
    const publicUrl = data.publicUrl;
    if (!publicUrl) {
      throw new Error('アップロードは成功しましたが公開URLの取得に失敗しました。');
    }
    return {
      storagePath: path,
      publicUrl,
    };
  },

  async deleteHeaderImage(storagePath: string): Promise<void> {
    const client = requireSupabase();
    if (!storagePath) return;
    const { error } = await client.storage.from(BUCKET_ID).remove([storagePath]);
    if (error) throw error;
  },
};
