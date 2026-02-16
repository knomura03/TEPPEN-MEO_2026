import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { resolveAuthenticatedUserId } from '../_shared/auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const jsonResponse = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });

type AppRole = 'ADMIN' | 'SUPERVISOR' | 'MANAGER' | 'USER';
type DeleteMode = 'REMOVE_FROM_ORG' | 'FULL_DELETE';

const roleRank: Record<AppRole, number> = {
  ADMIN: 4,
  SUPERVISOR: 3,
  MANAGER: 2,
  USER: 1,
};

const normalizeRole = (raw: unknown): AppRole | null => {
  const role = String(raw || '').trim().toUpperCase();
  if (role === 'ADMIN' || role === 'SUPERVISOR' || role === 'MANAGER' || role === 'USER') return role;
  return null;
};

const highestRoleFromRows = (rows: Array<{ role?: string }>): AppRole | null => {
  const roles = rows
    .map((row) => normalizeRole(row.role))
    .filter((role): role is AppRole => Boolean(role));
  if (roles.length === 0) return null;
  return roles.reduce((best, next) => (roleRank[next] > roleRank[best] ? next : best), roles[0]);
};

const canManageRole = (actorRole: AppRole, targetRole: AppRole): boolean => {
  if (actorRole === 'ADMIN') return true;
  if (actorRole === 'SUPERVISOR') return targetRole === 'MANAGER' || targetRole === 'USER';
  if (actorRole === 'MANAGER') return targetRole === 'USER';
  return false;
};

const normalizeMode = (raw: unknown): DeleteMode | null => {
  const mode = String(raw || '').trim().toUpperCase();
  if (mode === 'REMOVE_FROM_ORG' || mode === 'FULL_DELETE') return mode;
  return null;
};

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const toBase64Url = (bytes: Uint8Array): string => {
  const binary = Array.from(bytes)
    .map((charCode) => String.fromCharCode(charCode))
    .join('');
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

const fromBase64Url = (value: string): Uint8Array => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padLength = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + '='.repeat(padLength);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};

const signPayload = async (payloadBase64Url: string, secret: string): Promise<string> => {
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, textEncoder.encode(payloadBase64Url));
  return toBase64Url(new Uint8Array(signature));
};

type ConfirmPayload = {
  orgId: string;
  targetUserId: string;
  actorUserId: string;
  mode: DeleteMode;
  exp: number;
};

const issueConfirmToken = async (
  payload: ConfirmPayload,
  secret: string
): Promise<{ token: string; expiresAt: string }> => {
  const payloadBase64 = toBase64Url(textEncoder.encode(JSON.stringify(payload)));
  const signature = await signPayload(payloadBase64, secret);
  return {
    token: `${payloadBase64}.${signature}`,
    expiresAt: new Date(payload.exp).toISOString(),
  };
};

const verifyConfirmToken = async (
  token: string,
  expected: Omit<ConfirmPayload, 'exp'>,
  secret: string
): Promise<{ ok: boolean; message?: string }> => {
  const [payloadPart, signaturePart] = token.split('.');
  if (!payloadPart || !signaturePart) {
    return { ok: false, message: 'Invalid confirmToken format' };
  }
  const expectedSignature = await signPayload(payloadPart, secret);
  if (expectedSignature !== signaturePart) {
    return { ok: false, message: 'Invalid confirmToken signature' };
  }
  try {
    const payload = JSON.parse(textDecoder.decode(fromBase64Url(payloadPart))) as ConfirmPayload;
    if (payload.exp < Date.now()) {
      return { ok: false, message: 'confirmToken expired' };
    }
    if (
      payload.orgId !== expected.orgId ||
      payload.targetUserId !== expected.targetUserId ||
      payload.actorUserId !== expected.actorUserId ||
      payload.mode !== expected.mode
    ) {
      return { ok: false, message: 'confirmToken payload mismatch' };
    }
    return { ok: true };
  } catch {
    return { ok: false, message: 'Invalid confirmToken payload' };
  }
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

  let payload: {
    orgId?: string;
    targetUserId?: string;
    mode?: DeleteMode;
    confirmToken?: string;
  };
  try {
    payload = await req.json();
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body' });
  }

  const orgId = String(payload.orgId || '').trim();
  const targetUserId = String(payload.targetUserId || '').trim();
  const mode = normalizeMode(payload.mode);
  const confirmToken = String(payload.confirmToken || '').trim();

  if (!orgId || !targetUserId || !mode) {
    return jsonResponse(400, { error: 'Missing required fields' });
  }
  if (actorUserId === targetUserId) {
    return jsonResponse(400, { error: 'Cannot delete yourself' });
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { data: actorMemberships, error: actorMembershipError } = await supabaseAdmin
    .from('memberships')
    .select('role')
    .eq('user_id', actorUserId)
    .eq('org_id', orgId);
  if (actorMembershipError || !actorMemberships || actorMemberships.length === 0) {
    return jsonResponse(403, { error: 'Not allowed' });
  }
  const actorHighestRole = highestRoleFromRows(actorMemberships as Array<{ role?: string }>);
  if (!actorHighestRole) {
    return jsonResponse(403, { error: 'Not allowed' });
  }

  const { data: targetMemberships, error: targetMembershipError } = await supabaseAdmin
    .from('memberships')
    .select('role')
    .eq('user_id', targetUserId)
    .eq('org_id', orgId);
  if (targetMembershipError) {
    return jsonResponse(400, { error: targetMembershipError.message });
  }
  if (!targetMemberships || targetMemberships.length === 0) {
    return jsonResponse(404, { error: 'Target user membership not found in this org' });
  }
  const targetHighestRole = highestRoleFromRows(targetMemberships as Array<{ role?: string }>);
  if (!targetHighestRole) {
    return jsonResponse(404, { error: 'Target role not found' });
  }

  if (!canManageRole(actorHighestRole, targetHighestRole)) {
    return jsonResponse(403, { error: `Role ${actorHighestRole} cannot manage ${targetHighestRole}` });
  }

  if (mode === 'REMOVE_FROM_ORG') {
    const { error: membershipDeleteError } = await supabaseAdmin
      .from('memberships')
      .delete()
      .eq('org_id', orgId)
      .eq('user_id', targetUserId);
    if (membershipDeleteError) {
      return jsonResponse(400, { error: membershipDeleteError.message });
    }

    await supabaseAdmin.from('audit_logs').insert({
      org_id: orgId,
      actor_user_id: actorUserId,
      action: 'USER_REMOVED_FROM_ORG',
      target_type: 'user',
      target_id: targetUserId,
      payload: {
        org_id: orgId,
        target_user_id: targetUserId,
        mode,
      },
    });

    return jsonResponse(200, {
      ok: true,
      mode,
      targetUserId,
      orgId,
    });
  }

  if (actorHighestRole !== 'ADMIN') {
    return jsonResponse(403, { error: 'Only ADMIN can fully delete users' });
  }

  const confirmSecret = Deno.env.get('USER_DELETE_CONFIRM_SECRET') || serviceRoleKey;
  if (!confirmToken) {
    const confirmPayload: ConfirmPayload = {
      orgId,
      targetUserId,
      actorUserId,
      mode,
      exp: Date.now() + 10 * 60 * 1000,
    };
    const issued = await issueConfirmToken(confirmPayload, confirmSecret);
    return jsonResponse(409, {
      ok: false,
      error: 'CONFIRM_REQUIRED',
      message: '完全削除の確認が必要です。同じconfirmTokenで再実行してください。',
      confirmToken: issued.token,
      expiresAt: issued.expiresAt,
    });
  }

  const verified = await verifyConfirmToken(confirmToken, { orgId, targetUserId, actorUserId, mode }, confirmSecret);
  if (!verified.ok) {
    return jsonResponse(400, {
      error: verified.message || 'Invalid confirmToken',
    });
  }

  const { count: otherOrgMembershipCount, error: otherOrgMembershipError } = await supabaseAdmin
    .from('memberships')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', targetUserId)
    .neq('org_id', orgId);
  if (otherOrgMembershipError) {
    return jsonResponse(400, { error: otherOrgMembershipError.message });
  }
  if ((otherOrgMembershipCount || 0) > 0) {
    return jsonResponse(400, {
      error: 'Target user belongs to other organizations. Remove those memberships first.',
    });
  }

  await supabaseAdmin.from('audit_logs').insert({
    org_id: orgId,
    actor_user_id: actorUserId,
    action: 'USER_FULL_DELETED',
    target_type: 'user',
    target_id: targetUserId,
    payload: {
      org_id: orgId,
      target_user_id: targetUserId,
      mode,
    },
  });

  const { error: deleteUserError } = await supabaseAdmin.auth.admin.deleteUser(targetUserId);
  if (deleteUserError) {
    return jsonResponse(400, { error: deleteUserError.message });
  }

  return jsonResponse(200, {
    ok: true,
    mode,
    targetUserId,
    orgId,
  });
});
