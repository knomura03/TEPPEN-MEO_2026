import { BrandKit, PostContentLintResult, PostContentTemplate, SocialPlatform } from '../types';
import { isSupabaseConfigured, supabase } from './supabaseClient';
import { migrationRequiredMessage } from './migrationRequiredMessage';

type DbBrandKitRow = {
  id: string;
  org_id: string;
  tone_guide: string | null;
  banned_words: string[] | null;
  recommended_hashtags: string[] | null;
  default_signature: string | null;
  updated_by: string | null;
  updated_at: string;
};

type DbPostTemplateRow = {
  id: string;
  org_id: string;
  title: string;
  body: string;
  default_platforms: string[] | null;
  is_active: boolean;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

const MIGRATION_ERROR_MESSAGE = migrationRequiredMessage('ブランドキット（投稿テンプレート）');

const requireSupabase = () => {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabaseが未設定のため、ブランドキットを利用できません。');
  }
  return supabase;
};

const isMissingRelationError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const code = 'code' in error ? String((error as { code?: string }).code || '') : '';
  const message = 'message' in error ? String((error as { message?: string }).message || '') : '';
  return code === '42P01' || message.includes('does not exist');
};

const normalizeTextList = (values: string[]): string[] => {
  const unique = new Set<string>();
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized) continue;
    unique.add(normalized.slice(0, 50));
    if (unique.size >= 30) break;
  }
  return Array.from(unique);
};

const parseListInput = (raw: string): string[] => {
  return normalizeTextList(raw.split(/[,\n]/).map((token) => token.trim()));
};

const toPlatformArray = (values: string[] | null): SocialPlatform[] => {
  const allowed: SocialPlatform[] = ['INSTAGRAM', 'FACEBOOK', 'GOOGLE_BUSINESS', 'TIKTOK'];
  const safe = values || [];
  return safe.filter((platform): platform is SocialPlatform => allowed.includes(platform as SocialPlatform));
};

const mapBrandKit = (row: DbBrandKitRow): BrandKit => {
  return {
    id: row.id,
    orgId: row.org_id,
    toneGuide: row.tone_guide || undefined,
    bannedWords: normalizeTextList(row.banned_words || []),
    recommendedHashtags: normalizeTextList(row.recommended_hashtags || []),
    defaultSignature: row.default_signature || undefined,
    updatedBy: row.updated_by || undefined,
    updatedAt: row.updated_at ? new Date(row.updated_at) : undefined,
  };
};

const mapTemplate = (row: DbPostTemplateRow): PostContentTemplate => {
  return {
    id: row.id,
    orgId: row.org_id,
    title: row.title,
    body: row.body,
    defaultPlatforms: toPlatformArray(row.default_platforms),
    isActive: row.is_active,
    createdBy: row.created_by || undefined,
    updatedBy: row.updated_by || undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
};

export const brandKitService = {
  parseListInput,

  lintContent(content: string, brandKit?: BrandKit): PostContentLintResult {
    if (!brandKit) {
      return {
        matchedBannedWords: [],
        missingRecommendedHashtags: [],
      };
    }
    const normalizedContent = content.toLowerCase();
    const matchedBannedWords = brandKit.bannedWords.filter((word) => normalizedContent.includes(word.toLowerCase()));
    const missingRecommendedHashtags = brandKit.recommendedHashtags.filter((tag) => {
      if (!tag) return false;
      return !normalizedContent.includes(tag.toLowerCase());
    });
    return {
      matchedBannedWords: normalizeTextList(matchedBannedWords),
      missingRecommendedHashtags: normalizeTextList(missingRecommendedHashtags),
    };
  },

  async getBrandKit(orgId: string): Promise<BrandKit | null> {
    const client = requireSupabase();
    const { data, error } = await client
      .from('brand_kits')
      .select('id, org_id, tone_guide, banned_words, recommended_hashtags, default_signature, updated_by, updated_at')
      .eq('org_id', orgId)
      .maybeSingle();
    if (error && isMissingRelationError(error)) {
      throw new Error(MIGRATION_ERROR_MESSAGE);
    }
    if (error) throw error;
    if (!data) return null;
    return mapBrandKit(data as DbBrandKitRow);
  },

  async upsertBrandKit(params: {
    orgId: string;
    toneGuide?: string;
    bannedWords: string[];
    recommendedHashtags: string[];
    defaultSignature?: string;
    updatedBy: string;
  }): Promise<BrandKit> {
    const client = requireSupabase();
    const payload = {
      org_id: params.orgId,
      tone_guide: params.toneGuide?.trim() || null,
      banned_words: normalizeTextList(params.bannedWords),
      recommended_hashtags: normalizeTextList(params.recommendedHashtags),
      default_signature: params.defaultSignature?.trim() || null,
      updated_by: params.updatedBy,
    };

    const { data, error } = await client
      .from('brand_kits')
      .upsert(payload, { onConflict: 'org_id' })
      .select('id, org_id, tone_guide, banned_words, recommended_hashtags, default_signature, updated_by, updated_at')
      .single();
    if (error && isMissingRelationError(error)) {
      throw new Error(MIGRATION_ERROR_MESSAGE);
    }
    if (error) throw error;
    return mapBrandKit(data as DbBrandKitRow);
  },

  async listTemplates(orgId: string): Promise<PostContentTemplate[]> {
    const client = requireSupabase();
    const { data, error } = await client
      .from('post_templates')
      .select('id, org_id, title, body, default_platforms, is_active, created_by, updated_by, created_at, updated_at')
      .eq('org_id', orgId)
      .eq('is_active', true)
      .order('updated_at', { ascending: false });
    if (error && isMissingRelationError(error)) {
      throw new Error(MIGRATION_ERROR_MESSAGE);
    }
    if (error) throw error;
    return ((data || []) as DbPostTemplateRow[]).map(mapTemplate);
  },

  async createTemplate(params: {
    orgId: string;
    title: string;
    body: string;
    defaultPlatforms: SocialPlatform[];
    createdBy: string;
  }): Promise<PostContentTemplate> {
    const client = requireSupabase();
    const payload = {
      org_id: params.orgId,
      title: params.title.trim(),
      body: params.body.trim(),
      default_platforms: Array.from(new Set(params.defaultPlatforms)),
      is_active: true,
      created_by: params.createdBy,
      updated_by: params.createdBy,
    };
    const { data, error } = await client
      .from('post_templates')
      .insert(payload)
      .select('id, org_id, title, body, default_platforms, is_active, created_by, updated_by, created_at, updated_at')
      .single();
    if (error && isMissingRelationError(error)) {
      throw new Error(MIGRATION_ERROR_MESSAGE);
    }
    if (error) throw error;
    return mapTemplate(data as DbPostTemplateRow);
  },

  async removeTemplate(templateId: string): Promise<void> {
    const client = requireSupabase();
    const { error } = await client
      .from('post_templates')
      .update({ is_active: false })
      .eq('id', templateId);
    if (error && isMissingRelationError(error)) {
      throw new Error(MIGRATION_ERROR_MESSAGE);
    }
    if (error) throw error;
  },

  async removeTemplates(templateIds: string[]): Promise<void> {
    const client = requireSupabase();
    const uniqueIds = Array.from(new Set(templateIds.map((id) => id.trim()).filter((id) => id.length > 0)));
    if (uniqueIds.length === 0) return;

    const { error } = await client
      .from('post_templates')
      .update({ is_active: false })
      .in('id', uniqueIds);
    if (error && isMissingRelationError(error)) {
      throw new Error(MIGRATION_ERROR_MESSAGE);
    }
    if (error) throw error;
  },
};
