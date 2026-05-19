-- Migration 006: user_preferences table for theme toggle.
-- Stores per-user UI preferences (theme: light/dark/system).

CREATE TABLE IF NOT EXISTS public.user_preferences (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  theme text NOT NULL DEFAULT 'system' CHECK (theme IN ('light', 'dark', 'system')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- RLS: each user can only read/write their own row.
ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_prefs_self_select ON public.user_preferences
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY user_prefs_self_insert ON public.user_preferences
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY user_prefs_self_update ON public.user_preferences
  FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Owner can read all (for admin views).
CREATE POLICY user_prefs_owner_select ON public.user_preferences
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND role = 'owner')
  );
