BEGIN;

-- ============================================================
-- UHAS MSA ROOM ALLOCATION
-- Student activation using Index Number + One-Time Access Code
-- ============================================================

ALTER TABLE public.students
ADD COLUMN IF NOT EXISTS access_code TEXT,
ADD COLUMN IF NOT EXISTS access_code_used BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS students_access_code_unique
ON public.students(access_code)
WHERE access_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS students_student_id_normalized_idx
ON public.students (
    upper(regexp_replace(student_id, '\s+', '', 'g'))
);

-- ============================================================
-- Secure student activation
-- ============================================================

CREATE OR REPLACE FUNCTION public.activate_student(
    p_student_id TEXT,
    p_access_code TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_student public.students;
    v_student_id TEXT;
    v_access_code TEXT;
    v_auth_uid UUID;
BEGIN
    v_auth_uid := auth.uid();

    IF v_auth_uid IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
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
        upper(trim(coalesce(p_access_code, '')));

    IF v_student_id = '' OR v_access_code = '' THEN
        RAISE EXCEPTION 'Invalid index number or access code';
    END IF;

    /*
     * Lock the matching student row.
     * This prevents simultaneous activation attempts
     * from consuming the same access code.
     */
    SELECT *
    INTO v_student
    FROM public.students
    WHERE upper(regexp_replace(student_id, '\s+', '', 'g')) = v_student_id
      AND access_code = v_access_code
    FOR UPDATE;

    /*
     * Do not reveal whether the index number exists.
     */
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invalid index number or access code';
    END IF;

    IF NOT v_student.eligible THEN
        RAISE EXCEPTION 'Invalid index number or access code';
    END IF;

    /*
     * Access code may only activate one account.
     */
    IF v_student.access_code_used THEN

        /*
         * Allow the same authenticated session to continue
         * if it has already activated this student.
         */
        IF v_student.auth_user_id = v_auth_uid THEN

            RETURN jsonb_build_object(
                'success', true,
                'activated', true,
                'student_id', v_student.student_id,
                'student_name', v_student.student_name,
                'level', v_student.level,
                'programme', v_student.programme,
                'gender', v_student.gender
            );

        END IF;

        RAISE EXCEPTION 'This access code has already been used';
    END IF;

    /*
     * A student record may only belong to one Auth identity.
     */
    IF v_student.auth_user_id IS NOT NULL
       AND v_student.auth_user_id <> v_auth_uid THEN

        RAISE EXCEPTION 'This access code has already been used';

    END IF;

    /*
     * Bind the authenticated session to the student.
     */
    UPDATE public.students
    SET
        auth_user_id = v_auth_uid,
        access_code_used = TRUE,
        activated_at = now()
    WHERE id = v_student.id;

    /*
     * Record activation.
     */
    INSERT INTO public.audit_logs (
        actor_user_id,
        action,
        entity,
        entity_id,
        details
    )
    VALUES (
        v_auth_uid,
        'ACTIVATE_STUDENT',
        'student',
        v_student.id::text,
        jsonb_build_object(
            'student_id', v_student.student_id
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'activated', true,
        'student_id', v_student.student_id,
        'student_name', v_student.student_name,
        'level', v_student.level,
        'programme', v_student.programme,
        'gender', v_student.gender
    );
END;
$$;

REVOKE ALL ON FUNCTION public.activate_student(TEXT, TEXT)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.activate_student(TEXT, TEXT)
TO authenticated;

COMMIT;