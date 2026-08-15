-- ============================================================
-- LeadLoop v2: no-AI sequencer.
-- Sequences become ordered TEMPLATES (steps move from
-- outreach_examples to templates, same column pattern). Runs
-- (watched_threads) carry their own {{variable}} values.
-- Leads, follow-up rules, and everything pgvector go away.
-- ============================================================

-- 1. Templates are sequence steps: a per-step delay plus the same
--    membership pattern sequences used on outreach_examples.
--    The check is one-directional (in a sequence => has a step)
--    because ON DELETE SET NULL only nulls the FK; a leftover
--    step_number on a standalone template is harmless and ignored.
ALTER TABLE public.templates
  ADD COLUMN delay_days INTEGER NOT NULL DEFAULT 3 CHECK (delay_days >= 0),
  ADD COLUMN sequence_id UUID REFERENCES public.sequences(id) ON DELETE SET NULL,
  ADD COLUMN step_number INTEGER,
  ADD CONSTRAINT templates_step_in_sequence
    CHECK (sequence_id IS NULL OR (step_number IS NOT NULL AND step_number >= 1));

-- No two templates can claim the same step of a sequence.
CREATE UNIQUE INDEX idx_templates_sequence_step
  ON public.templates(sequence_id, step_number)
  WHERE sequence_id IS NOT NULL;

-- 2. Runs carry the variable values used to render their steps
--    (filled at enrollment; leads are gone).
ALTER TABLE public.watched_threads
  ADD COLUMN variables JSONB DEFAULT '{}' NOT NULL,
  DROP COLUMN lead_id;

-- 3. Examples are a GTM analysis corpus now, not an AI retrieval
--    index. Dropping the columns drops their indexes (hnsw +
--    sequence-step unique). sequence_id stays: it now records
--    which sequence produced the win.
DROP FUNCTION public.match_outreach_examples;
ALTER TABLE public.outreach_examples
  DROP CONSTRAINT outreach_examples_step_in_sequence,
  DROP COLUMN step_number,
  DROP COLUMN embedding;
DROP EXTENSION vector;

-- 4. The sequence IS the follow-up rule now. Cancel in-flight
--    HITL follow-ups and drop the rules machinery.
UPDATE public.scheduled_follow_ups
  SET status = 'dismissed', acted_at = now()
  WHERE status = 'pending';
ALTER TABLE public.scheduled_follow_ups DROP COLUMN rule_id;
DROP TABLE public.follow_up_rules;
DROP TABLE public.leads;
