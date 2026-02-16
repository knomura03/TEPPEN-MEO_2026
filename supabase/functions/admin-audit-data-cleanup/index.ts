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

type OrgRow = {
  id: string;
  name: string | null;
  created_at: string;
};

type StoreRow = {
  id: string;
  org_id: string;
  name: string | null;
  created_at: string;
};

type BillingPlanRow = {
  id: string;
  code: string | null;
  name: string | null;
  created_at: string;
};

type AuditUserCandidate = {
  id: string;
  email: string;
  name: string | null;
  createdAt: string;
};

type CleanupResult = {
  requested: number;
  deleted: number;
  skipped: number;
  failed: number;
  errors: string[];
};

type CleanupTargets = {
  stores: boolean;
  groups: boolean;
  users: boolean;
  plans: boolean;
};

const normalizeText = (value: string | null | undefined): string => (value || '').trim();

const isAuditNamed = (value: string | null | undefined): boolean => {
  const text = normalizeText(value).toLowerCase();
  if (!text) return false;
  return text.includes('[audit]') || text.includes('audit');
};

const chunk = <T>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    out.push(items.slice(index, index + size));
  }
  return out;
};

const deleteByIds = async (params: {
  table: 'stores' | 'organizations' | 'billing_plans';
  ids: string[];
  supabaseAdmin: ReturnType<typeof createClient>;
}): Promise<CleanupResult> => {
  if (params.ids.length === 0) {
    return { requested: 0, deleted: 0, skipped: 0, failed: 0, errors: [] };
  }
  const batches = chunk(params.ids, 100);
  const deletedIds = new Set<string>();
  const errors: string[] = [];
  let failed = 0;

  for (const batch of batches) {
    const { data, error } = await params.supabaseAdmin
      .from(params.table)
      .delete()
      .in('id', batch)
      .select('id');
    if (error) {
      failed += batch.length;
      errors.push(`[${params.table}] ${error.code || 'unknown'}: ${error.message || 'delete failed'}`);
      continue;
    }
    (data || []).forEach((row) => {
      const id = String((row as { id?: string }).id || '');
      if (id) deletedIds.add(id);
    });
  }

  const deleted = deletedIds.size;
  const skipped = Math.max(params.ids.length - deleted - failed, 0);
  return {
    requested: params.ids.length,
    deleted,
    skipped,
    failed,
    errors,
  };
};

const listAllAuthUsers = async (supabaseAdmin: ReturnType<typeof createClient>) => {
  const out: Array<{ id: string; email?: string; created_at?: string }> = [];
  const perPage = 200;
  for (let page = 1; page < 1000; page += 1) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(error.message);
    const users = Array.isArray(data?.users) ? data.users : [];
    users.forEach((user) => out.push(user));
    if (users.length < perPage) break;
  }
  return out;
};

const resolveTargets = (input: unknown): CleanupTargets => {
  const defaults: CleanupTargets = {
    stores: true,
    groups: true,
    users: false,
    plans: false,
  };
  if (!input || typeof input !== 'object') return defaults;
  const row = input as Record<string, unknown>;
  return {
    stores: row.stores === undefined ? defaults.stores : row.stores === true,
    groups: row.groups === undefined ? defaults.groups : row.groups === true,
    users: row.users === true,
    plans: row.plans === true,
  };
};

const normalizeResult = (requested: number): CleanupResult => ({
  requested,
  deleted: 0,
  skipped: requested,
  failed: 0,
  errors: [],
});

const ensureFreePlanId = async (supabaseAdmin: ReturnType<typeof createClient>, actorUserId: string): Promise<string> => {
  const { data: existingPlan, error: selectError } = await supabaseAdmin
    .from('billing_plans')
    .select('id')
    .eq('code', 'FREE')
    .limit(1)
    .maybeSingle();
  if (selectError) throw new Error(selectError.message);
  if (existingPlan?.id) return String(existingPlan.id);

  const { data: insertedPlan, error: insertError } = await supabaseAdmin
    .from('billing_plans')
    .insert({
      code: 'FREE',
      name: 'Free',
      amount_monthly: 0,
      currency: 'JPY',
      is_active: true,
      description: 'Default free plan',
      feature_rules: {},
      sns_connection_limit: 3,
      created_by: actorUserId,
      updated_by: actorUserId,
    })
    .select('id')
    .single();
  if (insertError || !insertedPlan?.id) {
    throw new Error(insertError?.message || 'FREE plan create failed');
  }
  return String(insertedPlan.id);
};

const deleteAuditUsers = async (params: {
  supabaseAdmin: ReturnType<typeof createClient>;
  actorUserId: string;
  candidates: AuditUserCandidate[];
}): Promise<CleanupResult> => {
  const result: CleanupResult = normalizeResult(params.candidates.length);
  result.deleted = 0;
  result.skipped = 0;
  for (const candidate of params.candidates) {
    if (candidate.id === params.actorUserId) {
      result.skipped += 1;
      continue;
    }
    const { error } = await params.supabaseAdmin.auth.admin.deleteUser(candidate.id);
    if (error) {
      result.failed += 1;
      result.errors.push(`[users] ${candidate.email}: ${error.message}`);
      continue;
    }
    result.deleted += 1;
  }
  result.skipped += Math.max(result.requested - result.deleted - result.failed - result.skipped, 0);
  return result;
};

const deleteAuditPlans = async (params: {
  supabaseAdmin: ReturnType<typeof createClient>;
  actorUserId: string;
  planIds: string[];
}): Promise<CleanupResult> => {
  const result: CleanupResult = normalizeResult(params.planIds.length);
  if (params.planIds.length === 0) return result;

  try {
    const freePlanId = await ensureFreePlanId(params.supabaseAdmin, params.actorUserId);

    const { error: storeSubscriptionUpdateError } = await params.supabaseAdmin
      .from('store_subscriptions')
      .update({ billing_plan_id: freePlanId, updated_by: params.actorUserId })
      .in('billing_plan_id', params.planIds);
    if (storeSubscriptionUpdateError && !String(storeSubscriptionUpdateError.message || '').includes('does not exist')) {
      result.errors.push(`[plans] store_subscriptions update failed: ${storeSubscriptionUpdateError.message}`);
    }

    const { error: orgSubscriptionUpdateError } = await params.supabaseAdmin
      .from('org_subscriptions')
      .update({ billing_plan_id: freePlanId, updated_by: params.actorUserId })
      .in('billing_plan_id', params.planIds);
    if (orgSubscriptionUpdateError && !String(orgSubscriptionUpdateError.message || '').includes('does not exist')) {
      result.errors.push(`[plans] org_subscriptions update failed: ${orgSubscriptionUpdateError.message}`);
    }

    const { error: storeScheduleDeleteError } = await params.supabaseAdmin
      .from('store_subscription_plan_schedules')
      .delete()
      .in('billing_plan_id', params.planIds);
    if (storeScheduleDeleteError && !String(storeScheduleDeleteError.message || '').includes('does not exist')) {
      result.errors.push(`[plans] store schedules delete failed: ${storeScheduleDeleteError.message}`);
    }

    const { error: orgScheduleDeleteError } = await params.supabaseAdmin
      .from('org_subscription_plan_schedules')
      .delete()
      .in('billing_plan_id', params.planIds);
    if (orgScheduleDeleteError && !String(orgScheduleDeleteError.message || '').includes('does not exist')) {
      result.errors.push(`[plans] org schedules delete failed: ${orgScheduleDeleteError.message}`);
    }

    const deleteResult = await deleteByIds({
      table: 'billing_plans',
      ids: params.planIds,
      supabaseAdmin: params.supabaseAdmin,
    });
    result.deleted = deleteResult.deleted;
    result.failed = deleteResult.failed;
    result.skipped = deleteResult.skipped;
    result.errors.push(...deleteResult.errors);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    return {
      requested: params.planIds.length,
      deleted: 0,
      skipped: 0,
      failed: params.planIds.length,
      errors: [`[plans] ${message}`],
    };
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

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { data: actorMemberships, error: actorMembershipError } = await supabaseAdmin
    .from('memberships')
    .select('role')
    .eq('user_id', actorUserId);
  if (actorMembershipError) {
    return jsonResponse(400, { error: actorMembershipError.message });
  }
  const isAdmin = (actorMemberships || []).some((row) => String((row as { role?: string }).role || '').toUpperCase() === 'ADMIN');
  if (!isAdmin) {
    return jsonResponse(403, { error: 'Only ADMIN can run audit cleanup' });
  }

  let payload: {
    apply?: boolean;
    includeStoreIds?: string[];
    includeOrgIds?: string[];
    includeUserIds?: string[];
    includePlanIds?: string[];
    cleanupTargets?: Partial<CleanupTargets>;
  } = {};
  try {
    payload = await req.json();
  } catch {
    payload = {};
  }
  const apply = payload.apply === true;
  const targets = resolveTargets(payload.cleanupTargets);

  const { data: orgData, error: orgError } = await supabaseAdmin
    .from('organizations')
    .select('id, name, created_at')
    .order('created_at', { ascending: false });
  if (orgError) return jsonResponse(400, { error: orgError.message });

  const { data: storeData, error: storeError } = await supabaseAdmin
    .from('stores')
    .select('id, org_id, name, created_at')
    .order('created_at', { ascending: false });
  if (storeError) return jsonResponse(400, { error: storeError.message });

  const organizations = (orgData || []) as OrgRow[];
  const stores = (storeData || []) as StoreRow[];

  const { data: planData, error: planError } = await supabaseAdmin
    .from('billing_plans')
    .select('id, code, name, created_at')
    .order('created_at', { ascending: false });
  if (planError) return jsonResponse(400, { error: planError.message });

  const plans = (planData || []) as BillingPlanRow[];

  const { data: profileData, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('id, name, email');
  if (profileError) return jsonResponse(400, { error: profileError.message });
  const profileMap = new Map<string, { name: string | null; email: string | null }>();
  (profileData || []).forEach((row) => {
    const typed = row as { id?: string; name?: string | null; email?: string | null };
    const id = String(typed.id || '');
    if (!id) return;
    profileMap.set(id, {
      name: typed.name || null,
      email: typed.email || null,
    });
  });

  const { data: adminMembershipData, error: adminMembershipError } = await supabaseAdmin
    .from('memberships')
    .select('user_id')
    .eq('role', 'ADMIN');
  if (adminMembershipError) return jsonResponse(400, { error: adminMembershipError.message });
  const adminUserIds = new Set(
    (adminMembershipData || [])
      .map((row) => String((row as { user_id?: string }).user_id || ''))
      .filter(Boolean)
  );

  let authUsers: Array<{ id: string; email?: string; created_at?: string }> = [];
  try {
    authUsers = await listAllAuthUsers(supabaseAdmin);
  } catch (error) {
    return jsonResponse(400, { error: error instanceof Error ? error.message : 'Failed to list auth users' });
  }

  const auditGroups = organizations.filter((org) => isAuditNamed(org.name));
  const auditGroupIdSet = new Set(auditGroups.map((org) => org.id));
  const auditStores = stores.filter((store) => isAuditNamed(store.name) || auditGroupIdSet.has(store.org_id));
  const auditPlans = plans.filter((plan) => {
    const code = normalizeText(plan.code).toUpperCase();
    if (code === 'FREE') return false;
    return isAuditNamed(plan.code) || isAuditNamed(plan.name);
  });

  const auditUsers = authUsers
    .map((authUser) => {
      const profile = profileMap.get(authUser.id);
      const email = normalizeText(authUser.email || profile?.email).toLowerCase();
      const name = normalizeText(profile?.name).toLowerCase();
      const matched = isAuditNamed(email) || isAuditNamed(name);
      if (!matched) return null;
      if (adminUserIds.has(authUser.id)) return null;
      return {
        id: authUser.id,
        email: normalizeText(authUser.email || profile?.email),
        name: profile?.name || null,
        createdAt: String(authUser.created_at || ''),
      } as AuditUserCandidate;
    })
    .filter((item): item is AuditUserCandidate => Boolean(item));

  const selectedStoreIds = Array.isArray(payload.includeStoreIds) && payload.includeStoreIds.length > 0
    ? new Set(payload.includeStoreIds.map((item) => String(item || '')))
    : null;
  const selectedOrgIds = Array.isArray(payload.includeOrgIds) && payload.includeOrgIds.length > 0
    ? new Set(payload.includeOrgIds.map((item) => String(item || '')))
    : null;
  const selectedUserIds = Array.isArray(payload.includeUserIds) && payload.includeUserIds.length > 0
    ? new Set(payload.includeUserIds.map((item) => String(item || '')))
    : null;
  const selectedPlanIds = Array.isArray(payload.includePlanIds) && payload.includePlanIds.length > 0
    ? new Set(payload.includePlanIds.map((item) => String(item || '')))
    : null;

  const storeIds = auditStores
    .map((store) => store.id)
    .filter((id) => (selectedStoreIds ? selectedStoreIds.has(id) : true));
  const orgIds = auditGroups
    .map((org) => org.id)
    .filter((id) => (selectedOrgIds ? selectedOrgIds.has(id) : true));
  const userIds = auditUsers
    .map((user) => user.id)
    .filter((id) => (selectedUserIds ? selectedUserIds.has(id) : true));
  const planIds = auditPlans
    .map((plan) => plan.id)
    .filter((id) => (selectedPlanIds ? selectedPlanIds.has(id) : true));

  const storesResult =
    targets.stores && apply
      ? await deleteByIds({ table: 'stores', ids: storeIds, supabaseAdmin })
      : normalizeResult(targets.stores ? storeIds.length : 0);
  const groupsResult =
    targets.groups && apply
      ? await deleteByIds({ table: 'organizations', ids: orgIds, supabaseAdmin })
      : normalizeResult(targets.groups ? orgIds.length : 0);
  const usersResult =
    targets.users && apply
      ? await deleteAuditUsers({
          supabaseAdmin,
          actorUserId,
          candidates: auditUsers.filter((user) => userIds.includes(user.id)),
        })
      : normalizeResult(targets.users ? userIds.length : 0);
  const plansResult =
    targets.plans && apply
      ? await deleteAuditPlans({
          supabaseAdmin,
          actorUserId,
          planIds,
        })
      : normalizeResult(targets.plans ? planIds.length : 0);

  await supabaseAdmin.from('audit_logs').insert({
    actor_user_id: actorUserId,
    action: apply ? 'AUDIT_DATA_CLEANUP_APPLY' : 'AUDIT_DATA_CLEANUP_DRYRUN',
    target_type: 'audit_cleanup',
    target_id: null,
    payload: {
      targets,
      stores_requested: storesResult.requested,
      stores_deleted: storesResult.deleted,
      groups_requested: groupsResult.requested,
      groups_deleted: groupsResult.deleted,
      users_requested: usersResult.requested,
      users_deleted: usersResult.deleted,
      plans_requested: plansResult.requested,
      plans_deleted: plansResult.deleted,
    },
  });

  return jsonResponse(200, {
    ok: true,
    apply,
    targets,
    summary: {
      stores: storesResult,
      groups: groupsResult,
      users: usersResult,
      plans: plansResult,
    },
    candidates: {
      groups: auditGroups
        .filter((org) => orgIds.includes(org.id))
        .map((org) => ({ id: org.id, name: org.name, createdAt: org.created_at })),
      stores: auditStores
        .filter((store) => storeIds.includes(store.id))
        .map((store) => ({ id: store.id, orgId: store.org_id, name: store.name, createdAt: store.created_at })),
      users: auditUsers
        .filter((user) => userIds.includes(user.id))
        .map((user) => ({ id: user.id, email: user.email, name: user.name, createdAt: user.createdAt })),
      plans: auditPlans
        .filter((plan) => planIds.includes(plan.id))
        .map((plan) => ({ id: plan.id, code: plan.code, name: plan.name, createdAt: plan.created_at })),
    },
  });
});
