BEGIN;

-- ============================================================
-- ASOGLI HALL — RESET ALLOCATION CYCLE
-- ============================================================
-- Keeps the student master records and existing access-code
-- hashes, but makes every student eligible to activate/book again.
--
-- Also removes the erroneous Dome Room 0.
--
-- Expected final inventory:
--   160 rooms
--   640 beds
--   0 allocations
--   0 holds
--   640 available beds
-- ============================================================


-- ------------------------------------------------------------
-- 1. Remove existing holds
-- ------------------------------------------------------------
DELETE FROM public.holds;


-- ------------------------------------------------------------
-- 2. Remove existing allocations
-- ------------------------------------------------------------
DELETE FROM public.allocations;


-- ------------------------------------------------------------
-- 3. Reset all beds
-- ------------------------------------------------------------
UPDATE public.beds
SET status = 'AVAILABLE';


-- ------------------------------------------------------------
-- 4. Reactivate existing access codes
--
-- IMPORTANT:
-- Do NOT change access_code or access_code_hash.
-- Students will continue using the codes already issued to them.
-- ------------------------------------------------------------
UPDATE public.students
SET
    auth_user_id = NULL,
    access_code_used = FALSE,
    activated_at = NULL,
    updated_at = now();


-- ------------------------------------------------------------
-- 5. Remove erroneous Dome Room 0
-- ------------------------------------------------------------
DO $$
DECLARE
    v_room_id uuid;
    v_room_count integer;
    v_bed_count integer;
BEGIN

    SELECT count(*)
    INTO v_room_count
    FROM public.rooms
    WHERE lower(block) = 'dome'
      AND trim(room_number) = '0';


    -- Nothing to remove.
    IF v_room_count = 0 THEN
        RAISE NOTICE 'Dome Room 0 not found. Continuing safely.';
        RETURN;
    END IF;


    -- Never silently choose between duplicate Room 0 records.
    IF v_room_count > 1 THEN
        RAISE EXCEPTION
            'SAFETY STOP: More than one Dome Room 0 exists.';
    END IF;


    SELECT id
    INTO v_room_id
    FROM public.rooms
    WHERE lower(block) = 'dome'
      AND trim(room_number) = '0';


    SELECT count(*)
    INTO v_bed_count
    FROM public.beds
    WHERE room_id = v_room_id;


    RAISE NOTICE
        'Removing Dome Room 0 (% beds).',
        v_bed_count;


    -- Beds reference the room, so remove them first.
    DELETE FROM public.beds
    WHERE room_id = v_room_id;


    DELETE FROM public.rooms
    WHERE id = v_room_id;

END $$;


-- ------------------------------------------------------------
-- 6. HARD SAFETY CHECKS
-- ------------------------------------------------------------

DO $$
DECLARE
    v_rooms integer;
    v_beds integer;
    v_allocations integer;
    v_holds integer;
    v_available integer;
    v_room_zero integer;
BEGIN

    SELECT count(*)
    INTO v_rooms
    FROM public.rooms;


    SELECT count(*)
    INTO v_beds
    FROM public.beds;


    SELECT count(*)
    INTO v_allocations
    FROM public.allocations;


    SELECT count(*)
    INTO v_holds
    FROM public.holds;


    SELECT count(*)
    INTO v_available
    FROM public.beds
    WHERE status = 'AVAILABLE';


    SELECT count(*)
    INTO v_room_zero
    FROM public.rooms
    WHERE lower(block) = 'dome'
      AND trim(room_number) = '0';


    IF v_rooms <> 160 THEN
        RAISE EXCEPTION
            'SAFETY CHECK FAILED: Expected 160 rooms, found %.',
            v_rooms;
    END IF;


    IF v_beds <> 640 THEN
        RAISE EXCEPTION
            'SAFETY CHECK FAILED: Expected 640 beds, found %.',
            v_beds;
    END IF;


    IF v_allocations <> 0 THEN
        RAISE EXCEPTION
            'SAFETY CHECK FAILED: Expected 0 allocations, found %.',
            v_allocations;
    END IF;


    IF v_holds <> 0 THEN
        RAISE EXCEPTION
            'SAFETY CHECK FAILED: Expected 0 holds, found %.',
            v_holds;
    END IF;


    IF v_available <> 640 THEN
        RAISE EXCEPTION
            'SAFETY CHECK FAILED: Expected 640 available beds, found %.',
            v_available;
    END IF;


    IF v_room_zero <> 0 THEN
        RAISE EXCEPTION
            'SAFETY CHECK FAILED: Dome Room 0 still exists.';
    END IF;


    RAISE NOTICE '========================================';
    RAISE NOTICE 'ASOGLI HALL ALLOCATION RESET SUCCESSFUL';
    RAISE NOTICE 'Rooms:       %', v_rooms;
    RAISE NOTICE 'Beds:        %', v_beds;
    RAISE NOTICE 'Available:   %', v_available;
    RAISE NOTICE 'Allocations: %', v_allocations;
    RAISE NOTICE 'Holds:       %', v_holds;
    RAISE NOTICE '========================================';

END $$;


COMMIT;