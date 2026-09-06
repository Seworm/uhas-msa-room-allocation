BEGIN;

-- ============================================================
-- ASOGLI HALL ROOM INVENTORY
-- ============================================================
--
-- The application expects:
--   Ahoe   01-40
--   Bankoe 01-40
--   Dome   01-40
--   Hliha  01-40
--   4 beds per room = 640 beds total
--
-- Floor information is intentionally left NULL because the
-- repository did not contain an authoritative floor map.
-- Administrators can populate it later without changing the
-- allocation rules.
--
-- This seeds the inventory only when the rooms table is empty.
-- If approved room data already exists, this migration leaves it
-- untouched and the production validation migration will verify
-- the required 160-room/640-bed inventory.
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.rooms LIMIT 1
  ) THEN

    INSERT INTO public.rooms (
      room_code,
      block,
      floor,
      room_number,
      capacity,
      room_type,
      gender,
      active,
      bookable
    )
    SELECT
      upper(block) || '-' || lpad(room_no::text, 2, '0'),
      block,
      NULL,
      room_no::text,
      4,
      'STANDARD',
      CASE
        WHEN block = 'Dome'
         AND room_no BETWEEN 31 AND 40
          THEN 'MALE'
        ELSE 'ALL'
      END,
      TRUE,
      TRUE
    FROM (
      VALUES
        ('Ahoe'),
        ('Bankoe'),
        ('Dome'),
        ('Hliha')
    ) AS blocks(block)
    CROSS JOIN generate_series(1, 40) AS rooms(room_no);

  END IF;
END
$$;


-- Create four beds for every room that currently has no beds.
INSERT INTO public.beds (
  room_id,
  bed_number,
  status
)
SELECT
  r.id,
  bed_no,
  'AVAILABLE'::public.bed_status
FROM public.rooms r
CROSS JOIN generate_series(1, 4) AS beds(bed_no)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.beds existing
  WHERE existing.room_id = r.id
);


-- Verify that this repository's expected inventory is present.
DO $$
DECLARE
  v_rooms INTEGER;
  v_beds INTEGER;
  v_bad_rooms INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_rooms
  FROM public.rooms;

  SELECT COUNT(*) INTO v_beds
  FROM public.beds;

  SELECT COUNT(*)
  INTO v_bad_rooms
  FROM (
    SELECT r.id
    FROM public.rooms r
    LEFT JOIN public.beds b
      ON b.room_id = r.id
    GROUP BY r.id
    HAVING COUNT(b.id) <> 4
  ) x;

  IF v_rooms <> 160 THEN
    RAISE EXCEPTION
      'Room inventory requires 160 rooms; found %',
      v_rooms;
  END IF;

  IF v_beds <> 640 THEN
    RAISE EXCEPTION
      'Room inventory requires 640 beds; found %',
      v_beds;
  END IF;

  IF v_bad_rooms <> 0 THEN
    RAISE EXCEPTION
      'Found % rooms without exactly four beds',
      v_bad_rooms;
  END IF;
END
$$;

COMMIT;
