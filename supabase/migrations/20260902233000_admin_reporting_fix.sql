BEGIN;

-- Fix the room report to use columns that actually exist in the
-- rooms table. Earlier code referenced a non-existent gender_rule
-- column, which prevented `supabase db push` from completing.

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
    RAISE EXCEPTION 'Not authorised';
  END IF;

  RETURN QUERY
  SELECT
    r.id,
    r.room_code,
    r.block,
    r.floor,
    r.room_number,
    r.capacity,

    CASE
      WHEN UPPER(COALESCE(r.gender, '')) = 'MALE'
        THEN 'Male'
      WHEN UPPER(COALESCE(r.gender, '')) = 'FEMALE'
        THEN 'Female'
      WHEN COUNT(s.id) FILTER (
        WHERE UPPER(COALESCE(s.gender, '')) = 'MALE'
      ) > 0
       AND COUNT(s.id) FILTER (
        WHERE UPPER(COALESCE(s.gender, '')) = 'FEMALE'
      ) > 0
        THEN 'Mixed'
      WHEN COUNT(s.id) FILTER (
        WHERE UPPER(COALESCE(s.gender, '')) = 'MALE'
      ) > 0
        THEN 'Male'
      WHEN COUNT(s.id) FILTER (
        WHERE UPPER(COALESCE(s.gender, '')) = 'FEMALE'
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
            )::NUMERIC / r.capacity
          ) * 100
        )::INTEGER
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

  WHERE r.active = TRUE
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
    CASE
      WHEN r.room_number ~ '^[0-9]+$'
        THEN r.room_number::INTEGER
      ELSE 999999
    END,
    r.room_number;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_rooms(TEXT)
TO authenticated;

COMMIT;
