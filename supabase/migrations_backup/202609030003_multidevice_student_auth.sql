BEGIN;

-- ============================================================
-- MULTI-DEVICE STUDENT AUTHENTICATION
-- ============================================================
--
-- This migration intentionally runs AFTER the original student
-- seed and access-code hashing migrations.
--
-- The browser never receives the service-role key.
-- The unauthenticated Edge Function is the only caller of the
-- credential-verification RPC.
--
-- Access codes are verified against access_code_hash. The
-- plaintext access_code column is removed at the end.
-- ============================================================

ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS access_code_hash TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS students_auth_user_id_unique
  ON public.students(auth_user_id)
  WHERE auth_user_id IS NOT NULL;

-- The old activation RPC is no longer part of the application.
-- Remove it so there is only one authentication authority.
DROP FUNCTION IF EXISTS public.activate_student(TEXT, TEXT);
DROP FUNCTION IF EXISTS public.authenticate_student_access_code(TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.authenticate_student_access_code(
  p_student_id TEXT,
  p_access_code TEXT,
  p_request_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student public.students;
  v_key TEXT;
  v_attempts INTEGER;
  v_window_started_at TIMESTAMPTZ;
  v_student_id TEXT;
  v_access_code TEXT;
BEGIN
  v_key := trim(coalesce(p_request_key, ''));

  IF length(v_key) < 32 THEN
    RAISE EXCEPTION 'Invalid login request';
  END IF;

  v_student_id :=
    upper(
      regexp_replace(
        trim(coalesce(p_student_id, '')),
        '\s+',
        '',
        'g'
      )
    );

  v_access_code :=
    upper(
      regexp_replace(
        trim(coalesce(p_access_code, '')),
        '\s+',
        '',
        'g'
      )
    );

  IF v_student_id = '' OR v_access_code = '' THEN
    RETURN jsonb_build_object(
      'authenticated', false,
      'rate_limited', false
    );
  END IF;

  -- Atomically create the throttle row if this key has not
  -- been seen before, then lock it for this transaction.
  INSERT INTO public.access_login_throttles(
    request_key,
    attempts,
    window_started_at,
    updated_at
  )
  VALUES(
    v_key,
    0,
    now(),
    now()
  )
  ON CONFLICT (request_key) DO NOTHING;

  SELECT
    attempts,
    window_started_at
  INTO
    v_attempts,
    v_window_started_at
  FROM public.access_login_throttles
  WHERE request_key = v_key
  FOR UPDATE;

  IF v_window_started_at <= now() - interval '15 minutes' THEN
    v_attempts := 0;

    UPDATE public.access_login_throttles
    SET
      attempts = 0,
      window_started_at = now(),
      updated_at = now()
    WHERE request_key = v_key;
  END IF;

  IF v_attempts >= 10 THEN
    RETURN jsonb_build_object(
      'authenticated', false,
      'rate_limited', true
    );
  END IF;

  SELECT *
  INTO v_student
  FROM public.students
  WHERE upper(
          regexp_replace(
            student_id,
            '\s+',
            '',
            'g'
          )
        ) = v_student_id
    AND access_code_hash IS NOT NULL
  FOR UPDATE;

  IF NOT FOUND
     OR NOT v_student.eligible
     OR extensions.crypt(
          v_access_code,
          v_student.access_code_hash
        ) <> v_student.access_code_hash
  THEN
    UPDATE public.access_login_throttles
    SET
      attempts = attempts + 1,
      updated_at = now()
    WHERE request_key = v_key;

    RETURN jsonb_build_object(
      'authenticated', false,
      'rate_limited',
        (v_attempts + 1) >= 10
    );
  END IF;

  -- A successful credential verification clears the
  -- failed-attempt counter for this request key.
  UPDATE public.access_login_throttles
  SET
    attempts = 0,
    window_started_at = now(),
    updated_at = now()
  WHERE request_key = v_key;

  RETURN jsonb_build_object(
    'authenticated', true,
    'rate_limited', false,
    'student', jsonb_build_object(
      'id', v_student.id,
      'student_id', v_student.student_id,
      'student_name', v_student.student_name,
      'programme', v_student.programme,
      'level', v_student.level,
      'gender', v_student.gender,
      'eligible', v_student.eligible,
      'auth_user_id', v_student.auth_user_id
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION
  public.authenticate_student_access_code(TEXT, TEXT, TEXT)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.authenticate_student_access_code(TEXT, TEXT, TEXT)
TO service_role;

-- The old service-role-only helper is no longer required.
DROP FUNCTION IF EXISTS
  public.claim_student_access(TEXT, TEXT, UUID, TEXT);

-- Plaintext access codes are no longer required after the
-- hash-based authentication function above is installed.
ALTER TABLE public.students
  DROP COLUMN IF EXISTS access_code;

COMMIT;
