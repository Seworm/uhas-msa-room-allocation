BEGIN;

CREATE OR REPLACE FUNCTION public.admin_dashboard_summary()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_total_rooms bigint;
    v_bookable_rooms bigint;
    v_full_rooms bigint;
    v_rooms_with_vacancy bigint;

    v_total_beds bigint;
    v_occupied_beds bigint;
    v_available_beds bigint;
    v_maintenance_beds bigint;

    v_total_students bigint;
    v_eligible_students bigint;
    v_activated_students bigint;
    v_allocated_students bigint;
    v_unallocated_students bigint;

    v_active_holds bigint;
    v_active_allocations bigint;

    v_male_students bigint;
    v_female_students bigint;

    v_allocation_open boolean;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Not authorised';
    END IF;

    SELECT
        COUNT(*),
        COUNT(*) FILTER (WHERE bookable = true),
        COUNT(*) FILTER (
            WHERE bookable = true
            AND NOT EXISTS (
                SELECT 1
                FROM public.beds b
                WHERE b.room_id = r.id
                  AND b.status = 'AVAILABLE'
            )
        ),
        COUNT(*) FILTER (
            WHERE bookable = true
            AND EXISTS (
                SELECT 1
                FROM public.beds b
                WHERE b.room_id = r.id
                  AND b.status = 'AVAILABLE'
            )
        )
    INTO
        v_total_rooms,
        v_bookable_rooms,
        v_full_rooms,
        v_rooms_with_vacancy
    FROM public.rooms r
    WHERE r.active = true;

    SELECT
        COUNT(*),
        COUNT(*) FILTER (WHERE status = 'OCCUPIED'),
        COUNT(*) FILTER (WHERE status = 'AVAILABLE'),
        COUNT(*) FILTER (WHERE status = 'MAINTENANCE')
    INTO
        v_total_beds,
        v_occupied_beds,
        v_available_beds,
        v_maintenance_beds
    FROM public.beds;

    SELECT
        COUNT(*),
        COUNT(*) FILTER (WHERE eligible = true),
        COUNT(*) FILTER (WHERE access_code_activated_at IS NOT NULL),
        COUNT(DISTINCT a.student_id) FILTER (WHERE a.status = 'ACTIVE'),
        COUNT(*) FILTER (
            WHERE eligible = true
            AND NOT EXISTS (
                SELECT 1
                FROM public.allocations a2
                WHERE a2.student_id = s.id
                  AND a2.status = 'ACTIVE'
            )
        )
    INTO
        v_total_students,
        v_eligible_students,
        v_activated_students,
        v_allocated_students,
        v_unallocated_students
    FROM public.students s
    LEFT JOIN public.allocations a
        ON a.student_id = s.id
       AND a.status = 'ACTIVE';

    SELECT COUNT(*)
    INTO v_active_holds
    FROM public.holds
    WHERE status = 'ACTIVE'
      AND expires_at > now();

    SELECT COUNT(*)
    INTO v_active_allocations
    FROM public.allocations
    WHERE status = 'ACTIVE';

    SELECT COUNT(*)
    INTO v_male_students
    FROM public.students
    WHERE eligible = true
      AND UPPER(gender) = 'MALE';

    SELECT COUNT(*)
    INTO v_female_students
    FROM public.students
    WHERE eligible = true
      AND UPPER(gender) = 'FEMALE';

    SELECT COALESCE(
        (
            SELECT value::boolean
            FROM public.settings
            WHERE key = 'allocation_open'
            LIMIT 1
        ),
        false
    )
    INTO v_allocation_open;

    RETURN jsonb_build_object(
        'students', jsonb_build_object(
            'total', v_total_students,
            'eligible', v_eligible_students,
            'activated', v_activated_students,
            'allocated', v_allocated_students,
            'unallocated', v_unallocated_students
        ),
        'rooms', jsonb_build_object(
            'total', v_total_rooms,
            'bookable', v_bookable_rooms,
            'full', v_full_rooms,
            'with_vacancy', v_rooms_with_vacancy
        ),
        'beds', jsonb_build_object(
            'total', v_total_beds,
            'occupied', v_occupied_beds,
            'available', v_available_beds,
            'maintenance', v_maintenance_beds
        ),
        'holds', jsonb_build_object(
            'active', v_active_holds
        ),
        'allocations', jsonb_build_object(
            'active', v_active_allocations
        ),
        'gender', jsonb_build_object(
            'male', v_male_students,
            'female', v_female_students
        ),
        'allocation_open', v_allocation_open
    );
END;
$$;


DROP FUNCTION IF EXISTS public.admin_rooms(text);

CREATE FUNCTION public.admin_rooms(p_block text DEFAULT NULL)
RETURNS TABLE (
    room_id uuid,
    room_code text,
    block text,
    floor text,
    room_number text,
    capacity integer,
    room_gender text,
    active boolean,
    bookable boolean,
    temporarily_locked boolean,
    occupied_beds bigint,
    available_beds bigint,
    occupancy_percent integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Not authorised';
    END IF;

    RETURN QUERY
    SELECT
        r.id AS room_id,
        r.room_code,
        r.block,
        r.floor,
        r.room_number,
        r.capacity,

        CASE
            WHEN UPPER(COALESCE(r.gender_rule, '')) = 'MALE'
                THEN 'Male'
            WHEN UPPER(COALESCE(r.gender, '')) = 'MALE'
                THEN 'Male'
            WHEN UPPER(COALESCE(r.gender, '')) = 'FEMALE'
                THEN 'Female'
            WHEN COUNT(s.id) FILTER (
                WHERE UPPER(s.gender) = 'MALE'
            ) > 0
            AND COUNT(s.id) FILTER (
                WHERE UPPER(s.gender) = 'FEMALE'
            ) > 0
                THEN 'Mixed'
            WHEN COUNT(s.id) FILTER (
                WHERE UPPER(s.gender) = 'MALE'
            ) > 0
                THEN 'Male'
            WHEN COUNT(s.id) FILTER (
                WHERE UPPER(s.gender) = 'FEMALE'
            ) > 0
                THEN 'Female'
            ELSE 'Neutral'
        END AS room_gender,

        r.active,
        r.bookable,
        r.temporarily_locked,

        COUNT(b.id) FILTER (
            WHERE b.status = 'OCCUPIED'
        ) AS occupied_beds,

        COUNT(b.id) FILTER (
            WHERE b.status = 'AVAILABLE'
        ) AS available_beds,

        CASE
            WHEN r.capacity > 0 THEN
                ROUND(
                    (
                        COUNT(b.id) FILTER (
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
    LEFT JOIN public.allocations a
        ON a.bed_id = b.id
       AND a.status = 'ACTIVE'
    LEFT JOIN public.students s
        ON s.id = a.student_id

    WHERE r.active = true
      AND (
          p_block IS NULL
          OR p_block = ''
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
        r.gender_rule,
        r.active,
        r.bookable,
        r.temporarily_locked

    ORDER BY
        r.block,
        CASE
            WHEN r.room_number ~ '^[0-9]+$'
                THEN r.room_number::integer
            ELSE 999999
        END,
        r.room_number;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_dashboard_summary()
TO authenticated;

GRANT EXECUTE ON FUNCTION public.admin_rooms(text)
TO authenticated;

COMMIT;