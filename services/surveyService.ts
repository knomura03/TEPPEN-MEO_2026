import { Survey, SurveyAnalytics, SurveyBranchType, SurveyEventType, SurveyResponse, SurveyStatus } from '../types';
import { isSupabaseConfigured, supabase } from './supabaseClient';

type DbSurveyRow = {
  id: string;
  store_id: string;
  author_user_id: string | null;
  title: string;
  description: string | null;
  review_redirect_url: string | null;
  positive_threshold: number;
  status: SurveyStatus;
  public_token: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  survey_responses?: Array<{ id: string }>;
};

type DbSurveyResponseRow = {
  id: string;
  survey_id: string;
  rating: number;
  branch_type: SurveyBranchType;
  comment: string | null;
  source: string;
  created_at: string;
};

const requireSupabase = () => {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabaseが未設定のため、アンケート機能を利用できません。');
  }
  return supabase;
};

const mapSurvey = (row: DbSurveyRow): Survey => ({
  id: row.id,
  storeId: row.store_id,
  authorUserId: row.author_user_id || undefined,
  title: row.title,
  description: row.description || undefined,
  reviewRedirectUrl: row.review_redirect_url || undefined,
  positiveThreshold: row.positive_threshold,
  status: row.status,
  publicToken: row.public_token || undefined,
  publishedAt: row.published_at ? new Date(row.published_at) : undefined,
  createdAt: new Date(row.created_at),
  updatedAt: new Date(row.updated_at),
  responseCount: row.survey_responses?.length || 0,
});

const mapSurveyResponse = (row: DbSurveyResponseRow): SurveyResponse => ({
  id: row.id,
  surveyId: row.survey_id,
  rating: row.rating,
  branchType: row.branch_type,
  comment: row.comment || undefined,
  source: row.source,
  createdAt: new Date(row.created_at),
});

const ratioPercent = (numerator: number, denominator: number): number => {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
};

const generatePublicToken = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 20);
  }
  return Math.random().toString(36).slice(2, 22);
};

const parsePublishConstraintError = (error: unknown): string => {
  const message = error && typeof error === 'object' && 'message' in error
    ? String((error as { message?: string }).message || '')
    : '';
  const code = error && typeof error === 'object' && 'code' in error
    ? String((error as { code?: string }).code || '')
    : '';
  if (code === '23505' || message.includes('surveys_published_single_per_author_idx')) {
    return '公開中アンケートはユーザーごとに1件までです。既存の公開アンケートをアーカイブしてから公開してください。';
  }
  return message || 'アンケートの公開に失敗しました。';
};

export const buildPublicSurveyUrl = (publicToken: string): string => {
  if (typeof window === 'undefined') {
    return `#/survey/${publicToken}`;
  }
  return `${window.location.origin}/#/survey/${publicToken}`;
};

export const surveyService = {
  async listByStore(storeId: string): Promise<Survey[]> {
    const client = requireSupabase();
    const { data, error } = await client
      .from('surveys')
      .select(
        'id, store_id, author_user_id, title, description, review_redirect_url, positive_threshold, status, public_token, published_at, created_at, updated_at, survey_responses(id)'
      )
      .eq('store_id', storeId)
      .order('updated_at', { ascending: false });
    if (error) throw error;
    return ((data || []) as DbSurveyRow[]).map(mapSurvey);
  },

  async createDraft(params: {
    storeId: string;
    authorUserId: string;
    title: string;
    description?: string;
    reviewRedirectUrl?: string;
    positiveThreshold?: number;
  }): Promise<Survey> {
    const client = requireSupabase();
    const { data, error } = await client
      .from('surveys')
      .insert({
        store_id: params.storeId,
        author_user_id: params.authorUserId,
        title: params.title,
        description: params.description || null,
        review_redirect_url: params.reviewRedirectUrl || null,
        positive_threshold: params.positiveThreshold ?? 4,
        status: 'DRAFT',
      })
      .select(
        'id, store_id, author_user_id, title, description, review_redirect_url, positive_threshold, status, public_token, published_at, created_at, updated_at, survey_responses(id)'
      )
      .single();
    if (error) throw error;
    return mapSurvey(data as DbSurveyRow);
  },

  async updateDraft(params: {
    surveyId: string;
    title: string;
    description?: string;
    reviewRedirectUrl?: string;
    positiveThreshold: number;
  }): Promise<Survey> {
    const client = requireSupabase();
    const { data, error } = await client
      .from('surveys')
      .update({
        title: params.title,
        description: params.description || null,
        review_redirect_url: params.reviewRedirectUrl || null,
        positive_threshold: params.positiveThreshold,
      })
      .eq('id', params.surveyId)
      .neq('status', 'ARCHIVED')
      .select(
        'id, store_id, author_user_id, title, description, review_redirect_url, positive_threshold, status, public_token, published_at, created_at, updated_at, survey_responses(id)'
      )
      .single();
    if (error) throw error;
    return mapSurvey(data as DbSurveyRow);
  },

  async publish(surveyId: string): Promise<Survey> {
    const client = requireSupabase();
    const token = generatePublicToken();
    const { data, error } = await client
      .from('surveys')
      .update({
        status: 'PUBLISHED',
        public_token: token,
        published_at: new Date().toISOString(),
      })
      .eq('id', surveyId)
      .select(
        'id, store_id, author_user_id, title, description, review_redirect_url, positive_threshold, status, public_token, published_at, created_at, updated_at, survey_responses(id)'
      )
      .single();
    if (error) {
      throw new Error(parsePublishConstraintError(error));
    }
    return mapSurvey(data as DbSurveyRow);
  },

  async archive(surveyId: string): Promise<Survey> {
    const client = requireSupabase();
    const { data, error } = await client
      .from('surveys')
      .update({
        status: 'ARCHIVED',
      })
      .eq('id', surveyId)
      .select(
        'id, store_id, author_user_id, title, description, review_redirect_url, positive_threshold, status, public_token, published_at, created_at, updated_at, survey_responses(id)'
      )
      .single();
    if (error) throw error;
    return mapSurvey(data as DbSurveyRow);
  },

  async getPublishedByToken(publicToken: string): Promise<Survey | null> {
    const client = requireSupabase();
    const { data, error } = await client
      .from('surveys')
      .select(
        'id, store_id, author_user_id, title, description, review_redirect_url, positive_threshold, status, public_token, published_at, created_at, updated_at, survey_responses(id)'
      )
      .eq('public_token', publicToken)
      .eq('status', 'PUBLISHED')
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return mapSurvey(data as DbSurveyRow);
  },

  async submitResponse(params: {
    surveyId: string;
    rating: number;
    branchType: SurveyBranchType;
    comment?: string;
  }): Promise<SurveyResponse> {
    const client = requireSupabase();
    const { data, error } = await client
      .from('survey_responses')
      .insert({
        survey_id: params.surveyId,
        rating: params.rating,
        branch_type: params.branchType,
        comment: params.comment || null,
        source: 'PUBLIC_URL',
      })
      .select('id, survey_id, rating, branch_type, comment, source, created_at')
      .single();
    if (error) throw error;
    return mapSurveyResponse(data as DbSurveyResponseRow);
  },

  async trackPublicEvent(params: {
    surveyId: string;
    eventType: SurveyEventType;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    const client = requireSupabase();
    const { error } = await client.from('survey_events').insert({
      survey_id: params.surveyId,
      event_type: params.eventType,
      metadata: params.metadata || {},
    });
    if (error) throw error;
  },

  async getAnalytics(surveyId: string): Promise<SurveyAnalytics> {
    const client = requireSupabase();

    const [
      viewResult,
      clickResult,
      responseResult,
      positiveResult,
      negativeResult,
    ] = await Promise.all([
      client.from('survey_events').select('id', { count: 'exact', head: true }).eq('survey_id', surveyId).eq('event_type', 'VIEW'),
      client.from('survey_events').select('id', { count: 'exact', head: true }).eq('survey_id', surveyId).eq('event_type', 'REDIRECT_CLICK'),
      client.from('survey_responses').select('id', { count: 'exact', head: true }).eq('survey_id', surveyId),
      client.from('survey_responses').select('id', { count: 'exact', head: true }).eq('survey_id', surveyId).eq('branch_type', 'POSITIVE'),
      client.from('survey_responses').select('id', { count: 'exact', head: true }).eq('survey_id', surveyId).eq('branch_type', 'NEGATIVE'),
    ]);

    if (viewResult.error) throw viewResult.error;
    if (clickResult.error) throw clickResult.error;
    if (responseResult.error) throw responseResult.error;
    if (positiveResult.error) throw positiveResult.error;
    if (negativeResult.error) throw negativeResult.error;

    const viewCount = viewResult.count || 0;
    const responseCount = responseResult.count || 0;
    const positiveCount = positiveResult.count || 0;
    const negativeCount = negativeResult.count || 0;
    const redirectClickCount = clickResult.count || 0;

    return {
      surveyId,
      viewCount,
      responseCount,
      completionRate: ratioPercent(responseCount, viewCount),
      positiveCount,
      negativeCount,
      positiveRate: ratioPercent(positiveCount, responseCount),
      negativeRate: ratioPercent(negativeCount, responseCount),
      redirectClickCount,
      redirectClickRate: ratioPercent(redirectClickCount, positiveCount),
    };
  },

  async buildResponsesCsv(surveyId: string): Promise<string> {
    const client = requireSupabase();
    const { data, error } = await client
      .from('survey_responses')
      .select('id, survey_id, rating, branch_type, comment, source, created_at')
      .eq('survey_id', surveyId)
      .order('created_at', { ascending: false });
    if (error) throw error;

    const rows = ((data || []) as DbSurveyResponseRow[]).map(mapSurveyResponse);
    const header = ['response_id', 'survey_id', 'rating', 'branch_type', 'comment', 'source', 'created_at'];
    const escapeCell = (value: string) => {
      const escaped = value.replace(/"/g, '""');
      return `"${escaped}"`;
    };

    const lines = [header.join(',')];
    for (const row of rows) {
      lines.push([
        escapeCell(row.id),
        escapeCell(row.surveyId),
        escapeCell(String(row.rating)),
        escapeCell(row.branchType),
        escapeCell(row.comment || ''),
        escapeCell(row.source),
        escapeCell(row.createdAt.toISOString()),
      ].join(','));
    }
    return lines.join('\n');
  },
};
