-- ============================================================
-- Row Level Security Policies
-- ============================================================
-- Every table is locked down so users can only access their own data.
-- The Cloudflare Worker uses the service_role key for background jobs
-- (cron sync, follow-up processing), which bypasses RLS.
-- ============================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.watched_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.thread_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.follow_up_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scheduled_follow_ups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outreach_examples ENABLE ROW LEVEL SECURITY;

-- profiles: keyed on id = auth.uid()
CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT USING (id = auth.uid());
CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE USING (id = auth.uid());
CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT WITH CHECK (id = auth.uid());

-- leads
CREATE POLICY "Users can view own leads"
  ON public.leads FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Users can insert own leads"
  ON public.leads FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can update own leads"
  ON public.leads FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "Users can delete own leads"
  ON public.leads FOR DELETE USING (user_id = auth.uid());

-- templates
CREATE POLICY "Users can view own templates"
  ON public.templates FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Users can insert own templates"
  ON public.templates FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can update own templates"
  ON public.templates FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "Users can delete own templates"
  ON public.templates FOR DELETE USING (user_id = auth.uid());

-- watched_threads
CREATE POLICY "Users can view own threads"
  ON public.watched_threads FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Users can insert own threads"
  ON public.watched_threads FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can update own threads"
  ON public.watched_threads FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "Users can delete own threads"
  ON public.watched_threads FOR DELETE USING (user_id = auth.uid());

-- thread_messages: access gated through thread ownership
CREATE POLICY "Users can view own thread messages"
  ON public.thread_messages FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.watched_threads wt
      WHERE wt.id = thread_messages.thread_id AND wt.user_id = auth.uid()
    )
  );
CREATE POLICY "Users can insert own thread messages"
  ON public.thread_messages FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.watched_threads wt
      WHERE wt.id = thread_messages.thread_id AND wt.user_id = auth.uid()
    )
  );
CREATE POLICY "Users can delete own thread messages"
  ON public.thread_messages FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.watched_threads wt
      WHERE wt.id = thread_messages.thread_id AND wt.user_id = auth.uid()
    )
  );

-- follow_up_rules
CREATE POLICY "Users can view own follow-up rules"
  ON public.follow_up_rules FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Users can insert own follow-up rules"
  ON public.follow_up_rules FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can update own follow-up rules"
  ON public.follow_up_rules FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "Users can delete own follow-up rules"
  ON public.follow_up_rules FOR DELETE USING (user_id = auth.uid());

-- scheduled_follow_ups
CREATE POLICY "Users can view own scheduled follow-ups"
  ON public.scheduled_follow_ups FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Users can insert own scheduled follow-ups"
  ON public.scheduled_follow_ups FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can update own scheduled follow-ups"
  ON public.scheduled_follow_ups FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "Users can delete own scheduled follow-ups"
  ON public.scheduled_follow_ups FOR DELETE USING (user_id = auth.uid());

-- outreach_examples
CREATE POLICY "Users can view own examples"
  ON public.outreach_examples FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Users can insert own examples"
  ON public.outreach_examples FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can update own examples"
  ON public.outreach_examples FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "Users can delete own examples"
  ON public.outreach_examples FOR DELETE USING (user_id = auth.uid());
