DROP FUNCTION IF EXISTS public.admin_student_allocations(TEXT, TEXT, TEXT);

-- ============================================================
-- Include allocation UUID in admin allocation reporting
-- ============================================================

CREATE OR REPLACE FUNCTION public.admin_student_allocations(
    p_search TEXT DEFAULT NULL,
    p_block TEXT DEFAULT NULL,
    p_gender TEXT DEFAULT NULL
)
RETURNS TABLE (
    id UUID,
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
        a.id,
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
            OR s.gender = p_gender
        )

    ORDER BY
        a.allocated_at DESC;

END;
$$;


REVOKE ALL
ON FUNCTION public.admin_student_allocations(TEXT, TEXT, TEXT)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.admin_student_allocations(TEXT, TEXT, TEXT)
TO authenticated;