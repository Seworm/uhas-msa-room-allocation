BEGIN;

-- ============================================================
-- FINAL DATABASE SECURITY HARDENING
-- ============================================================
--
-- PostgreSQL grants EXECUTE on newly-created functions to PUBLIC
-- by default. These functions operate with SECURITY DEFINER, so
-- leaving PUBLIC execution enabled would be unsafe.
-- ============================================================

REVOKE ALL ON FUNCTION public.current_role()
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.is_admin()
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.cleanup_expired_holds()
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.set_student_gender(TEXT)
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.room_effective_gender(UUID)
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.non_locked_rooms_are_full()
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.gender_established_room_count(TEXT)
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.room_is_available_to_student(
  public.rooms,
  TEXT
)
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.available_rooms_for_current_student(TEXT)
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.create_room_hold(UUID)
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.confirm_room_allocation(UUID)
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.is_super_admin()
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.admin_dashboard_summary()
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.admin_rooms(TEXT)
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.admin_room_occupants(UUID)
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.admin_student_allocations(
  TEXT,
  TEXT,
  TEXT
)
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.admin_unallocated_students(TEXT)
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.admin_audit_logs(INTEGER)
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.update_student_phone(TEXT)
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.get_student_phone()
  FROM PUBLIC, anon, authenticated;


-- ============================================================
-- Controlled grants
-- ============================================================

GRANT EXECUTE ON FUNCTION public.current_role()
  TO authenticated;

GRANT EXECUTE ON FUNCTION public.is_admin()
  TO authenticated;

GRANT EXECUTE ON FUNCTION public.set_student_gender(TEXT)
  TO authenticated;

GRANT EXECUTE ON FUNCTION public.room_effective_gender(UUID)
  TO authenticated;

GRANT EXECUTE ON FUNCTION public.non_locked_rooms_are_full()
  TO authenticated;

GRANT EXECUTE ON FUNCTION public.gender_established_room_count(TEXT)
  TO authenticated;

GRANT EXECUTE ON FUNCTION public.room_is_available_to_student(
  public.rooms,
  TEXT
)
  TO authenticated;

GRANT EXECUTE ON FUNCTION public.available_rooms_for_current_student(TEXT)
  TO authenticated;

GRANT EXECUTE ON FUNCTION public.create_room_hold(UUID)
  TO authenticated;

GRANT EXECUTE ON FUNCTION public.confirm_room_allocation(UUID)
  TO authenticated;

GRANT EXECUTE ON FUNCTION public.is_super_admin()
  TO authenticated;

GRANT EXECUTE ON FUNCTION public.admin_dashboard_summary()
  TO authenticated;

GRANT EXECUTE ON FUNCTION public.admin_rooms(TEXT)
  TO authenticated;

GRANT EXECUTE ON FUNCTION public.admin_room_occupants(UUID)
  TO authenticated;

GRANT EXECUTE ON FUNCTION public.admin_student_allocations(
  TEXT,
  TEXT,
  TEXT
)
  TO authenticated;

GRANT EXECUTE ON FUNCTION public.admin_unallocated_students(TEXT)
  TO authenticated;

GRANT EXECUTE ON FUNCTION public.admin_audit_logs(INTEGER)
  TO authenticated;

GRANT EXECUTE ON FUNCTION public.update_student_phone(TEXT)
  TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_student_phone()
  TO authenticated;


-- ============================================================
-- Cancel an active hold
-- ============================================================

CREATE OR REPLACE FUNCTION public.cancel_room_hold(
  p_hold_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student_id UUID;
  v_hold public.holds;
BEGIN
  SELECT id
  INTO v_student_id
  FROM public.students
  WHERE auth_user_id = auth.uid()
  FOR UPDATE;

  IF v_student_id IS NULL THEN
    RAISE EXCEPTION 'Student record is not linked to this account';
  END IF;

  SELECT *
  INTO v_hold
  FROM public.holds
  WHERE id = p_hold_id
    AND student_id = v_student_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Hold not found';
  END IF;

  IF v_hold.status <> 'ACTIVE' THEN
    RETURN jsonb_build_object(
      'success', true,
      'status', v_hold.status
    );
  END IF;

  UPDATE public.holds
  SET status = 'CANCELLED'
  WHERE id = v_hold.id;

  INSERT INTO public.audit_logs(
    actor_user_id,
    action,
    entity,
    entity_id,
    details
  )
  VALUES(
    auth.uid(),
    'CANCEL_HOLD',
    'hold',
    v_hold.id::TEXT,
    jsonb_build_object(
      'bed_id', v_hold.bed_id
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'status', 'CANCELLED'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_room_hold(UUID)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.cancel_room_hold(UUID)
  TO authenticated;


-- Trigger-only helper must never be directly callable.
REVOKE ALL ON FUNCTION public.ensure_room_has_four_beds()
  FROM PUBLIC, anon, authenticated;

COMMIT;
