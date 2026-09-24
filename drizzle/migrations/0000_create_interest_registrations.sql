CREATE TABLE public.interest_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  email text NOT NULL,
  email_normalized text NOT NULL,
  phone text NOT NULL,
  roles text[] NOT NULL DEFAULT '{}',
  would_use boolean NOT NULL,
  acknowledged boolean NOT NULL DEFAULT false,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  submission_count integer NOT NULL DEFAULT 1,
  user_agent text,
  ip_address text,
  referer text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX interest_registrations_email_key ON public.interest_registrations (email_normalized);
CREATE INDEX interest_registrations_submitted_at_idx ON public.interest_registrations (submitted_at DESC);
CREATE INDEX interest_registrations_would_use_idx ON public.interest_registrations (would_use);

GRANT SELECT ON public.interest_registrations TO authenticated;
GRANT ALL ON public.interest_registrations TO service_role;

ALTER TABLE public.interest_registrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read registrations"
ON public.interest_registrations
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER interest_registrations_touch
BEFORE UPDATE ON public.interest_registrations
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();