BEGIN;

-- ============================================================
-- UHAS ASOGLI HALL ROOM ALLOCATION
-- ADMIN REPORTING & DASHBOARD
-- ============================================================

-- ------------------------------------------------------------
-- 1. Dashboard summary
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_dashboard_summary()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_result JSONB;
BEGIN

    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Administrator access required';
    END IF;

    SELECT jsonb_build_object(

        'students', jsonb_build_object(
            'total',
                (SELECT count(*) FROM public.students),
            'eligible',
                (SELECT count(*)
                 FROM public.students
                 WHERE eligible = true),
            'activated',
                (SELECT count(*)
                 FROM public.students
                 WHERE auth_user_id IS NOT NULL),
            'allocated',
                (SELECT count(*)
                 FROM public.allocations
                 WHERE status = 'ACTIVE'),
            'unallocated',
                (
                    SELECT count(*)
                    FROM public.students s
                    WHERE s.eligible = true
                    AND NOT EXISTS (
                        SELECT 1
                        FROM public.allocations a
                        WHERE a.student_id = s.id
                        AND a.status = 'ACTIVE'
                    )
                )
        ),

        'rooms', jsonb_build_object(
            'total',
                (SELECT count(*)
                 FROM public.rooms
                 WHERE active = true),

            'bookable',
                (SELECT count(*)
                 FROM public.rooms
                 WHERE active = true
                 AND bookable = true),

            'full',
                (
                    SELECT count(*)
                    FROM public.rooms r
                    WHERE r.active = true
                    AND (
                        SELECT count(*)
                        FROM public.beds b
                        WHERE b.room_id = r.id
                        AND b.status = 'OCCUPIED'
                    ) >= r.capacity
                ),

            'with_vacancy',
                (
                    SELECT count(*)
                    FROM public.rooms r
                    WHERE r.active = true
                    AND (
                        SELECT count(*)
                        FROM public.beds b
                        WHERE b.room_id = r.id
                        AND b.status = 'OCCUPIED'
                    ) < r.capacity
                )
        ),

        'beds', jsonb_build_object(
            'total',
                (SELECT count(*)
                 FROM public.beds),

            'occupied',
                (SELECT count(*)
                 FROM public.beds
                 WHERE status = 'OCCUPIED'),

            'available',
                (SELECT count(*)
                 FROM public.beds
                 WHERE status = 'AVAILABLE'),

            'maintenance',
                (SELECT count(*)
                 FROM public.beds
                 WHERE status = 'MAINTENANCE')
        ),

        'holds', jsonb_build_object(
            'active',
                (
                    SELECT count(*)
                    FROM public.holds
                    WHERE status = 'ACTIVE'
                    AND expires_at > now()
                )
        ),

        'gender', jsonb_build_object(
            'male',
                (
                    SELECT count(*)
                    FROM public.allocations a
                    JOIN public.students s
                      ON s.id = a.student_id
                    WHERE a.status = 'ACTIVE'
                    AND upper(s.gender) = 'MALE'
                ),

            'female',
                (
                    SELECT count(*)
                    FROM public.allocations a
                    JOIN public.students s
                      ON s.id = a.student_id
                    WHERE a.status = 'ACTIVE'
                    AND upper(s.gender) = 'FEMALE'
                )
        ),

        'allocation_open',
            COALESCE(
                (
                    SELECT value = 'true'
                    FROM public.settings
                    WHERE key = 'allocation_open'
                ),
                false
            )

    )
    INTO v_result;

    RETURN v_result;

END;
$$;


-- ------------------------------------------------------------
-- 2. Room report
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_rooms(
    p_block TEXT DEFAULT NULL
)
RETURNS TABLE (
    room_id UUID,
    room_code TEXT,
    block TEXT,
    floor TEXT,
    room_number TEXT,
    capacity INTEGER,
    room_gender TEXT,
    active BOOLEAN,
    bookable BOOLEAN,
    temporarily_locked BOOLEAN,
    occupied_beds BIGINT,
    available_beds BIGINT,
    occupancy_percent INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN

    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Administrator access required';
    END IF;

    RETURN QUERY

    SELECT
        r.id,
        r.room_code,
        r.block,
        r.floor,
        r.room_number,
        r.capacity,
        r.gender,
        r.active,
        r.bookable,
        r.temporarily_locked,

        count(*) FILTER (
            WHERE b.status = 'OCCUPIED'
        ) AS occupied_beds,

        count(*) FILTER (
            WHERE b.status = 'AVAILABLE'
        ) AS available_beds,

        CASE
            WHEN r.capacity > 0 THEN
                round(
                    (
                        count(*) FILTER (
                            WHERE b.status = 'OCCUPIED'
                        )::numeric
                        / r.capacity
                    ) * 100
                )::integer
            ELSE 0
        END AS occupancy_percent

    FROM public.rooms r

    LEFT JOIN public.beds b
        ON b.room_id = r.id

    WHERE
        r.active = true
        AND (
            p_block IS NULL
            OR r.block = p_block
        )

    GROUP BY
        r.id,
        r.room_code,
        r.block,
        r.floor,
        r.room_number,
        r.capacity,
        r.gender,
        r.active,
        r.bookable,
        r.temporarily_locked

    ORDER BY
        CASE r.block
            WHEN 'Ahoe' THEN 1
            WHEN 'Bankoe' THEN 2
            WHEN 'Dome' THEN 3
            WHEN 'Hliha' THEN 4
            ELSE 5
        END,
        r.room_number;

END;
$$;


-- ------------------------------------------------------------
-- 3. Room occupants
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_room_occupants(
    p_room_id UUID
)
RETURNS TABLE (
    bed_number INTEGER,
    student_id TEXT,
    student_name TEXT,
    level TEXT,
    programme TEXT,
    gender TEXT,
    email TEXT,
    allocation_number TEXT,
    allocated_at TIMESTAMPTZ,
    allocation_status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN

    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Administrator access required';
    END IF;

    RETURN QUERY

    SELECT
        b.bed_number,
        s.student_id,
        s.student_name,
        s.level,
        s.programme,
        s.gender,
        s.email,
        a.allocation_number,
        a.allocated_at,
        a.status::TEXT

    FROM public.beds b

    LEFT JOIN public.allocations a
        ON a.bed_id = b.id
        AND a.status = 'ACTIVE'

    LEFT JOIN public.students s
        ON s.id = a.student_id

    WHERE b.room_id = p_room_id

    ORDER BY b.bed_number;

END;
$$;


-- ------------------------------------------------------------
-- 4. Student allocation report
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_student_allocations(
    p_search TEXT DEFAULT NULL,
    p_block TEXT DEFAULT NULL,
    p_gender TEXT DEFAULT NULL
)
RETURNS TABLE (
    student_id TEXT,
    student_name TEXT,
    level TEXT,
    programme TEXT,
    gender TEXT,
    email TEXT,
    block TEXT,
    room_code TEXT,
    room_number TEXT,
    floor TEXT,
    bed_number INTEGER,
    allocation_number TEXT,
    allocated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN

    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Administrator access required';
    END IF;

    RETURN QUERY

    SELECT
        s.student_id,
        s.student_name,
        s.level,
        s.programme,
        s.gender,
        s.email,
        r.block,
        r.room_code,
        r.room_number,
        r.floor,
        b.bed_number,
        a.allocation_number,
        a.allocated_at

    FROM public.allocations a

    JOIN public.students s
        ON s.id = a.student_id

    JOIN public.beds b
        ON b.id = a.bed_id

    JOIN public.rooms r
        ON r.id = b.room_id

    WHERE
        a.status = 'ACTIVE'

        AND (
            p_search IS NULL
            OR p_search = ''
            OR s.student_id ILIKE '%' || p_search || '%'
            OR s.student_name ILIKE '%' || p_search || '%'
            OR a.allocation_number ILIKE '%' || p_search || '%'
        )

        AND (
            p_block IS NULL
            OR p_block = ''
            OR r.block = p_block
        )

        AND (
            p_gender IS NULL
            OR p_gender = ''
            OR upper(s.gender) = upper(p_gender)
        )

    ORDER BY
        r.block,
        r.room_number,
        b.bed_number;

END;
$$;


-- ------------------------------------------------------------
-- 5. Unallocated eligible students
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_unallocated_students(
    p_search TEXT DEFAULT NULL
)
RETURNS TABLE (
    student_id TEXT,
    student_name TEXT,
    level TEXT,
    programme TEXT,
    gender TEXT,
    email TEXT,
    activated BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN

    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Administrator access required';
    END IF;

    RETURN QUERY

    SELECT
        s.student_id,
        s.student_name,
        s.level,
        s.programme,
        s.gender,
        s.email,
        (s.auth_user_id IS NOT NULL) AS activated

    FROM public.students s

    WHERE
        s.eligible = true

        AND NOT EXISTS (
            SELECT 1
            FROM public.allocations a
            WHERE a.student_id = s.id
            AND a.status = 'ACTIVE'
        )

        AND (
            p_search IS NULL
            OR p_search = ''
            OR s.student_id ILIKE '%' || p_search || '%'
            OR s.student_name ILIKE '%' || p_search || '%'
        )

    ORDER BY s.student_name;

END;
$$;


-- ------------------------------------------------------------
-- 6. Audit log
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_audit_logs(
    p_limit INTEGER DEFAULT 200
)
RETURNS TABLE (
    id BIGINT,
    actor_user_id UUID,
    action TEXT,
    entity TEXT,
    entity_id TEXT,
    details JSONB,
    created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN

    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Administrator access required';
    END IF;

    RETURN QUERY

    SELECT
        l.id,
        l.actor_user_id,
        l.action,
        l.entity,
        l.entity_id,
        l.details,
        l.created_at

    FROM public.audit_logs l

    ORDER BY l.created_at DESC

    LIMIT LEAST(GREATEST(COALESCE(p_limit, 200), 1), 1000);

END;
$$;


-- ------------------------------------------------------------
-- 7. Grant RPC execution to authenticated users.
--
-- The functions themselves enforce administrator access.
-- ------------------------------------------------------------

GRANT EXECUTE ON FUNCTION public.admin_dashboard_summary()
    TO authenticated;

GRANT EXECUTE ON FUNCTION public.admin_rooms(TEXT)
    TO authenticated;

GRANT EXECUTE ON FUNCTION public.admin_room_occupants(UUID)
    TO authenticated;

GRANT EXECUTE ON FUNCTION public.admin_student_allocations(TEXT, TEXT, TEXT)
    TO authenticated;

GRANT EXECUTE ON FUNCTION public.admin_unallocated_students(TEXT)
    TO authenticated;

GRANT EXECUTE ON FUNCTION public.admin_audit_logs(INTEGER)
    TO authenticated;


COMMIT;