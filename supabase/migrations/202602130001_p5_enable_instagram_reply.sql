-- P5: Instagram返信を有効化（provider_capabilities.can_reply）
-- 目的:
-- - INSTAGRAM の返信API実装に合わせて、reply権限を有効化する

update public.provider_capabilities as capability
set
  can_reply = true,
  updated_at = now()
from public.provider_catalog as catalog
where capability.provider_catalog_id = catalog.id
  and catalog.provider_key = 'INSTAGRAM'
  and capability.can_reply is distinct from true;
