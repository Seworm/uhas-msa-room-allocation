BEGIN;

-- ============================================================
-- UHAS MSA ROOM ALLOCATION
-- Correct male room quota so Dome 31-40 count toward
-- the overall 92-room male allocation limit.
-- ============================================================


-- ------------------------------------------------------------
-- 1. Replace gender_established_room_count()
--
-- Static male-only Dome rooms (31-40) count as male rooms
-- even before their first occupant.
--
-- Other rooms count according to their dynamically established
-- gender through confirmed allocations or active holds.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.gender_established_room_count(
    p_gender TEXT
)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
SELECT count(*)
FROM public.rooms r
WHERE
    (
        upper(trim(p_gender)) = 'MALE'
        AND r.block = 'Dome'
        AND r.room_number ~ '^(3[1-9]|40)$'
    )
    OR
    (
        public.room_effective_gender(r.id) = upper(trim(p_gender))
        AND NOT (
            r.block = 'Dome'
            AND r.room_number ~ '^(3[1-9]|40)$'
        )
    );
$$;


-- ------------------------------------------------------------
-- 2. Update room availability.
--
-- The male quota now includes the permanently male-only
-- Dome rooms.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.room_is_available_to_student(
    p_room public.rooms,
    p_student_gender TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_student_gender TEXT := upper(trim(p_student_gender));
    v_room_gender TEXT;
    v_gender_room_count INTEGER;
BEGIN

    IF v_student_gender NOT IN ('MALE', 'FEMALE') THEN
        RETURN FALSE;
    END IF;


    IF NOT p_room.active
       OR NOT p_room.bookable
       OR p_room.capacity <> 4
       OR p_room.block NOT IN ('Ahoe', 'Bankoe', 'Dome', 'Hliha')
    THEN
        RETURN FALSE;
    END IF;


    -- AHOE-01 through AHOE-04 remain hidden until every
    -- other bookable room is completely full.
    IF p_room.temporarily_locked
       AND NOT public.non_locked_rooms_are_full()
    THEN
        RETURN FALSE;
    END IF;


    -- Dome 31-40 are permanently male-only.
    IF p_room.block = 'Dome'
       AND p_room.room_number ~ '^(3[1-9]|40)$'
    THEN
        IF v_student_gender <> 'MALE' THEN
            RETURN FALSE;
        END IF;
    END IF;


    v_room_gender :=
        public.room_effective_gender(p_room.id);


    -- Existing dynamically established room.
    IF v_room_gender IS NOT NULL THEN
        RETURN v_room_gender = v_student_gender;
    END IF;


    -- Empty room: enforce overall gender room quota.
    v_gender_room_count :=
        public.gender_established_room_count(v_student_gender);


    IF v_student_gender = 'FEMALE'
       AND v_gender_room_count >= 68
    THEN
        RETURN FALSE;
    END IF;


    IF v_student_gender = 'MALE'
       AND v_gender_room_count >= 92
    THEN
        RETURN FALSE;
    END IF;


    RETURN TRUE;

END;
$$;


-- ------------------------------------------------------------
-- 3. Rebuild create_room_hold so the corrected quota is
--    checked under the transaction-level advisory lock.
-- ------------------------------------------------------------

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
    r public.rooms;
    b public.beds;
    h public.holds;
    mins INTEGER;
    opened BOOLEAN;
    v_room_gender TEXT;
    v_room_count INTEGER;
BEGIN

    -- Serialize quota-sensitive allocation decisions.
    PERFORM pg_advisory_xact_lock(93746123);

    PERFORM public.cleanup_expired_holds();


    SELECT COALESCE(
        (
            SELECT value = 'true'
            FROM public.settings
            WHERE key = 'allocation_open'
        ),
        FALSE
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
        RAISE EXCEPTION
            'Student record is not linked to this account';
    END IF;


    IF s.gender IS NULL THEN
        RAISE EXCEPTION
            'Choose your gender before selecting a block';
    END IF;


    IF NOT s.eligible THEN
        RAISE EXCEPTION
            'Student is not eligible';
    END IF;


    IF EXISTS (
        SELECT 1
        FROM public.allocations
        WHERE student_id = s.id
          AND status = 'ACTIVE'
    ) THEN
        RAISE EXCEPTION
            'Student already has an active allocation';
    END IF;


    SELECT *
    INTO r
    FROM public.rooms
    WHERE id = p_room_id
    FOR UPDATE;


    IF NOT FOUND THEN
        RAISE EXCEPTION 'Room not found';
    END IF;


    IF NOT public.room_is_available_to_student(
        r,
        s.gender
    ) THEN
        RAISE EXCEPTION
            'This room is not available for your selection';
    END IF;


    v_room_gender :=
        public.room_effective_gender(r.id);


    -- Empty room: this request establishes the room gender.
    IF v_room_gender IS NULL THEN

        v_room_count :=
            public.gender_established_room_count(
                s.gender
            );


        IF s.gender = 'FEMALE'
           AND v_room_count >= 68
        THEN
            RAISE EXCEPTION
                'The female room allocation limit has been reached';
        END IF;


        IF s.gender = 'MALE'
           AND v_room_count >= 92
        THEN
            RAISE EXCEPTION
                'The male room allocation limit has been reached';
        END IF;

    ELSE

        IF v_room_gender <> s.gender THEN
            RAISE EXCEPTION
                'This room is reserved for the other gender';
        END IF;

    END IF;


    mins := COALESCE(
        (
            SELECT value::INTEGER
            FROM public.settings
            WHERE key = 'hold_minutes'
        ),
        3
    );


    SELECT x.*
    INTO b
    FROM public.beds x
    WHERE x.room_id = p_room_id
      AND x.status = 'AVAILABLE'
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
        RAISE EXCEPTION
            'No bed is currently available in this room';
    END IF;


    INSERT INTO public.holds(
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


    INSERT INTO public.audit_logs(
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
        b.id::TEXT,
        jsonb_build_object(
            'hold_id', h.id,
            'room_id', r.id,
            'room_code', r.room_code,
            'gender', s.gender
        )
    );


    RETURN jsonb_build_object(
        'hold_id', h.id,
        'bed_id', b.id,
        'room_id', r.id,
        'room_code', r.room_code,
        'bed_number', b.bed_number,
        'gender', s.gender,
        'expires_at', h.expires_at
    );

END;
$$;


-- ------------------------------------------------------------
-- 4. Ensure permissions remain correct.
-- ------------------------------------------------------------

GRANT EXECUTE
ON FUNCTION public.gender_established_room_count(TEXT)
TO authenticated;

GRANT EXECUTE
ON FUNCTION public.room_is_available_to_student(
    public.rooms,
    TEXT
)
TO authenticated;

GRANT EXECUTE
ON FUNCTION public.create_room_hold(UUID)
TO authenticated;


-- ------------------------------------------------------------
-- 5. Verification.
--
-- Dome 31-40 = 10 permanently male-only rooms.
-- Therefore only 82 additional dynamically established
-- male rooms may be established.
-- ------------------------------------------------------------

DO $$
DECLARE
    v_dome_male INTEGER;
    v_total_rooms INTEGER;
    v_total_beds INTEGER;
BEGIN

    SELECT count(*)
    INTO v_dome_male
    FROM public.rooms
    WHERE block = 'Dome'
      AND room_number ~ '^(3[1-9]|40)$'
      AND gender = 'MALE';

    IF v_dome_male <> 10 THEN
        RAISE EXCEPTION
            'Expected 10 male-only Dome rooms, found %',
            v_dome_male;
    END IF;


    SELECT count(*)
    INTO v_total_rooms
    FROM public.rooms;

    IF v_total_rooms <> 160 THEN
        RAISE EXCEPTION
            'Expected 160 rooms, found %',
            v_total_rooms;
    END IF;


    SELECT count(*)
    INTO v_total_beds
    FROM public.beds;

    IF v_total_beds <> 640 THEN
        RAISE EXCEPTION
            'Expected 640 beds, found %',
            v_total_beds;
    END IF;

END;
$$;

COMMIT;