-- Sequences absorb templates: a sequence carries its follow-up emails inline
-- as a JSONB steps array [{body, delay_days}, ...] (array order = step order,
-- watched_threads.sequence_step is a 1-based index into it). Subjects are gone:
-- follow-up drafts always thread as "Re: <original subject>".

ALTER TABLE public.sequences ADD COLUMN steps JSONB NOT NULL DEFAULT '[]'
  CHECK (jsonb_typeof(steps) = 'array');

-- Port any steps wired through the old templates table.
UPDATE public.sequences s SET steps = COALESCE((
  SELECT jsonb_agg(jsonb_build_object('body', t.body, 'delay_days', t.delay_days)
                   ORDER BY t.step_number)
  FROM public.templates t WHERE t.sequence_id = s.id), '[]');

DROP TABLE public.templates;
