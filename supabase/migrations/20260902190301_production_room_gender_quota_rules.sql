BEGIN;

-- ============================================================
-- UHAS MSA ROOM ALLOCATION
-- Production room gender, gender quotas and staged Ahoe rooms
--
-- FINAL INVENTORY:
--   160 rooms
--   4 beds per room
--   640 beds
--
-- GENDER:
--   Empty room = gender neutral
--   First confirmed occupant establishes room gender
--   Active hold temporarily establishes room gender
--
-- QUOTAS:
--   Female = maximum 68 established rooms
--   Male   = maximum 92 established rooms
--
-- STAGED ROOMS:
--   AHOE-01 through AHOE-04 are initially locked.
--   They open automatically after every other room is 4/4 full.
-- ============================================================


-- ------------------------------------------------------------
-- 1. Add temporary room lock state.
-- ------------------------------------------------------------

ALTER TABLE public.rooms
ADD COLUMN IF NOT EXISTS temporarily_locked BOOLEAN NOT NULL DEFAULT FALSE;


-- ------------------------------------------------------------
-- 2. The final inventory contains all 160 rooms.
--    All rooms are bookable.
--
--    This intentionally supersedes the earlier Hliha
--    restriction from migration 005.
-- ------------------------------------------------------------

ALTER TABLE public.rooms
DROP CONSTRAINT IF EXISTS rooms_reserved_policy_check;

UPDATE public.rooms
SET bookable = TRUE
WHERE active = TRUE;


-- ------------------------------------------------------------
-- 3. Normalize static room policy.
--
--    Ordinary rooms remain gender-neutral in the rooms table.
--    Dome 31-40 remain permanently male-only.
-- ------------------------------------------------------------

UPDATE public.rooms
SET gender =
    CASE
        WHEN block = 'Dome'
         AND room_number ~ '^(3[1-9]|40)$'
        THEN 'MALE'
        ELSE 'ALL'
    END;


-- ------------------------------------------------------------
-- 4. Safety checks before applying production rules.
-- ------------------------------------------------------------

DO $$
DECLARE
    v_rooms INTEGER;
    v_beds INTEGER;
    v_ahoe INTEGER;
BEGIN
    SELECT count(*)
    INTO v_rooms
    FROM public.rooms;

    IF v_rooms <> 160 THEN
        RAISE EXCEPTION
            'Production inventory error: expected 160 rooms, found %',
            v_rooms;
    END IF;

    SELECT count(*)
    INTO v_beds
    FROM public.beds;

    IF v_beds <> 640 THEN
        RAISE EXCEPTION
            'Production inventory error: expected 640 beds, found %',
            v_beds;
    END IF;

    SELECT count(*)
    INTO v_ahoe
    FROM public.rooms
    WHERE block = 'Ahoe';

    IF v_ahoe < 4 THEN
        RAISE EXCEPTION
            'Production inventory error: fewer than four Ahoe rooms exist';
    END IF;
END
$$;


-- ------------------------------------------------------------
-- 5. Reset the temporary-lock flags and lock the first four
--    Ahoe rooms by numeric room number.
--
--    This makes the initial locked rooms:
--       AHOE-01
--       AHOE-02
--       AHOE-03
--       AHOE-04
--
--    provided those room codes exist as expected.
-- ------------------------------------------------------------

UPDATE public.rooms
SET temporarily_locked = FALSE;

WITH locked_ahoe AS (
    SELECT id
    FROM public.rooms
    WHERE block = 'Ahoe'
      AND room_number ~ '^[0-9]+$'
    ORDER BY room_number::INTEGER, room_code
    LIMIT 4
)
UPDATE public.rooms r
SET temporarily_locked = TRUE
FROM locked_ahoe l
WHERE r.id = l.id;


-- ------------------------------------------------------------
-- 6. Verify the four staged Ahoe rooms.
-- ------------------------------------------------------------

DO $$
DECLARE
    v_locked INTEGER;
BEGIN
    SELECT count(*)
    INTO v_locked
    FROM public.rooms
    WHERE block = 'Ahoe'
      AND temporarily_locked = TRUE;

    IF v_locked <> 4 THEN
        RAISE EXCEPTION
            'Expected exactly 4 temporarily locked Ahoe rooms, found %',
            v_locked;
    END IF;
END
$$;


-- ------------------------------------------------------------
-- 7. Effective room gender.
--
--    NULL  = room has no established gender yet.
--    MALE  = room is established as male.
--    FEMALE = room is established as female.
--
--    Confirmed allocations take precedence.
--    If there are no confirmed allocations, active holds establish
--    the temporary room gender.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.room_effective_gender(
    p_room_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_min_gender TEXT;
    v_max_gender TEXT;
    v_hold_min_gender TEXT;
    v_hold_max_gender TEXT;
BEGIN

    -- Confirmed/active allocations determine permanent room gender.
    SELECT
        MIN(s.gender),
        MAX(s.gender)
    INTO
        v_min_gender,
        v_max_gender
    FROM public.allocations a
    JOIN public.students s
      ON s.id = a.student_id
    JOIN public.beds b
      ON b.id = a.bed_id
    WHERE a.status = 'ACTIVE'
      AND b.room_id = p_room_id;

    IF v_min_gender IS NOT NULL THEN

        IF v_min_gender <> v_max_gender THEN
            RAISE EXCEPTION
                'Room % contains conflicting active genders',
                p_room_id;
        END IF;

        RETURN v_min_gender;
    END IF;


    -- No confirmed occupant yet.
    -- Active holds temporarily establish the room gender.
    SELECT
        MIN(s.gender),
        MAX(s.gender)
    INTO
        v_hold_min_gender,
        v_hold_max_gender
    FROM public.holds h
    JOIN public.students s
      ON s.id = h.student_id
    JOIN public.beds b
      ON b.id = h.bed_id
    WHERE h.status = 'ACTIVE'
      AND h.expires_at > now()
      AND b.room_id = p_room_id;

    IF v_hold_min_gender IS NOT NULL THEN

        IF v_hold_min_gender <> v_hold_max_gender THEN
            RAISE EXCEPTION
                'Room % contains conflicting active hold genders',
                p_room_id;
        END IF;

        RETURN v_hold_min_gender;
    END IF;


    RETURN NULL;
END;
$$;


-- ------------------------------------------------------------
-- 8. Determine whether all non-locked rooms are completely full.
--
--    This is the condition that unlocks the four Ahoe rooms.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.non_locked_rooms_are_full()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT NOT EXISTS (
        SELECT 1
        FROM public.rooms r
        WHERE r.active = TRUE
          AND r.bookable = TRUE
          AND r.temporarily_locked = FALSE
          AND (
              SELECT count(*)
              FROM public.beds b
              WHERE b.room_id = r.id
                AND b.status = 'OCCUPIED'
          ) < 4
    );
$$;


-- ------------------------------------------------------------
-- 9. Count rooms currently established for a gender.
--
--    Confirmed allocations count.
--    Active holds also count while they are active.
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
    WHERE public.room_effective_gender(r.id) = upper(trim(p_gender));
$$;


-- ------------------------------------------------------------
-- 10. Determine whether a room can be used by a student.
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


    -- The four staged Ahoe rooms stay hidden until every other
    -- room has four confirmed occupants.
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


    -- Existing room: only the same gender may enter.
    IF v_room_gender IS NOT NULL THEN
        RETURN v_room_gender = v_student_gender;
    END IF;


    -- Empty room: enforce the gender room quota.
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
-- 11. Replace room availability RPC.
--
--    The frontend supplies the selected hostel block.
-- ------------------------------------------------------------

DROP FUNCTION IF EXISTS
    public.available_rooms_for_current_student();

CREATE OR REPLACE FUNCTION public.available_rooms_for_current_student(
    p_block TEXT
)
RETURNS TABLE (
    id UUID,
    room_code TEXT,
    block TEXT,
    floor TEXT,
    room_number TEXT,
    capacity INTEGER,
    room_type TEXT,
    gender TEXT,
    available_beds BIGINT,
    occupied_beds BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_gender TEXT;
    v_block TEXT := initcap(trim(p_block));
BEGIN

    IF v_block NOT IN ('Ahoe', 'Bankoe', 'Dome', 'Hliha') THEN
        RAISE EXCEPTION 'Invalid hostel block';
    END IF;


    SELECT s.gender
    INTO v_gender
    FROM public.students s
    WHERE s.auth_user_id = auth.uid();


    IF v_gender IS NULL THEN
        RAISE EXCEPTION
            'Choose your gender before selecting a block';
    END IF;


    RETURN QUERY
    SELECT
        r.id,
        r.room_code,
        r.block,
        r.floor,
        r.room_number,
        r.capacity,
        r.room_type,
        COALESCE(
            public.room_effective_gender(r.id),
            CASE
                WHEN r.block = 'Dome'
                 AND r.room_number ~ '^(3[1-9]|40)$'
                THEN 'MALE'
                ELSE 'OPEN'
            END
        ) AS gender,
        COUNT(
            b.id
        ) FILTER (
            WHERE b.status = 'AVAILABLE'
              AND NOT EXISTS (
                  SELECT 1
                  FROM public.holds h
                  WHERE h.bed_id = b.id
                    AND h.status = 'ACTIVE'
                    AND h.expires_at > now()
              )
              AND NOT EXISTS (
                  SELECT 1
                  FROM public.allocations a
                  WHERE a.bed_id = b.id
                    AND a.status = 'ACTIVE'
              )
        ) AS available_beds,
        COUNT(
            b.id
        ) FILTER (
            WHERE b.status = 'OCCUPIED'
        ) AS occupied_beds
    FROM public.rooms r
    JOIN public.beds b
      ON b.room_id = r.id
    WHERE r.block = v_block
      AND public.room_is_available_to_student(
          r,
          v_gender
      )
    GROUP BY r.id
    HAVING COUNT(
        b.id
    ) FILTER (
        WHERE b.status = 'AVAILABLE'
          AND NOT EXISTS (
              SELECT 1
              FROM public.holds h
              WHERE h.bed_id = b.id
                AND h.status = 'ACTIVE'
                AND h.expires_at > now()
          )
          AND NOT EXISTS (
              SELECT 1
              FROM public.allocations a
              WHERE a.bed_id = b.id
                AND a.status = 'ACTIVE'
          )
    ) > 0
    ORDER BY
        CASE
            WHEN r.block = 'Ahoe'
             AND r.temporarily_locked
            THEN 1
            ELSE 0
        END,
        CASE
            WHEN r.room_number ~ '^[0-9]+$'
            THEN r.room_number::INTEGER
            ELSE 999999
        END,
        r.room_code;
END;
$$;


-- ------------------------------------------------------------
-- 12. Rebuild create_room_hold with:
--
--     - gender compatibility
--     - female 68-room cap
--     - male 92-room cap
--     - temporary Ahoe lock
--     - active-hold gender protection
--     - concurrency protection
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


    -- If the room is empty, this request would establish
    -- its gender. Re-check the quota under the advisory lock.
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
-- 13. Rebuild confirmation with the same protections.
-- ------------------------------------------------------------

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
    v_room_gender TEXT;
BEGIN

    -- Same global serialization used by hold creation.
    PERFORM pg_advisory_xact_lock(93746123);

    PERFORM public.cleanup_expired_holds();


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


    SELECT *
    INTO h
    FROM public.holds
    WHERE id = p_hold_id
      AND student_id = s.id
    FOR UPDATE;


    IF NOT FOUND
       OR h.status <> 'ACTIVE'
       OR h.expires_at <= now()
    THEN
        RAISE EXCEPTION
            'Hold is invalid or expired';
    END IF;


    SELECT *
    INTO b
    FROM public.beds
    WHERE id = h.bed_id
    FOR UPDATE;


    IF b.status <> 'AVAILABLE' THEN
        RAISE EXCEPTION
            'Bed is no longer available';
    END IF;


    SELECT *
    INTO r
    FROM public.rooms
    WHERE id = b.room_id
    FOR UPDATE;


    IF NOT FOUND
       OR NOT r.active
       OR NOT r.bookable
    THEN
        RAISE EXCEPTION
            'Room is no longer available';
    END IF;


    IF r.temporarily_locked
       AND NOT public.non_locked_rooms_are_full()
    THEN
        RAISE EXCEPTION
            'This room is temporarily locked';
    END IF;


    -- Dome 31-40 remain male-only.
    IF r.block = 'Dome'
       AND r.room_number ~ '^(3[1-9]|40)$'
       AND s.gender <> 'MALE'
    THEN
        RAISE EXCEPTION
            'This room is available to male students only';
    END IF;


    v_room_gender :=
        public.room_effective_gender(r.id);


    -- A room already occupied/held by the opposite gender
    -- cannot be confirmed.
    IF v_room_gender IS NOT NULL
       AND v_room_gender <> s.gender
    THEN
        RAISE EXCEPTION
            'This room is no longer available for your gender';
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


    num :=
        'UHAS-' ||
        upper(
            substr(
                replace(gen_random_uuid()::TEXT, '-', ''),
                1,
                10
            )
        );


    INSERT INTO public.allocations(
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


    INSERT INTO public.audit_logs(
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
            'block', r.block,
            'bed_number', b.bed_number,
            'gender', s.gender
        )
    );


    RETURN jsonb_build_object(
        'allocation_number', num,
        'student_id', s.student_id,
        'student_name', s.student_name,
        'room_code', r.room_code,
        'block', r.block,
        'room_number', r.room_number,
        'bed_number', b.bed_number,
        'gender', s.gender
    );
END;
$$;


-- ------------------------------------------------------------
-- 14. Permissions.
-- ------------------------------------------------------------

GRANT EXECUTE
ON FUNCTION public.room_effective_gender(UUID)
TO authenticated;

GRANT EXECUTE
ON FUNCTION public.non_locked_rooms_are_full()
TO authenticated;

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
ON FUNCTION public.available_rooms_for_current_student(TEXT)
TO authenticated;

GRANT EXECUTE
ON FUNCTION public.create_room_hold(UUID)
TO authenticated;

GRANT EXECUTE
ON FUNCTION public.confirm_room_allocation(UUID)
TO authenticated;


-- ------------------------------------------------------------
-- 15. Production verification.
-- ------------------------------------------------------------

DO $$
DECLARE
    v_rooms INTEGER;
    v_beds INTEGER;
    v_locked INTEGER;
    v_bookable INTEGER;
BEGIN

    SELECT count(*)
    INTO v_rooms
    FROM public.rooms;

    SELECT count(*)
    INTO v_beds
    FROM public.beds;

    SELECT count(*)
    INTO v_locked
    FROM public.rooms
    WHERE temporarily_locked = TRUE;

    SELECT count(*)
    INTO v_bookable
    FROM public.rooms
    WHERE bookable = TRUE;


    IF v_rooms <> 160 THEN
        RAISE EXCEPTION
            'Verification failed: rooms = %, expected 160',
            v_rooms;
    END IF;

    IF v_beds <> 640 THEN
        RAISE EXCEPTION
            'Verification failed: beds = %, expected 640',
            v_beds;
    END IF;

    IF v_locked <> 4 THEN
        RAISE EXCEPTION
            'Verification failed: temporarily locked rooms = %, expected 4',
            v_locked;
    END IF;

    IF v_bookable <> 160 THEN
        RAISE EXCEPTION
            'Verification failed: bookable rooms = %, expected 160',
            v_bookable;
    END IF;

END
$$;


COMMIT;