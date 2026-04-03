-- ============================================================
-- LeadLoop V1 Core Schema
-- ============================================================

-- Trigger function for auto-updating updated_at columns
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Auto-create a profile row when a new user signs up via Supabase Auth
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, gmail_email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', ''),
    COALESCE(NEW.email, '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- Tables
-- ============================================================

-- Extends auth.users with LeadLoop-specific profile data
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  gmail_email TEXT,
  gmail_refresh_token TEXT,
  gmail_token_expires_at TIMESTAMPTZ,
  settings JSONB DEFAULT '{}' NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE TABLE public.leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT,
  company TEXT,
  title TEXT,
  source TEXT DEFAULT 'manual' NOT NULL,
  custom_fields JSONB DEFAULT '{}' NOT NULL,
  status TEXT DEFAULT 'active' NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  UNIQUE(user_id, email)
);

CREATE TABLE public.templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  subject TEXT,
  body TEXT NOT NULL,
  category TEXT,
  variables TEXT[] DEFAULT '{}',
  is_active BOOLEAN DEFAULT true NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE TABLE public.watched_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  gmail_thread_id TEXT NOT NULL,
  lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  subject TEXT,
  status TEXT DEFAULT 'active' NOT NULL,
  last_gmail_history_id TEXT,
  last_synced_at TIMESTAMPTZ,
  last_activity_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  UNIQUE(user_id, gmail_thread_id)
);

CREATE TABLE public.thread_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID NOT NULL REFERENCES public.watched_threads(id) ON DELETE CASCADE,
  gmail_message_id TEXT NOT NULL UNIQUE,
  direction TEXT NOT NULL CHECK (direction IN ('sent', 'received')),
  from_email TEXT,
  to_email TEXT,
  subject TEXT,
  body_text TEXT,
  snippet TEXT,
  sent_at TIMESTAMPTZ,
  synced_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE TABLE public.follow_up_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID NOT NULL REFERENCES public.watched_threads(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  delay_days INTEGER NOT NULL DEFAULT 3,
  condition TEXT DEFAULT 'no_reply' NOT NULL,
  template_id UUID REFERENCES public.templates(id) ON DELETE SET NULL,
  max_follow_ups INTEGER DEFAULT 3 NOT NULL,
  current_count INTEGER DEFAULT 0 NOT NULL,
  status TEXT DEFAULT 'active' NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE TABLE public.scheduled_follow_ups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID NOT NULL REFERENCES public.follow_up_rules(id) ON DELETE CASCADE,
  thread_id UUID NOT NULL REFERENCES public.watched_threads(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  scheduled_for TIMESTAMPTZ NOT NULL,
  status TEXT DEFAULT 'pending' NOT NULL,
  draft_gmail_id TEXT,
  generated_body TEXT,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  acted_at TIMESTAMPTZ
);

-- Curated successful outreach examples used for retrieval-augmented reply suggestions
CREATE TABLE public.outreach_examples (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  context TEXT NOT NULL,
  subject TEXT,
  body TEXT NOT NULL,
  outcome TEXT,
  tags TEXT[] DEFAULT '{}',
  embedding VECTOR(1536),
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- ============================================================
-- Indexes
-- ============================================================

CREATE INDEX idx_leads_user_status ON public.leads(user_id, status);
CREATE INDEX idx_templates_user_active ON public.templates(user_id, is_active);
CREATE INDEX idx_watched_threads_user_status ON public.watched_threads(user_id, status);
CREATE INDEX idx_watched_threads_needs_sync ON public.watched_threads(status, last_synced_at)
  WHERE status = 'active';
CREATE INDEX idx_thread_messages_thread_time ON public.thread_messages(thread_id, sent_at);
CREATE INDEX idx_follow_up_rules_thread ON public.follow_up_rules(thread_id, status);
CREATE INDEX idx_scheduled_followups_due ON public.scheduled_follow_ups(scheduled_for, status)
  WHERE status = 'pending';
CREATE INDEX idx_scheduled_followups_user ON public.scheduled_follow_ups(user_id, status);
CREATE INDEX idx_outreach_examples_user ON public.outreach_examples(user_id);
CREATE INDEX idx_outreach_examples_embedding ON public.outreach_examples
  USING hnsw (embedding vector_cosine_ops);

-- ============================================================
-- Triggers
-- ============================================================

CREATE TRIGGER set_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER set_leads_updated_at
  BEFORE UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER set_templates_updated_at
  BEFORE UPDATE ON public.templates
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Auto-create profile on signup
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
