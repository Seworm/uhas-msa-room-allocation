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
--
-- The access code is the credential.
-- Supabase anonymous Auth only supplies an authenticated
-- session/user ID to which the verified student is bound.
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
     * This prevents two simultaneous activation attempts
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


-- ============================================================
-- Gender enforcement
--
-- NULL student gender cannot enter gender-restricted rooms.
-- Dome rooms are MALE.
-- NULL room gender means unrestricted.
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_room_hold(
    p_room_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    s public.students;
    b public.beds;
    h public.holds;
    r public.rooms;
    mins INTEGER;
    opened BOOLEAN;
BEGIN

    PERFORM public.cleanup_expired_holds();

    SELECT COALESCE(
        (
            SELECT value = 'true'
            FROM public.settings
            WHERE key = 'allocation_open'
        ),
        false
    )
    INTO opened;

    IF NOT opened THEN
        RAISE EXCEPTION 'Allocation is currently closed';
    END IF;

    SELECT *
    INTO s
    FROM public.students
    WHERE auth_user_id = auth.uid()
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Student record is not linked to this account';
    END IF;

    IF NOT s.eligible THEN
        RAISE EXCEPTION 'Student is not eligible';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.allocations
        WHERE student_id = s.id
          AND status = 'ACTIVE'
    ) THEN
        RAISE EXCEPTION 'Student already has an active allocation';
    END IF;

    /*
     * Lock the requested room.
     */
    SELECT *
    INTO r
    FROM public.rooms
    WHERE id = p_room_id
      AND active = true
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Room is not available';
    END IF;

    /*
     * Server-side gender enforcement.
     *
     * If the room is gender restricted and the student's
     * gender is unknown, deny the allocation.
     */
    IF r.gender IS NOT NULL
       AND upper(r.gender) NOT IN ('ALL', 'ANY', '') THEN

        IF s.gender IS NULL THEN
            RAISE EXCEPTION 'Student gender information is required for this room';
        END IF;

        IF upper(trim(s.gender)) <> upper(trim(r.gender)) THEN
            RAISE EXCEPTION 'Student is not eligible for this room';
        END IF;

    END IF;

    mins := COALESCE(
        (
            SELECT value::integer
            FROM public.settings
            WHERE key = 'hold_minutes'
        ),
        3
    );

    /*
     * Atomically obtain an available bed.
     */
    SELECT x.*
    INTO b
    FROM public.beds x
    JOIN public.rooms rr
      ON rr.id = x.room_id
    WHERE x.room_id = p_room_id
      AND x.status = 'AVAILABLE'
      AND rr.active = true

      AND NOT EXISTS (
          SELECT 1
          FROM public.allocations a
          WHERE a.bed_id = x.id
            AND a.status = 'ACTIVE'
      )

      AND NOT EXISTS (
          SELECT 1
          FROM public.holds z
          WHERE z.bed_id = x.id
            AND z.status = 'ACTIVE'
            AND z.expires_at > now()
      )

    ORDER BY x.bed_number
    LIMIT 1
    FOR UPDATE SKIP LOCKED;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No bed is currently available in this room';
    END IF;

    INSERT INTO public.holds (
        student_id,
        bed_id,
        expires_at
    )
    VALUES (
        s.id,
        b.id,
        now() + make_interval(mins => mins)
    )
    RETURNING *
    INTO h;

    INSERT INTO public.audit_logs (
        actor_user_id,
        action,
        entity,
        entity_id,
        details
    )
    VALUES (
        auth.uid(),
        'HOLD',
        'bed',
        b.id::text,
        jsonb_build_object(
            'hold_id', h.id,
            'room_code', r.room_code,
            'student_id', s.student_id
        )
    );

    RETURN jsonb_build_object(
        'hold_id', h.id,
        'bed_id', b.id,
        'room_code', r.room_code,
        'bed_number', b.bed_number,
        'expires_at', h.expires_at
    );

END;
$$;


-- ============================================================
-- Permissions
-- ============================================================

REVOKE ALL ON FUNCTION public.create_room_hold(UUID)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.create_room_hold(UUID)
TO authenticated;


-- ============================================================
-- Confirm allocation
-- ============================================================

CREATE OR REPLACE FUNCTION public.confirm_room_allocation(
    p_hold_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    s public.students;
    h public.holds;
    b public.beds;
    r public.rooms;
    num TEXT;
BEGIN

    PERFORM public.cleanup_expired_holds();

    SELECT *
    INTO s
    FROM public.students
    WHERE auth_user_id = auth.uid()
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Student record is not linked to this account';
    END IF;

    SELECT *
    INTO h
    FROM public.holds
    WHERE id = p_hold_id
      AND student_id = s.id
    FOR UPDATE;

    IF NOT FOUND
       OR h.status <> 'ACTIVE'
       OR h.expires_at <= now() THEN

        RAISE EXCEPTION 'Hold is invalid or expired';

    END IF;

    SELECT *
    INTO b
    FROM public.beds
    WHERE id = h.bed_id
    FOR UPDATE;

    IF b.status <> 'AVAILABLE' THEN
        RAISE EXCEPTION 'Bed is no longer available';
    END IF;

    SELECT *
    INTO r
    FROM public.rooms
    WHERE id = b.room_id;

    IF NOT r.active THEN
        RAISE EXCEPTION 'Room is no longer active';
    END IF;

    /*
     * Repeat gender validation at confirmation.
     * Never rely solely on the hold-time check.
     */
    IF r.gender IS NOT NULL
       AND upper(r.gender) NOT IN ('ALL', 'ANY', '') THEN

        IF s.gender IS NULL THEN
            RAISE EXCEPTION 'Student gender information is required for this room';
        END IF;

        IF upper(trim(s.gender)) <> upper(trim(r.gender)) THEN
            RAISE EXCEPTION 'Student is not eligible for this room';
        END IF;

    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.allocations
        WHERE student_id = s.id
          AND status = 'ACTIVE'
    ) THEN
        RAISE EXCEPTION 'Student already has an active allocation';
    END IF;

    num :=
        'UHAS-' ||
        upper(
            substr(
                replace(gen_random_uuid()::text, '-', ''),
                1,
                10
            )
        );

    INSERT INTO public.allocations (
        allocation_number,
        student_id,
        bed_id
    )
    VALUES (
        num,
        s.id,
        b.id
    );

    UPDATE public.beds
    SET status = 'OCCUPIED'
    WHERE id = b.id;

    UPDATE public.holds
    SET status = 'CONFIRMED'
    WHERE id = h.id;

    INSERT INTO public.audit_logs (
        actor_user_id,
        action,
        entity,
        entity_id,
        details
    )
    VALUES (
        auth.uid(),
        'ALLOCATE',
        'allocation',
        num,
        jsonb_build_object(
            'student_id', s.student_id,
            'room', r.room_code,
            'bed_number', b.bed_number
        )
    );

    RETURN jsonb_build_object(
        'allocation_number', num,
        'student_id', s.student_id,
        'student_name', s.student_name,
        'room_code', r.room_code,
        'block', r.block,
        'room_number', r.room_number,
        'bed_number', b.bed_number
    );

END;
$$;


REVOKE ALL ON FUNCTION public.confirm_room_allocation(UUID)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.confirm_room_allocation(UUID)
TO authenticated;


COMMIT;