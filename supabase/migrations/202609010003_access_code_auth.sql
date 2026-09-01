BEGIN;

-- Hash the imported one-time codes, then remove their readable database values.
ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS access_code_hash TEXT,
  ADD COLUMN IF NOT EXISTS access_code_used BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ;

UPDATE public.students
SET access_code_hash = extensions.crypt(access_code, extensions.gen_salt('bf', 6))
WHERE access_code IS NOT NULL AND access_code_hash IS NULL;

ALTER TABLE public.students ALTER COLUMN access_code DROP NOT NULL;
UPDATE public.students SET access_code = NULL WHERE access_code_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.access_login_throttles (
  request_key TEXT PRIMARY KEY,
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.access_login_throttles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.claim_student_access(
  p_student_id TEXT,
  p_access_code TEXT,
  p_auth_user_id UUID,
  p_request_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s public.students;
  v_attempts INTEGER;
  v_window_started_at TIMESTAMPTZ;
  v_normalized_student_id TEXT;
  v_normalized_access_code TEXT;
BEGIN
  IF p_auth_user_id IS NULL OR p_request_key IS NULL OR length(p_request_key) < 32 THEN
    RAISE EXCEPTION 'Invalid login request';
  END IF;

  SELECT attempts, window_started_at INTO v_attempts, v_window_started_at
  FROM public.access_login_throttles WHERE request_key = p_request_key FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.access_login_throttles (request_key, attempts) VALUES (p_request_key, 1);
  ELSIF v_window_started_at <= now() - interval '15 minutes' THEN
    UPDATE public.access_login_throttles SET attempts = 1, window_started_at = now(), updated_at = now()
    WHERE request_key = p_request_key;
  ELSIF v_attempts >= 10 THEN
    RETURN jsonb_build_object('authenticated', FALSE, 'rate_limited', TRUE);
  ELSE
    UPDATE public.access_login_throttles SET attempts = attempts + 1, updated_at = now()
    WHERE request_key = p_request_key;
  END IF;

  v_normalized_student_id := regexp_replace(upper(trim(p_student_id)), '\s+', '', 'g');
  v_normalized_access_code := regexp_replace(upper(trim(p_access_code)), '\s+', '', 'g');
  SELECT * INTO s FROM public.students
  WHERE student_id = v_normalized_student_id AND access_code_hash IS NOT NULL FOR UPDATE;

  -- A single response prevents index-number and code-use enumeration.
  IF NOT FOUND OR NOT s.eligible OR s.access_code_used
     OR extensions.crypt(v_normalized_access_code, s.access_code_hash) <> s.access_code_hash
     OR s.auth_user_id IS NOT NULL THEN
    RETURN jsonb_build_object('authenticated', FALSE);
  END IF;

  UPDATE public.students SET auth_user_id = p_auth_user_id, access_code_used = TRUE,
      activated_at = now(), updated_at = now()
  WHERE id = s.id RETURNING * INTO s;

  INSERT INTO public.audit_logs (actor_user_id, action, entity, entity_id, details)
  VALUES (p_auth_user_id, 'ACTIVATE', 'student', s.id::text,
          jsonb_build_object('student_id', s.student_id));

  RETURN jsonb_build_object('authenticated', TRUE, 'index_number', s.student_id,
                            'student_name', s.student_name);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_student_access(TEXT, TEXT, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_student_access(TEXT, TEXT, UUID, TEXT)
  TO service_role;

COMMIT;


