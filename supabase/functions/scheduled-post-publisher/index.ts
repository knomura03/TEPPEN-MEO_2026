import { jsonResponse, optionsResponse } from '../_shared/http.ts';
import { runPostPublish } from '../_shared/postPublish.ts';
import { createServiceRoleClient, requireEnv } from '../_shared/supabase.ts';

type ScheduledPostRow = {
  id: string;
  store_id: string;
  content: string;
  platforms: string[];
  scheduled_at: string | null;
  approval_status: string;
  org_id: string;
};

const verifyCronSecret = (req: Request): { ok: boolean; error?: string } => {
  const configured = Deno.env.get('SCHEDULED_POST_PUBLISHER_SECRET')?.trim() || '';
  if (!configured) return { ok: true };

  const provided = (req.headers.get('x-cron-secret') || req.headers.get('X-Cron-Secret') || '').trim();
  if (!provided || provided !== configured) {
    return { ok: false, error: 'Invalid scheduler secret' };
  }
  return { ok: true };
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return optionsResponse();
  }

  if (req.method !== 'POST' && req.method !== 'GET') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  const secretValidation = verifyCronSecret(req);
  if (!secretValidation.ok) {
    return jsonResponse(401, { error: secretValidation.error || 'Unauthorized' });
  }

  let supabaseAdmin: any;
  let encryptionKey = '';
  try {
    const runtime = createServiceRoleClient();
    supabaseAdmin = runtime.client;
    encryptionKey = requireEnv('PROVIDER_CONFIG_ENCRYPTION_KEY');
  } catch (error) {
    return jsonResponse(500, { error: error instanceof Error ? error.message : 'Missing env vars' });
  }

  const nowIso = new Date().toISOString();
  const { data: rows, error: selectError } = await supabaseAdmin
    .from('posts')
    .select('id, store_id, content, platforms, scheduled_at, approval_status, stores!inner(org_id)')
    .eq('status', 'SCHEDULED')
    .eq('approval_status', 'APPROVED')
    .lte('scheduled_at', nowIso)
    .order('scheduled_at', { ascending: true })
    .limit(30);

  if (selectError) {
    return jsonResponse(400, { error: selectError.message });
  }

  const postRows = ((rows || []) as Array<Record<string, unknown>>).map((row) => {
    const stores = row.stores as Record<string, unknown> | null;
    return {
      id: String(row.id || ''),
      store_id: String(row.store_id || ''),
      content: String(row.content || ''),
      platforms: Array.isArray(row.platforms) ? row.platforms.map((item) => String(item)) : [],
      scheduled_at: typeof row.scheduled_at === 'string' ? row.scheduled_at : null,
      approval_status: String(row.approval_status || ''),
      org_id: stores && typeof stores.org_id === 'string' ? stores.org_id : '',
    } as ScheduledPostRow;
  });

  const processed: Array<{ postId: string; ok: boolean; message: string }> = [];

  for (const post of postRows) {
    if (!post.id || !post.org_id) continue;

    const { data: locked, error: lockError } = await supabaseAdmin.rpc('try_lock_post_publish', {
      target_post_id: post.id,
    });

    if (lockError) {
      processed.push({ postId: post.id, ok: false, message: `lock失敗: ${lockError.message}` });
      continue;
    }
    if (!locked) {
      processed.push({ postId: post.id, ok: false, message: '別プロセスで処理中のためスキップ' });
      continue;
    }

    const runResult = await runPostPublish({
      supabaseAdmin,
      encryptionKey,
      post,
      requestedByUserId: null,
    });

    processed.push({
      postId: post.id,
      ok: runResult.ok,
      message: runResult.ok ? '投稿完了' : runResult.results.map((result) => `${result.provider}:${result.message || result.status}`).join(' / '),
    });
  }

  await supabaseAdmin.from('audit_logs').insert({
    org_id: null,
    store_id: null,
    actor_user_id: null,
    action: 'SCHEDULED_POST_PUBLISHER_RUN',
    target_type: 'scheduler',
    target_id: 'scheduled-post-publisher',
    payload: {
      due_count: postRows.length,
      processed_count: processed.length,
      success_count: processed.filter((item) => item.ok).length,
      failed_count: processed.filter((item) => !item.ok).length,
      processed,
    },
  });

  return jsonResponse(200, {
    ok: true,
    dueCount: postRows.length,
    processedCount: processed.length,
    successCount: processed.filter((item) => item.ok).length,
    failedCount: processed.filter((item) => !item.ok).length,
    processed,
  });
});
