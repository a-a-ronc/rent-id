ALTER TABLE public.interest_registrations
  ADD COLUMN IF NOT EXISTS current_units integer,
  ADD COLUMN IF NOT EXISTS intended_units integer;