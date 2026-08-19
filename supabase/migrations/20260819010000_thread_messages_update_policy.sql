-- thread_messages had SELECT/INSERT/DELETE policies but no UPDATE policy,
-- so re-syncing an already-synced thread with the user-scoped client
-- (dashboard send-drafts / manual sync) failed on the upsert's
-- ON CONFLICT DO UPDATE. Same ownership rule as the other policies.

CREATE POLICY "Users can update own thread messages" ON public.thread_messages
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.watched_threads wt
      WHERE wt.id = thread_messages.thread_id AND wt.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.watched_threads wt
      WHERE wt.id = thread_messages.thread_id AND wt.user_id = auth.uid()
    )
  );
