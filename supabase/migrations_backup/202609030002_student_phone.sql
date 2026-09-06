BEGIN;

-- ============================================================
-- STUDENT PHONE NUMBERS
-- ============================================================

ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS phone_number TEXT;

COMMENT ON COLUMN public.students.phone_number
  IS 'Student phone number. Private personal information; not exposed to roommates.';


-- ============================================================
-- SAVE / UPDATE CURRENT STUDENT PHONE NUMBER
-- ============================================================

CREATE OR REPLACE FUNCTION public.update_student_phone(
  p_phone TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phone TEXT;
  v_student_id UUID;
BEGIN
  v_phone := trim(coalesce(p_phone, ''));

  IF v_phone = '' THEN
    RAISE EXCEPTION 'Phone number is required';
  END IF;

  /*
    Ghanaian mobile numbers:

      0241234567
      0201234567
      0501234567
      0541234567
      +233241234567

    The first digit after 0 / +233 must be a valid Ghana
    mobile-network prefix digit.
  */
  IF v_phone !~ '^(0[2356789][0-9]{8}|\+233[2356789][0-9]{8})$' THEN
    RAISE EXCEPTION 'Enter a valid Ghanaian phone number';
  END IF;

  SELECT id
    INTO v_student_id
  FROM public.students
  WHERE auth_user_id = auth.uid()
  FOR UPDATE;

  IF v_student_id IS NULL THEN
    RAISE EXCEPTION 'Student account is not activated';
  END IF;

  UPDATE public.students
  SET
    phone_number = v_phone,
    updated_at = now()
  WHERE id = v_student_id;

  RETURN v_phone;
END;
$$;


-- ============================================================
-- GET CURRENT STUDENT PHONE NUMBER
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_student_phone()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_phone TEXT;
BEGIN
  SELECT phone_number
    INTO v_phone
  FROM public.students
  WHERE auth_user_id = auth.uid();

  RETURN v_phone;
END;
$$;


-- ============================================================
-- SECURITY
-- ============================================================

REVOKE ALL ON FUNCTION public.update_student_phone(TEXT)
  FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.get_student_phone()
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.update_student_phone(TEXT)
  TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_student_phone()
  TO authenticated;


COMMIT;