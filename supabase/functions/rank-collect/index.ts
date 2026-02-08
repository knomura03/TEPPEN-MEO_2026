import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type RankCollectionMode = 'REAL' | 'MOCK';
type RankCollectionTriggerType = 'MANUAL' | 'SCHEDULED';

type MembershipRow = {
  role: string;
  store_id: string | null;
};

type RankKeywordRow = {
  id: string;
  keyword: string;
};

const jsonResponse = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });

const extractBearerToken = (headerValue: string | null): string => {
  if (!headerValue) return '';
  const matched = headerValue.match(/Bearer\s+([^,\s]+)/i);
  if (matched?.[1]) return matched[1].trim();
  return headerValue.trim();
};

const resolveAuthenticatedUserId = async (
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

  const authClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data?.user?.id) {
    return { userId: null, error: error?.message || 'Invalid auth token' };
  }
  return { userId: data.user.id, error: null };
};

const normalizeMode = (raw: unknown): RankCollectionMode => {
  if (String(raw || '').toUpperCase() === 'REAL') return 'REAL';
  return 'MOCK';
};

const normalizeTriggerType = (raw: unknown): RankCollectionTriggerType => {
  if (String(raw || '').toUpperCase() === 'SCHEDULED') return 'SCHEDULED';
  return 'MANUAL';
};

const buildSeededPosition = (seed: string): number => {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 33 + seed.charCodeAt(i)) % 1000003;
  }
  return (hash % 50) + 1;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(500, { error: 'Missing Supabase env vars' });
  }

  const authResult = await resolveAuthenticatedUserId(req, supabaseUrl, serviceRoleKey);
  if (!authResult.userId) {
    return jsonResponse(401, { error: authResult.error || 'Invalid auth token' });
  }
  const actorUserId = authResult.userId;

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  let payload: { storeId?: string; mode?: string; triggerType?: string };
  try {
    payload = await req.json();
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body' });
  }

  const storeId = payload.storeId?.trim();
  if (!storeId) {
    return jsonResponse(400, { error: 'Missing storeId' });
  }
  const mode = normalizeMode(payload.mode);
  const triggerType = normalizeTriggerType(payload.triggerType);

  const { data: store, error: storeError } = await supabaseAdmin
    .from('stores')
    .select('id, org_id')
    .eq('id', storeId)
    .maybeSingle();
  if (storeError || !store) {
    return jsonResponse(404, { error: 'Store not found' });
  }

  const { data: memberships, error: membershipsError } = await supabaseAdmin
    .from('memberships')
    .select('role, store_id')
    .eq('org_id', store.org_id)
    .eq('user_id', actorUserId);
  if (membershipsError || !memberships || memberships.length === 0) {
    return jsonResponse(403, { error: 'Not allowed' });
  }

  const rows = memberships as MembershipRow[];
  const hasOrgManagerRole = rows.some((row) => {
    const role = String(row.role || '').toUpperCase();
    return role === 'ADMIN' || role === 'MANAGER';
  });
  const hasStoreScope = rows.some((row) => row.store_id === storeId);
  if (!hasOrgManagerRole && !hasStoreScope) {
    return jsonResponse(403, { error: 'Not allowed for this store' });
  }

  const { data: insertedRun, error: runInsertError } = await supabaseAdmin
    .from('rank_collection_runs')
    .insert({
      store_id: storeId,
      trigger_type: triggerType,
      mode,
      status: 'RUNNING',
      requested_by_user_id: actorUserId,
    })
    .select('id')
    .single();
  if (runInsertError || !insertedRun) {
    return jsonResponse(400, { error: runInsertError?.message || 'Failed to create collection run' });
  }
  const runId = insertedRun.id as string;

  const finalizeRun = async (status: 'SUCCESS' | 'FAILED', message: string) => {
    await supabaseAdmin
      .from('rank_collection_runs')
      .update({
        status,
        message,
        finished_at: new Date().toISOString(),
      })
      .eq('id', runId);
  };

  if (mode === 'REAL') {
    await finalizeRun('FAILED', 'REAL収集は未実装です。P3-03以降で対応予定です。');
    return jsonResponse(400, {
      error: 'REAL collection is not implemented yet',
      runId,
    });
  }

  const { data: keywords, error: keywordsError } = await supabaseAdmin
    .from('rank_keywords')
    .select('id, keyword')
    .eq('store_id', storeId)
    .eq('is_active', true)
    .order('updated_at', { ascending: false });
  if (keywordsError) {
    await finalizeRun('FAILED', `キーワード取得に失敗しました: ${keywordsError.message}`);
    return jsonResponse(400, { error: keywordsError.message, runId });
  }

  const keywordRows = (keywords || []) as RankKeywordRow[];
  if (keywordRows.length === 0) {
    await finalizeRun('SUCCESS', '有効なキーワードがないため結果0件で完了しました。');
    return jsonResponse(200, {
      ok: true,
      runId,
      mode,
      status: 'SUCCESS',
      collectedCount: 0,
      message: '有効なキーワードがないため結果0件で完了しました。',
    });
  }

  const dateSeed = new Date().toISOString().slice(0, 10);
  const resultPayload = keywordRows.map((row) => {
    const seed = `${dateSeed}|${storeId}|${row.keyword}`;
    const position = buildSeededPosition(seed);
    return {
      run_id: runId,
      store_id: storeId,
      rank_keyword_id: row.id,
      keyword: row.keyword,
      position,
      mode: 'MOCK',
      status: 'SUCCESS',
      raw: {
        source: 'mock-generator',
        seed,
        generated_at: new Date().toISOString(),
      },
    };
  });

  const { error: resultInsertError } = await supabaseAdmin.from('rank_collection_results').insert(resultPayload);
  if (resultInsertError) {
    await finalizeRun('FAILED', `収集結果の保存に失敗しました: ${resultInsertError.message}`);
    return jsonResponse(400, { error: resultInsertError.message, runId });
  }

  const successMessage = `${resultPayload.length}件の順位収集を完了しました。（MOCK）`;
  await finalizeRun('SUCCESS', successMessage);

  await supabaseAdmin.from('audit_logs').insert({
    org_id: store.org_id,
    store_id: storeId,
    actor_user_id: actorUserId,
    action: 'RANK_COLLECTION_RUN',
    target_type: 'rank_collection_runs',
    target_id: runId,
    payload: {
      mode,
      trigger_type: triggerType,
      collected_count: resultPayload.length,
    },
  });

  return jsonResponse(200, {
    ok: true,
    runId,
    mode,
    status: 'SUCCESS',
    collectedCount: resultPayload.length,
    message: successMessage,
  });
});
