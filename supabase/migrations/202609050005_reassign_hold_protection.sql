-- ============================================================
-- Super Admin: Prevent Reassignment Into Held Beds
-- ============================================================

CREATE OR REPLACE FUNCTION public.reassign_student(
    p_allocation_id UUID,
    p_new_bed_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_allocation public.allocations;
    v_student public.students;
    v_old_bed public.beds;
    v_new_bed public.beds;
    v_old_room public.rooms;
    v_new_room public.rooms;
    v_room_gender TEXT;
BEGIN

    IF NOT public.is_super_admin() THEN
        RAISE EXCEPTION
            'Super Admin privileges are required';
    END IF;

    PERFORM pg_advisory_xact_lock(93746123);

    PERFORM public.cleanup_expired_holds();

    SELECT *
    INTO v_allocation
    FROM public.allocations
    WHERE id = p_allocation_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'Allocation not found';
    END IF;

    IF v_allocation.status <> 'ACTIVE' THEN
        RAISE EXCEPTION
            'Only active allocations can be reassigned';
    END IF;

    SELECT *
    INTO v_student
    FROM public.students
    WHERE id = v_allocation.student_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'Student record not found';
    END IF;

    SELECT *
    INTO v_old_bed
    FROM public.beds
    WHERE id = v_allocation.bed_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'Current bed record not found';
    END IF;

    SELECT *
    INTO v_new_bed
    FROM public.beds
    WHERE id = p_new_bed_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'New bed not found';
    END IF;

    IF v_new_bed.id = v_old_bed.id THEN
        RAISE EXCEPTION
            'Student is already assigned to this bed';
    END IF;

    IF v_new_bed.status <> 'AVAILABLE' THEN
        RAISE EXCEPTION
            'Selected bed is not available';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.holds h
        WHERE h.bed_id = v_new_bed.id
          AND h.status = 'ACTIVE'
          AND h.expires_at > now()
    ) THEN
        RAISE EXCEPTION
            'Selected bed is currently held';
    END IF;

    SELECT *
    INTO v_new_room
    FROM public.rooms
    WHERE id = v_new_bed.room_id
    FOR UPDATE;

    IF NOT FOUND
       OR NOT v_new_room.active
       OR NOT v_new_room.bookable
    THEN
        RAISE EXCEPTION
            'Selected room is no longer available';
    END IF;

    IF v_new_room.temporarily_locked
       AND NOT public.non_locked_rooms_are_full()
    THEN
        RAISE EXCEPTION
            'This room is temporarily locked';
    END IF;

    IF v_new_room.block = 'Dome'
       AND v_new_room.room_number ~ '^(3[1-9]|40)$'
       AND v_student.gender <> 'MALE'
    THEN
        RAISE EXCEPTION
            'This room is available to male students only';
    END IF;

    v_room_gender :=
        public.room_effective_gender(
            v_new_room.id
        );

    IF v_room_gender IS NOT NULL
       AND v_room_gender <> v_student.gender
    THEN
        RAISE EXCEPTION
            'This room is not available for the student''s gender';
    END IF;

    SELECT *
    INTO v_old_room
    FROM public.rooms
    WHERE id = v_old_bed.room_id
    FOR UPDATE;

    UPDATE public.allocations
    SET
        bed_id = v_new_bed.id,
        updated_at = now()
    WHERE id = v_allocation.id;

    UPDATE public.beds
    SET status = 'AVAILABLE'
    WHERE id = v_old_bed.id;

    UPDATE public.beds
    SET status = 'OCCUPIED'
    WHERE id = v_new_bed.id;

    INSERT INTO public.audit_logs(
        actor_user_id,
        action,
        entity,
        entity_id,
        details
    )
    VALUES(
        auth.uid(),
        'REASSIGN_STUDENT',
        'allocation',
        v_allocation.id::TEXT,
        jsonb_build_object(
            'allocation_number',
                v_allocation.allocation_number,
            'student_id',
                v_student.student_id,
            'old_bed_id',
                v_old_bed.id,
            'old_room_code',
                v_old_room.room_code,
            'old_bed_number',
                v_old_bed.bed_number,
            'new_bed_id',
                v_new_bed.id,
            'new_room_code',
                v_new_room.room_code,
            'new_bed_number',
                v_new_bed.bed_number
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'allocation_id',
            v_allocation.id,
        'allocation_number',
            v_allocation.allocation_number,
        'student_id',
            v_student.student_id,
        'old_room_code',
            v_old_room.room_code,
        'old_bed_number',
            v_old_bed.bed_number,
        'new_room_code',
            v_new_room.room_code,
        'new_bed_number',
            v_new_bed.bed_number
    );

END;
$$;

REVOKE ALL
ON FUNCTION public.reassign_student(UUID, UUID)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.reassign_student(UUID, UUID)
TO authenticated;