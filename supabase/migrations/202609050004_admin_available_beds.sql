-- ============================================================
-- Admin: Available Beds for Reassignment
-- ============================================================

CREATE OR REPLACE FUNCTION public.admin_available_beds(
    p_gender TEXT
)
RETURNS TABLE (
    bed_id UUID,
    bed_number INTEGER,
    room_id UUID,
    room_code TEXT,
    room_number TEXT,
    block TEXT,
    floor TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN

    IF NOT public.is_admin() THEN
        RAISE EXCEPTION
            'Administrator access required';
    END IF;

    RETURN QUERY

    SELECT
        b.id,
        b.bed_number,
        r.id,
        r.room_code,
        r.room_number,
        r.block,
        r.floor

    FROM public.beds b

    JOIN public.rooms r
        ON r.id = b.room_id

    WHERE
        b.status = 'AVAILABLE'

        AND r.active = TRUE

        AND r.bookable = TRUE

        AND (
            NOT r.temporarily_locked
            OR public.non_locked_rooms_are_full()
        )

        AND NOT EXISTS (
            SELECT 1
            FROM public.holds h
            WHERE h.bed_id = b.id
              AND h.status = 'ACTIVE'
              AND h.expires_at > now()
        )

        AND (
            p_gender IS NULL
            OR p_gender = ''
            OR (
                public.room_effective_gender(r.id) IS NULL
                OR public.room_effective_gender(r.id) = p_gender
            )
        )

        AND NOT (
            r.block = 'Dome'
            AND r.room_number ~ '^(3[1-9]|40)$'
            AND p_gender <> 'MALE'
        )

    ORDER BY
        r.block,
        r.room_number,
        b.bed_number;

END;
$$;


REVOKE ALL
ON FUNCTION public.admin_available_beds(TEXT)
FROM PUBLIC, anon, authenticated;


GRANT EXECUTE
ON FUNCTION public.admin_available_beds(TEXT)
TO authenticated;