import {
  BulkPostCreateResult,
  Post,
  PostApprovalActionType,
  PostApprovalComment,
  PostApprovalStatus,
  PostStatus,
  SocialPlatform,
} from '../types';
import { isSupabaseConfigured, supabase } from './supabaseClient';
import { migrationRequiredMessage } from './migrationRequiredMessage';
import { postMediaService } from './postMediaService';

type DbPostRow = {
  id: string;
  store_id: string;
  author_user_id: string | null;
  content: string;
  status: string;
  platforms: string[];
  scheduled_at: string | null;
  published_at: string | null;
  approval_status?: string | null;
  submitted_for_approval_at?: string | null;
  approved_at?: string | null;
  approved_by_user_id?: string | null;
  rejected_at?: string | null;
  rejected_by_user_id?: string | null;
  rejection_reason?: string | null;
  post_media?: { storage_path: string }[];
};

type DbPostApprovalCommentRow = {
  id: string;
  post_id: string;
  actor_user_id: string | null;
  action_type: string;
  comment: string | null;
  created_at: string;
};

let approvalCommentSchemaChecked = false;

const toPostStatus = (status: string): PostStatus => {
  if (status in PostStatus) return PostStatus[status as keyof typeof PostStatus];
  return PostStatus.DRAFT;
};

const toPostApprovalStatus = (status: string | null | undefined): PostApprovalStatus => {
  if (status === 'PENDING') return 'PENDING';
  if (status === 'APPROVED') return 'APPROVED';
  if (status === 'REJECTED') return 'REJECTED';
  return 'NONE';
};

const toPostApprovalActionType = (action: string): PostApprovalActionType => {
  if (action === 'SUBMIT') return 'SUBMIT';
  if (action === 'APPROVE') return 'APPROVE';
  if (action === 'REJECT') return 'REJECT';
  return 'COMMENT';
};

const mapDbPost = (row: DbPostRow, imageUrls: string[]): Post => {
  return {
    id: row.id,
    storeId: row.store_id,
    content: row.content,
    imageUrls,
    platforms: (row.platforms || []) as SocialPlatform[],
    scheduledDate: row.scheduled_at ? new Date(row.scheduled_at) : undefined,
    publishedDate: row.published_at ? new Date(row.published_at) : undefined,
    status: toPostStatus(row.status),
    approvalStatus: toPostApprovalStatus(row.approval_status),
    submittedForApprovalAt: row.submitted_for_approval_at ? new Date(row.submitted_for_approval_at) : undefined,
    approvedAt: row.approved_at ? new Date(row.approved_at) : undefined,
    approvedByUserId: row.approved_by_user_id || undefined,
    rejectedAt: row.rejected_at ? new Date(row.rejected_at) : undefined,
    rejectedByUserId: row.rejected_by_user_id || undefined,
    rejectionReason: row.rejection_reason || undefined,
    authorId: row.author_user_id || 'unknown',
  };
};

const mapDbApprovalComment = (row: DbPostApprovalCommentRow): PostApprovalComment => {
  return {
    id: row.id,
    postId: row.post_id,
    actorUserId: row.actor_user_id || undefined,
    actionType: toPostApprovalActionType(row.action_type),
    comment: row.comment || undefined,
    createdAt: new Date(row.created_at),
  };
};

const requireSupabase = () => {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabaseが未設定のため、投稿データを取得できません。');
  }
  return supabase;
};

const isMissingColumnError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const maybeCode = 'code' in error ? String((error as { code?: string }).code || '') : '';
  const maybeMessage = 'message' in error ? String((error as { message?: string }).message || '') : '';
  return maybeCode === '42703' || maybeMessage.includes('column');
};

const isMissingRelationError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const maybeCode = 'code' in error ? String((error as { code?: string }).code || '') : '';
  const maybeMessage = 'message' in error ? String((error as { message?: string }).message || '') : '';
  return maybeCode === '42P01' || maybeMessage.includes('does not exist');
};

const ensureApprovalCommentSchema = async (client: NonNullable<typeof supabase>) => {
  if (approvalCommentSchemaChecked) return;
  const { error } = await client.from('post_approval_comments').select('id').limit(1);
  if (error && isMissingRelationError(error)) {
    throw new Error(migrationRequiredMessage('投稿の履歴コメント'));
  }
  if (error) throw error;
  approvalCommentSchemaChecked = true;
};

const appendApprovalComment = async (
  client: NonNullable<typeof supabase>,
  params: {
    postId: string;
    actorUserId: string;
    actionType: PostApprovalActionType;
    comment?: string;
  }
) => {
  const { error } = await client.from('post_approval_comments').insert({
    post_id: params.postId,
    actor_user_id: params.actorUserId,
    action_type: params.actionType,
    comment: params.comment || null,
  });
  if (error && isMissingRelationError(error)) {
    throw new Error(migrationRequiredMessage('投稿の履歴コメント'));
  }
  if (error) throw error;
};

export const postsService = {
  async listByStore(storeId: string): Promise<Post[]> {
    const client = requireSupabase();
    const selectWithApproval =
      'id, store_id, author_user_id, content, status, platforms, scheduled_at, published_at, approval_status, submitted_for_approval_at, approved_at, approved_by_user_id, rejected_at, rejected_by_user_id, rejection_reason, post_media (storage_path)';
    let data: DbPostRow[] = [];

    const { data: primaryData, error } = await client
      .from('posts')
      .select(selectWithApproval)
      .eq('store_id', storeId)
      .order('scheduled_at', { ascending: true, nullsFirst: false });

    if (error && isMissingColumnError(error)) {
      const legacySelect = 'id, store_id, author_user_id, content, status, platforms, scheduled_at, published_at, post_media (storage_path)';
      const { data: legacyData, error: legacyError } = await client
        .from('posts')
        .select(legacySelect)
        .eq('store_id', storeId)
        .order('scheduled_at', { ascending: true, nullsFirst: false });
      if (legacyError) throw legacyError;
      data = (legacyData || []) as DbPostRow[];
    } else if (error) {
      throw error;
    } else {
      data = (primaryData || []) as DbPostRow[];
    }

    const allPaths = data.flatMap((row) => (row.post_media || []).map((media) => media.storage_path));
    let urlMap = new Map<string, string>();
    if (allPaths.length > 0) {
      try {
        urlMap = await postMediaService.createSignedUrlMap(allPaths);
      } catch {
        urlMap = new Map<string, string>();
      }
    }

    return data.map((row) => {
      const paths = (row.post_media || []).map((media) => media.storage_path);
      const imageUrls = paths.map((path) => urlMap.get(path)).filter((url): url is string => Boolean(url));
      return mapDbPost(row, imageUrls);
    });
  },

  async create(params: {
    storeId: string;
    authorUserId: string;
    content: string;
    platforms: SocialPlatform[];
    scheduledAt?: Date | null;
    approvalStatus?: PostApprovalStatus;
  }): Promise<Post> {
    const client = requireSupabase();
    const status = params.scheduledAt ? PostStatus.SCHEDULED : PostStatus.DRAFT;
    const approvalStatus = params.approvalStatus || 'NONE';
    const needsHistory = approvalStatus === 'PENDING' || approvalStatus === 'APPROVED';

    if (needsHistory) {
      await ensureApprovalCommentSchema(client);
    }

    const payload: Record<string, unknown> = {
      store_id: params.storeId,
      author_user_id: params.authorUserId,
      content: params.content,
      status,
      platforms: params.platforms,
      scheduled_at: params.scheduledAt ? params.scheduledAt.toISOString() : null,
      published_at: null,
      approval_status: approvalStatus,
      submitted_for_approval_at: approvalStatus === 'PENDING' ? new Date().toISOString() : null,
      approved_at: approvalStatus === 'APPROVED' ? new Date().toISOString() : null,
      approved_by_user_id: approvalStatus === 'APPROVED' ? params.authorUserId : null,
      rejected_at: null,
      rejected_by_user_id: null,
      rejection_reason: null,
    };

    const { data, error } = await client
      .from('posts')
      .insert(payload)
      .select('id, store_id, author_user_id, content, status, platforms, scheduled_at, published_at, approval_status, submitted_for_approval_at, approved_at, approved_by_user_id, rejected_at, rejected_by_user_id, rejection_reason')
      .single();

    if (error && isMissingColumnError(error)) {
      throw new Error(migrationRequiredMessage('投稿の承認フロー'));
    }
    if (error) throw error;

    const createdPost = mapDbPost(data as DbPostRow, []);
    if (createdPost.approvalStatus === 'PENDING') {
      await appendApprovalComment(client, {
        postId: createdPost.id,
        actorUserId: params.authorUserId,
        actionType: 'SUBMIT',
      });
    } else if (createdPost.approvalStatus === 'APPROVED') {
      await appendApprovalComment(client, {
        postId: createdPost.id,
        actorUserId: params.authorUserId,
        actionType: 'APPROVE',
        comment: '作成時に承認済みとして登録',
      });
    }
    return createdPost;
  },

  async createBulk(params: {
    storeIds: string[];
    authorUserId: string;
    content: string;
    platforms: SocialPlatform[];
    scheduledAt?: Date | null;
    approvalStatus?: PostApprovalStatus;
  }): Promise<BulkPostCreateResult> {
    const uniqueStoreIds = Array.from(new Set((params.storeIds || []).filter((id) => Boolean(id))));
    if (uniqueStoreIds.length === 0) {
      throw new Error('一括投稿の対象店舗がありません。');
    }

    const createdPosts: Post[] = [];
    try {
      for (const storeId of uniqueStoreIds) {
        const created = await postsService.create({
          storeId,
          authorUserId: params.authorUserId,
          content: params.content,
          platforms: params.platforms,
          scheduledAt: params.scheduledAt,
          approvalStatus: params.approvalStatus,
        });
        createdPosts.push(created);
      }
      return {
        createdPosts,
        targetStoreCount: uniqueStoreIds.length,
      };
    } catch (error) {
      if (createdPosts.length > 0 && isSupabaseConfigured && supabase) {
        await Promise.allSettled(createdPosts.map((post) => supabase.from('posts').delete().eq('id', post.id)));
      }
      const reason = error instanceof Error ? error.message : '不明なエラー';
      throw new Error(`一括投稿の作成に失敗しました。作成済み ${createdPosts.length} 件はロールバックしました。（${reason}）`);
    }
  },

  async update(postId: string, patch: Partial<{ content: string; status: PostStatus; scheduledAt: Date | null; approvalStatus: PostApprovalStatus; rejectionReason: string | null }>): Promise<void> {
    const client = requireSupabase();
    const payload: Record<string, unknown> = {};
    if (typeof patch.content === 'string') payload.content = patch.content;
    if (patch.status) payload.status = patch.status;
    if (patch.scheduledAt !== undefined) payload.scheduled_at = patch.scheduledAt ? patch.scheduledAt.toISOString() : null;
    if (patch.approvalStatus) payload.approval_status = patch.approvalStatus;
    if (patch.rejectionReason !== undefined) payload.rejection_reason = patch.rejectionReason;

    const { error } = await client.from('posts').update(payload).eq('id', postId);
    if (error) throw error;
  },

  async submitForApproval(postId: string, actorUserId?: string): Promise<void> {
    const client = requireSupabase();
    await ensureApprovalCommentSchema(client);
    const { error } = await client
      .from('posts')
      .update({
        approval_status: 'PENDING',
        submitted_for_approval_at: new Date().toISOString(),
        approved_at: null,
        approved_by_user_id: null,
        rejected_at: null,
        rejected_by_user_id: null,
        rejection_reason: null,
      })
      .eq('id', postId);
    if (error && isMissingColumnError(error)) {
      throw new Error(migrationRequiredMessage('投稿の承認フロー'));
    }
    if (error) throw error;
    if (actorUserId) {
      await appendApprovalComment(client, {
        postId,
        actorUserId,
        actionType: 'SUBMIT',
      });
    }
  },

  async approve(postId: string, approverUserId: string): Promise<void> {
    const client = requireSupabase();
    await ensureApprovalCommentSchema(client);
    const { error } = await client
      .from('posts')
      .update({
        approval_status: 'APPROVED',
        approved_at: new Date().toISOString(),
        approved_by_user_id: approverUserId,
        rejected_at: null,
        rejected_by_user_id: null,
        rejection_reason: null,
      })
      .eq('id', postId);
    if (error && isMissingColumnError(error)) {
      throw new Error(migrationRequiredMessage('投稿の承認フロー'));
    }
    if (error) throw error;
    await appendApprovalComment(client, {
      postId,
      actorUserId: approverUserId,
      actionType: 'APPROVE',
    });
  },

  async reject(postId: string, rejectorUserId: string, reason?: string): Promise<void> {
    const client = requireSupabase();
    await ensureApprovalCommentSchema(client);
    const { error } = await client
      .from('posts')
      .update({
        approval_status: 'REJECTED',
        rejected_at: new Date().toISOString(),
        rejected_by_user_id: rejectorUserId,
        rejection_reason: reason || null,
        approved_at: null,
        approved_by_user_id: null,
      })
      .eq('id', postId);
    if (error && isMissingColumnError(error)) {
      throw new Error(migrationRequiredMessage('投稿の承認フロー'));
    }
    if (error) throw error;
    await appendApprovalComment(client, {
      postId,
      actorUserId: rejectorUserId,
      actionType: 'REJECT',
      comment: reason,
    });
  },

  async listApprovalComments(postId: string): Promise<PostApprovalComment[]> {
    const client = requireSupabase();
    await ensureApprovalCommentSchema(client);
    const { data, error } = await client
      .from('post_approval_comments')
      .select('id, post_id, actor_user_id, action_type, comment, created_at')
      .eq('post_id', postId)
      .order('created_at', { ascending: true });
    if (error && isMissingRelationError(error)) {
      throw new Error(migrationRequiredMessage('投稿の履歴コメント'));
    }
    if (error) throw error;
    return ((data || []) as DbPostApprovalCommentRow[]).map(mapDbApprovalComment);
  },

  async addApprovalComment(postId: string, actorUserId: string, comment: string): Promise<void> {
    const client = requireSupabase();
    await ensureApprovalCommentSchema(client);
    await appendApprovalComment(client, {
      postId,
      actorUserId,
      actionType: 'COMMENT',
      comment,
    });
  },

  async delete(postId: string): Promise<void> {
    const client = requireSupabase();
    const { error } = await client.from('posts').delete().eq('id', postId);
    if (error) throw error;
  },
};
