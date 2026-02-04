import { Post, PostStatus, SocialPlatform } from '../types';
import { isSupabaseConfigured, supabase } from './supabaseClient';

type DbPostRow = {
  id: string;
  store_id: string;
  author_user_id: string | null;
  content: string;
  status: string;
  platforms: string[];
  scheduled_at: string | null;
  published_at: string | null;
};

const toPostStatus = (status: string): PostStatus => {
  if (status in PostStatus) return PostStatus[status as keyof typeof PostStatus];
  return PostStatus.DRAFT;
};

const mapDbPost = (row: DbPostRow): Post => {
  return {
    id: row.id,
    content: row.content,
    imageUrls: [],
    platforms: (row.platforms || []) as SocialPlatform[],
    scheduledDate: row.scheduled_at ? new Date(row.scheduled_at) : undefined,
    publishedDate: row.published_at ? new Date(row.published_at) : undefined,
    status: toPostStatus(row.status),
    authorId: row.author_user_id || 'unknown',
  };
};

const requireSupabase = () => {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabaseが未設定のため、投稿データを取得できません。');
  }
  return supabase;
};

export const postsService = {
  async listByStore(storeId: string): Promise<Post[]> {
    const client = requireSupabase();
    const { data, error } = await client
      .from('posts')
      .select('id, store_id, author_user_id, content, status, platforms, scheduled_at, published_at')
      .eq('store_id', storeId)
      .order('scheduled_at', { ascending: true, nullsFirst: false });
    if (error) throw error;
    return (data || []).map(mapDbPost);
  },

  async create(params: {
    storeId: string;
    authorUserId: string;
    content: string;
    platforms: SocialPlatform[];
    scheduledAt?: Date | null;
  }): Promise<Post> {
    const client = requireSupabase();
    const status = params.scheduledAt ? PostStatus.SCHEDULED : PostStatus.DRAFT;

    const { data, error } = await client
      .from('posts')
      .insert({
        store_id: params.storeId,
        author_user_id: params.authorUserId,
        content: params.content,
        status,
        platforms: params.platforms,
        scheduled_at: params.scheduledAt ? params.scheduledAt.toISOString() : null,
        published_at: null,
      })
      .select('id, store_id, author_user_id, content, status, platforms, scheduled_at, published_at')
      .single();

    if (error) throw error;
    return mapDbPost(data as DbPostRow);
  },

  async update(postId: string, patch: Partial<{ content: string; status: PostStatus; scheduledAt: Date | null }>): Promise<void> {
    const client = requireSupabase();
    const payload: Record<string, unknown> = {};
    if (typeof patch.content === 'string') payload.content = patch.content;
    if (patch.status) payload.status = patch.status;
    if (patch.scheduledAt !== undefined) payload.scheduled_at = patch.scheduledAt ? patch.scheduledAt.toISOString() : null;

    const { error } = await client.from('posts').update(payload).eq('id', postId);
    if (error) throw error;
  },

  async delete(postId: string): Promise<void> {
    const client = requireSupabase();
    const { error } = await client.from('posts').delete().eq('id', postId);
    if (error) throw error;
  },
};

