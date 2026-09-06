BEGIN;

-- ============================================================
-- RESET ASOGLI HALL ALLOCATION CYCLE
-- ============================================================

-- 1. Remove temporary holds.
DELETE FROM public.holds;


-- 2. Remove current allocations.
--    Audit logs are intentionally preserved.
DELETE FROM public.allocations;


-- 3. Release all existing beds.
UPDATE public.beds
SET status = 'AVAILABLE';


-- ============================================================
-- REMOVE ERRONEOUS DOME-00
-- ============================================================
--
-- The beds table has an AFTER DELETE trigger that requires
-- every room to have exactly four beds.
--
-- Deleting DOME-00's beds individually would therefore fail
-- after the first deletion.
--
-- Temporarily disable ONLY that trigger while removing the
-- invalid room, then re-enable it before validation/commit.
-- ============================================================

ALTER TABLE public.beds
  DISABLE TRIGGER beds_must_total_four_per_room;


DO $$
DECLARE
  v_room_id UUID;
BEGIN

  SELECT id
  INTO v_room_id
  FROM public.rooms
  WHERE lower(trim(block)) = 'dome'
    AND trim(room_number::text) = '0';

  IF v_room_id IS NULL THEN

    RAISE NOTICE 'DOME-00 not found; continuing.';

  ELSE

    DELETE FROM public.beds
    WHERE room_id = v_room_id;

    DELETE FROM public.rooms
    WHERE id = v_room_id;

    RAISE NOTICE
      'Removed erroneous DOME-00 room and its beds.';

  END IF;

END $$;


ALTER TABLE public.beds
  ENABLE TRIGGER beds_must_total_four_per_room;


-- ============================================================
-- REMOVE STUDENT AUTH ACCOUNTS
-- ============================================================
--
-- Permanent student Auth accounts use the deterministic
-- @student-login.uhas.local address. A reset that only clears
-- students.auth_user_id would leave those Auth users behind,
-- causing the next login to fail with "email already registered".
--
-- This is intentionally part of the destructive allocation-cycle
-- reset and does not touch administrator accounts.
-- ============================================================

DELETE FROM auth.users
WHERE lower(coalesce(email, '')) LIKE '%@student-login.uhas.local';


-- ============================================================
-- RESET STUDENT ACCESS ACTIVATION
-- ============================================================

UPDATE public.students
SET
  auth_user_id = NULL,
  access_code_used = FALSE,
  activated_at = NULL,
  updated_at = now();


-- ============================================================
-- FINAL VALIDATION
-- ============================================================

DO $$
DECLARE
  v_rooms INTEGER;
  v_beds INTEGER;
  v_allocations INTEGER;
  v_holds INTEGER;
  v_available INTEGER;
  v_room_zero INTEGER;
  v_bad_rooms INTEGER;
BEGIN

  SELECT COUNT(*)
  INTO v_rooms
  FROM public.rooms;


  SELECT COUNT(*)
  INTO v_beds
  FROM public.beds;


  SELECT COUNT(*)
  INTO v_allocations
  FROM public.allocations;


  SELECT COUNT(*)
  INTO v_holds
  FROM public.holds;


  SELECT COUNT(*)
  INTO v_available
  FROM public.beds
  WHERE status = 'AVAILABLE';


  SELECT COUNT(*)
  INTO v_room_zero
  FROM public.rooms
  WHERE lower(trim(block)) = 'dome'
    AND trim(room_number::text) = '0';


  SELECT COUNT(*)
  INTO v_bad_rooms
  FROM (
    SELECT
      r.id,
      COUNT(b.id) AS bed_count
    FROM public.rooms r
    LEFT JOIN public.beds b
      ON b.room_id = r.id
    GROUP BY r.id
    HAVING COUNT(b.id) <> 4
  ) x;


  IF v_rooms <> 160 THEN
    RAISE EXCEPTION
      'Expected exactly 160 rooms, found %',
      v_rooms;
  END IF;


  IF v_beds <> 640 THEN
    RAISE EXCEPTION
      'Expected exactly 640 beds, found %',
      v_beds;
  END IF;


  IF v_allocations <> 0 THEN
    RAISE EXCEPTION
      'Expected zero allocations, found %',
      v_allocations;
  END IF;


  IF v_holds <> 0 THEN
    RAISE EXCEPTION
      'Expected zero holds, found %',
      v_holds;
  END IF;


  IF v_available <> 640 THEN
    RAISE EXCEPTION
      'Expected 640 available beds, found %',
      v_available;
  END IF;


  IF v_room_zero <> 0 THEN
    RAISE EXCEPTION
      'DOME-00 still exists.';
  END IF;


  IF v_bad_rooms <> 0 THEN
    RAISE EXCEPTION
      'Found % rooms that do not have exactly four beds.',
      v_bad_rooms;
  END IF;


  RAISE NOTICE
    'Allocation cycle reset successfully: 160 rooms, 640 beds, 0 allocations, 0 holds.';

END $$;


COMMIT;