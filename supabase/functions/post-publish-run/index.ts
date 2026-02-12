import { resolveAuthenticatedUserId } from '../_shared/auth.ts';
import { jsonResponse, optionsResponse } from '../_shared/http.ts';
import { runPostPublish, loadPostForPublish } from '../_shared/postPublish.ts';
import { createServiceRoleClient, requireEnv } from '../_shared/supabase.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return optionsResponse();
  }

  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  let supabaseUrl = '';
  let serviceRoleKey = '';
  let encryptionKey = '';
  let supabaseAdmin: any;

  try {
    const runtime = createServiceRoleClient();
    supabaseUrl = runtime.supabaseUrl;
    serviceRoleKey = runtime.serviceRoleKey;
    supabaseAdmin = runtime.client;
    encryptionKey = requireEnv('PROVIDER_CONFIG_ENCRYPTION_KEY');
  } catch (error) {
    return jsonResponse(500, { error: error instanceof Error ? error.message : 'Missing env vars' });
  }

  const auth = await resolveAuthenticatedUserId(req, supabaseUrl, serviceRoleKey);
  if (!auth.userId) {
    return jsonResponse(401, { error: auth.error || 'Invalid auth token' });
  }

  let payload: { postId?: string; providers?: string[] };
  try {
    payload = await req.json();
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body' });
  }

  const postId = payload.postId?.trim();
  if (!postId) {
    return jsonResponse(400, { error: 'Missing postId' });
  }

  const post = await loadPostForPublish(supabaseAdmin, postId);
  if (!post) {
    return jsonResponse(404, { error: 'Post not found' });
  }

  const { data: memberships, error: membershipError } = await supabaseAdmin
    .from('memberships')
    .select('role')
    .eq('user_id', auth.userId)
    .eq('org_id', post.org_id);

  if (membershipError || !memberships || memberships.length === 0) {
    return jsonResponse(403, { error: 'Not allowed' });
  }

  const canPublish = memberships.some((row: { role: string }) => {
    const role = String(row.role || '').toUpperCase();
    return role === 'ADMIN' || role === 'SUPERVISOR' || role === 'MANAGER';
  });

  if (!canPublish) {
    return jsonResponse(403, { error: 'Only ADMIN/SUPERVISOR/MANAGER can publish posts' });
  }

  const { data: locked, error: lockError } = await supabaseAdmin.rpc('try_lock_post_publish', {
    target_post_id: post.id,
  });
  if (lockError) {
    return jsonResponse(400, { error: `Failed to lock post. ${lockError.message}` });
  }
  if (!locked) {
    return jsonResponse(409, { error: 'この投稿は別プロセスで処理中です。しばらく待って再実行してください。' });
  }

  const providerList = Array.isArray(payload.providers)
    ? payload.providers.map((item) => String(item || '').trim().toUpperCase()).filter(Boolean)
    : undefined;

  const runResult = await runPostPublish({
    supabaseAdmin,
    encryptionKey,
    post,
    requestedByUserId: auth.userId,
    providers: providerList,
  });

  await supabaseAdmin.from('audit_logs').insert({
    org_id: post.org_id,
    store_id: post.store_id,
    actor_user_id: auth.userId,
    action: 'POST_PUBLISH_RUN',
    target_type: 'post',
    target_id: post.id,
    payload: {
      ok: runResult.ok,
      providers: providerList || post.platforms,
      results: runResult.results,
    },
  });

  return jsonResponse(runResult.ok ? 200 : 400, {
    ok: runResult.ok,
    postId: post.id,
    results: runResult.results,
  });
});
