BEGIN;

-- ============================================================
-- Super Admin: Assign Previously Unallocated Student
-- ============================================================
-- Creates a NEW allocation for an eligible student who currently
-- has no ACTIVE allocation.
--
-- Only authenticated Super Admins may execute this function.
-- The operation is fully transactional and locks the student,
-- bed and room before making the assignment.
-- ============================================================

CREATE OR REPLACE FUNCTION public.admin_assign_student(
    p_student_id UUID,
    p_bed_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_student public.students;
    v_bed public.beds;
    v_room public.rooms;
    v_allocation public.allocations;
    v_room_gender TEXT;
    v_allocation_number TEXT;
BEGIN

    -- ----------------------------------------------------------
    -- 1. Super Admin only
    -- ----------------------------------------------------------

    IF NOT public.is_super_admin() THEN
        RAISE EXCEPTION
            'Super Admin privileges are required';
    END IF;


    -- ----------------------------------------------------------
    -- 2. Serialize administrative allocation changes
    -- ----------------------------------------------------------

    PERFORM pg_advisory_xact_lock(93746123);

    -- Remove expired holds before checking the selected bed.
    PERFORM public.cleanup_expired_holds();


    -- ----------------------------------------------------------
    -- 3. Lock and load the student
    -- ----------------------------------------------------------

    SELECT *
    INTO v_student
    FROM public.students
    WHERE id = p_student_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'Student record not found';
    END IF;


    -- ----------------------------------------------------------
    -- 4. Student must be eligible
    -- ----------------------------------------------------------

    IF NOT v_student.eligible THEN
        RAISE EXCEPTION
            'This student is not eligible for room allocation';
    END IF;


    -- ----------------------------------------------------------
    -- 5. Student must not already have an active allocation
    -- ----------------------------------------------------------

    IF EXISTS (
        SELECT 1
        FROM public.allocations
        WHERE student_id = v_student.id
          AND status = 'ACTIVE'
    ) THEN
        RAISE EXCEPTION
            'This student already has an active allocation';
    END IF;


    -- ----------------------------------------------------------
    -- 6. Lock selected bed
    -- ----------------------------------------------------------

    SELECT *
    INTO v_bed
    FROM public.beds
    WHERE id = p_bed_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'Selected bed not found';
    END IF;


    -- ----------------------------------------------------------
    -- 7. Bed must be available
    -- ----------------------------------------------------------

    IF v_bed.status <> 'AVAILABLE' THEN
        RAISE EXCEPTION
            'Selected bed is not available';
    END IF;


    -- ----------------------------------------------------------
    -- 8. Prevent assignment into an active hold
    -- ----------------------------------------------------------

    IF EXISTS (
        SELECT 1
        FROM public.holds h
        WHERE h.bed_id = v_bed.id
          AND h.status = 'ACTIVE'
          AND h.expires_at > now()
    ) THEN
        RAISE EXCEPTION
            'Selected bed is currently held';
    END IF;


    -- ----------------------------------------------------------
    -- 9. Lock and validate room
    -- ----------------------------------------------------------

    SELECT *
    INTO v_room
    FROM public.rooms
    WHERE id = v_bed.room_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'Room record not found';
    END IF;

    IF NOT v_room.active OR NOT v_room.bookable THEN
        RAISE EXCEPTION
            'Selected room is no longer available';
    END IF;


    -- ----------------------------------------------------------
    -- 10. Respect temporary room locks
    -- ----------------------------------------------------------

    IF v_room.temporarily_locked
       AND NOT public.non_locked_rooms_are_full()
    THEN
        RAISE EXCEPTION
            'This room is temporarily locked';
    END IF;


    -- ----------------------------------------------------------
    -- 11. Dome 31–40 are male-only
    -- ----------------------------------------------------------

    IF v_room.block = 'Dome'
       AND v_room.room_number ~ '^(3[1-9]|40)$'
       AND v_student.gender <> 'MALE'
    THEN
        RAISE EXCEPTION
            'This room is available to male students only';
    END IF;


    -- ----------------------------------------------------------
    -- 12. Respect existing room gender rules
    -- ----------------------------------------------------------

    v_room_gender :=
        public.room_effective_gender(v_room.id);

    IF v_room_gender IS NOT NULL
       AND v_room_gender <> v_student.gender
    THEN
        RAISE EXCEPTION
            'This room is not available for the student''s gender';
    END IF;


    -- ----------------------------------------------------------
    -- 13. Generate allocation number
    -- ----------------------------------------------------------
    -- Uses the same UUID-backed allocation identity already
    -- present in the allocations table, while keeping the public
    -- allocation number human-readable and unique.
    -- ----------------------------------------------------------

    v_allocation_number :=
        'ALLOC-' ||
        upper(
            substring(
                replace(gen_random_uuid()::TEXT, '-', '')
                FROM 1 FOR 10
            )
        );


    -- ----------------------------------------------------------
    -- 14. Create new allocation
    -- ----------------------------------------------------------

    INSERT INTO public.allocations (
        allocation_number,
        student_id,
        bed_id,
        status,
        allocated_at,
        updated_at
    )
    VALUES (
        v_allocation_number,
        v_student.id,
        v_bed.id,
        'ACTIVE',
        now(),
        now()
    )
    RETURNING *
    INTO v_allocation;


    -- ----------------------------------------------------------
    -- 15. Occupy bed
    -- ----------------------------------------------------------

    UPDATE public.beds
    SET status = 'OCCUPIED'
    WHERE id = v_bed.id;


    -- ----------------------------------------------------------
    -- 16. Audit log
    -- ----------------------------------------------------------

    INSERT INTO public.audit_logs (
        actor_user_id,
        action,
        entity,
        entity_id,
        details
    )
    VALUES (
        auth.uid(),
        'ASSIGN_UNALLOCATED_STUDENT',
        'allocation',
        v_allocation.id::TEXT,
        jsonb_build_object(
            'allocation_number',
                v_allocation.allocation_number,
            'student_uuid',
                v_student.id,
            'student_id',
                v_student.student_id,
            'student_name',
                v_student.student_name,
            'bed_id',
                v_bed.id,
            'bed_number',
                v_bed.bed_number,
            'room_id',
                v_room.id,
            'room_code',
                v_room.room_code,
            'room_number',
                v_room.room_number,
            'block',
                v_room.block,
            'action',
                'NEW_ADMIN_ALLOCATION'
        )
    );


    -- ----------------------------------------------------------
    -- 17. Return allocation details
    -- ----------------------------------------------------------

    RETURN jsonb_build_object(
        'success', true,
        'allocation_id',
            v_allocation.id,
        'allocation_number',
            v_allocation.allocation_number,
        'student_uuid',
            v_student.id,
        'student_id',
            v_student.student_id,
        'student_name',
            v_student.student_name,
        'bed_id',
            v_bed.id,
        'bed_number',
            v_bed.bed_number,
        'room_id',
            v_room.id,
        'room_code',
            v_room.room_code,
        'room_number',
            v_room.room_number,
        'block',
            v_room.block,
        'floor',
            v_room.floor,
        'status',
            'ACTIVE'
    );

END;
$$;


-- ============================================================
-- SECURITY
-- ============================================================

REVOKE ALL
ON FUNCTION public.admin_assign_student(UUID, UUID)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.admin_assign_student(UUID, UUID)
TO authenticated;


COMMIT;