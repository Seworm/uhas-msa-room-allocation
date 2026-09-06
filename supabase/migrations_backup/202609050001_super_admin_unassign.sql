-- ============================================================
-- Super Admin: Unassign Student
-- ============================================================
-- Revokes an active allocation without deleting its history.
-- Only authenticated Super Admins may execute this function.
-- ============================================================

CREATE OR REPLACE FUNCTION public.unassign_student(
  p_allocation_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_allocation public.allocations;
  v_student public.students;
  v_bed public.beds;
BEGIN

  -- ----------------------------------------------------------
  -- 1. Verify Super Admin
  -- ----------------------------------------------------------

  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION
      'Super Admin privileges are required';
  END IF;


  -- ----------------------------------------------------------
  -- 2. Lock and locate the allocation
  -- ----------------------------------------------------------

  SELECT *
  INTO v_allocation
  FROM public.allocations
  WHERE id = p_allocation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Allocation not found';
  END IF;


  -- ----------------------------------------------------------
  -- 3. If already inactive, return safely
  -- ----------------------------------------------------------

  IF v_allocation.status <> 'ACTIVE' THEN

    RETURN jsonb_build_object(
      'success', true,
      'status', v_allocation.status,
      'message', 'Allocation is already inactive'
    );

  END IF;


  -- ----------------------------------------------------------
  -- 4. Lock student
  -- ----------------------------------------------------------

  SELECT *
  INTO v_student
  FROM public.students
  WHERE id = v_allocation.student_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Student record not found';
  END IF;


  -- ----------------------------------------------------------
  -- 5. Lock bed
  -- ----------------------------------------------------------

  SELECT *
  INTO v_bed
  FROM public.beds
  WHERE id = v_allocation.bed_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Bed record not found';
  END IF;


  -- ----------------------------------------------------------
  -- 6. Revoke allocation
  -- ----------------------------------------------------------

  UPDATE public.allocations
  SET
    status = 'REVOKED',
    updated_at = now()
  WHERE id = v_allocation.id;


  -- ----------------------------------------------------------
  -- 7. Release bed
  -- ----------------------------------------------------------

  UPDATE public.beds
  SET status = 'AVAILABLE'
  WHERE id = v_bed.id;


  -- ----------------------------------------------------------
  -- 8. Record audit event
  -- ----------------------------------------------------------

  INSERT INTO public.audit_logs(
    actor_user_id,
    action,
    entity,
    entity_id,
    details
  )
  VALUES(
    auth.uid(),
    'UNASSIGN_STUDENT',
    'allocation',
    v_allocation.id::TEXT,
    jsonb_build_object(
      'allocation_number',
        v_allocation.allocation_number,
      'student_id',
        v_allocation.student_id,
      'bed_id',
        v_allocation.bed_id,
      'previous_status',
        'ACTIVE',
      'new_status',
        'REVOKED'
    )
  );


  -- ----------------------------------------------------------
  -- 9. Return result
  -- ----------------------------------------------------------

  RETURN jsonb_build_object(
    'success', true,
    'allocation_id', v_allocation.id,
    'allocation_number', v_allocation.allocation_number,
    'student_id', v_allocation.student_id,
    'bed_id', v_allocation.bed_id,
    'status', 'REVOKED',
    'bed_status', 'AVAILABLE'
  );

END;
$$;


-- ============================================================
-- SECURITY
-- ============================================================

REVOKE ALL
ON FUNCTION public.unassign_student(UUID)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.unassign_student(UUID)
TO authenticated;