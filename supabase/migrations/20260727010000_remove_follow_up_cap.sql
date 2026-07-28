-- Follow-up rules no longer cap the number of drafts. A rule runs until
-- the thread gets a reply (no_reply condition dismisses it), its sequence
-- exhausts, or the user cancels it / closes the thread.
-- Apply AFTER deploying the worker that no longer reads these columns.
ALTER TABLE public.follow_up_rules
  DROP COLUMN max_follow_ups,
  DROP COLUMN current_count;
