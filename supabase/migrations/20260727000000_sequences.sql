-- ============================================================
-- Sequences: named, ordered groups of outreach examples that model
-- a multi-touch outreach arc (step 1 = cold email, step 2 = bump, ...).
-- Threads can be assigned to a sequence; follow-up drafting uses the
-- current step's example as the structural model for the draft.
-- ============================================================

CREATE TABLE public.sequences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE TRIGGER set_sequences_updated_at
  BEFORE UPDATE ON public.sequences
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Sequence membership on examples. The check is one-directional
-- (in a sequence => has a step) rather than both-or-neither, because
-- ON DELETE SET NULL only nulls the FK column; a leftover step_number
-- on a standalone example is harmless and ignored everywhere.
ALTER TABLE public.outreach_examples
  ADD COLUMN sequence_id UUID REFERENCES public.sequences(id) ON DELETE SET NULL,
  ADD COLUMN step_number INTEGER,
  ADD CONSTRAINT outreach_examples_step_in_sequence
    CHECK (sequence_id IS NULL OR (step_number IS NOT NULL AND step_number >= 1));

-- No two examples can claim the same step of a sequence.
CREATE UNIQUE INDEX idx_outreach_examples_sequence_step
  ON public.outreach_examples(sequence_id, step_number)
  WHERE sequence_id IS NOT NULL;

-- Thread assignment: sequence_step is the next step to draft (1-based).
ALTER TABLE public.watched_threads
  ADD COLUMN sequence_id UUID REFERENCES public.sequences(id) ON DELETE SET NULL,
  ADD COLUMN sequence_step INTEGER DEFAULT 1 NOT NULL CHECK (sequence_step >= 1);

CREATE INDEX idx_sequences_user ON public.sequences(user_id);

-- ============================================================
-- Row Level Security
-- ============================================================

ALTER TABLE public.sequences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own sequences"
  ON public.sequences FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Users can insert own sequences"
  ON public.sequences FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can update own sequences"
  ON public.sequences FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "Users can delete own sequences"
  ON public.sequences FOR DELETE USING (user_id = auth.uid());
