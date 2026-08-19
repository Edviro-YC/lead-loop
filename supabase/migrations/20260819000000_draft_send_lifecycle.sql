-- Draft/send lifecycle hardening: crash-safe leases + a closed status domain.
-- Live status values at migration time were only pending/draft_created
-- (verified 2026-08-18), so the constraint validates without normalization.

ALTER TABLE public.scheduled_follow_ups
  ADD COLUMN lease_expires_at TIMESTAMPTZ;

ALTER TABLE public.scheduled_follow_ups
  ADD CONSTRAINT scheduled_follow_ups_status_check CHECK (status IN (
    'pending',        -- waiting for its due time
    'drafting',       -- leased by the draft consumer
    'draft_created',  -- Gmail draft exists, unsent
    'sending',        -- leased by an explicit send action
    'sent',           -- sent by LeadLoop (explicit dashboard/MCP action)
    'superseded',     -- a manual outgoing message replaced this draft
    'draft_missing',  -- Gmail 404 with no send evidence; blocks the cadence
    'dismissed'       -- reply/stop/completion cleanup
  ));
