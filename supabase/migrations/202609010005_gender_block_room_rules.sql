-- The imported student list has no verified gender data. Students choose one
-- value when they first sign in; it is then used by every allocation check.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'students_gender_choice_check'
      AND conrelid = 'public.students'::regclass
  ) THEN
    ALTER TABLE public.students
      ADD CONSTRAINT students_gender_choice_check
      CHECK (gender IS NULL OR gender IN ('MALE', 'FEMALE')) NOT VALID;
  END IF;
END
$$;
UPDATE public.rooms
SET bookable = NOT (
  block = 'Hliha'
  AND room_number IN ('22', '26', '29')
);

ALTER TABLE public.rooms
  ADD CONSTRAINT rooms_four_bed_capacity_check CHECK (capacity = 4) NOT VALID,
  ADD CONSTRAINT rooms_supported_block_check
    CHECK (block IN ('Ahoe', 'Bankoe', 'Dome', 'Hliha')) NOT VALID,
  ADD CONSTRAINT rooms_gender_policy_check CHECK (
    gender IS NOT NULL AND (
      (block = 'Dome' AND room_number ~ '^(3[1-9]|40)$' AND gender = 'MALE')
      OR (NOT (block = 'Dome' AND room_number ~ '^(3[1-9]|40)$') AND gender = 'ALL')
    )
  ) NOT VALID,
  ADD CONSTRAINT rooms_reserved_policy_check CHECK (
    (block = 'Hliha' AND room_number IN ('22', '26', '29') AND bookable = FALSE)
    OR (NOT (block = 'Hliha' AND room_number IN ('22', '26', '29')))
  ) NOT VALID;

CREATE OR REPLACE FUNCTION public.ensure_room_has_four_beds()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_room_id UUID;
  v_previous_room_id UUID;
BEGIN
  v_room_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.room_id ELSE NEW.room_id END;
  v_previous_room_id := CASE WHEN TG_OP = 'UPDATE' THEN OLD.room_id ELSE NULL END;
  IF (SELECT count(*) FROM public.beds WHERE room_id = v_room_id) <> 4 THEN
    RAISE EXCEPTION 'Each room must have exactly four usable beds';
  END IF;
  IF v_previous_room_id IS NOT NULL AND v_previous_room_id <> v_room_id
     AND (SELECT count(*) FROM public.beds WHERE room_id = v_previous_room_id) <> 4 THEN
    RAISE EXCEPTION 'Each room must have exactly four usable beds';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER beds_must_total_four_per_room
AFTER INSERT OR DELETE OR UPDATE OF room_id ON public.beds
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.ensure_room_has_four_beds();

CREATE OR REPLACE FUNCTION public.set_student_gender(p_gender TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_gender TEXT := upper(trim(p_gender));
  v_student public.students;
BEGIN
  IF v_gender NOT IN ('MALE', 'FEMALE') THEN
    RAISE EXCEPTION 'Choose Male or Female';
  END IF;

  SELECT * INTO v_student
  FROM public.students
  WHERE auth_user_id = auth.uid()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Student record is not linked to this account';
  END IF;
  IF v_student.gender IS NOT NULL AND v_student.gender <> v_gender THEN
    RAISE EXCEPTION 'Gender selection cannot be changed';
  END IF;

  UPDATE public.students SET gender = v_gender, updated_at = now()
  WHERE id = v_student.id;
  RETURN v_gender;
END;
$$;

CREATE OR REPLACE FUNCTION public.room_is_available_to_student(
  p_room public.rooms,
  p_student_gender TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_student_gender IN ('MALE', 'FEMALE')
    AND p_room.active
    AND p_room.bookable
    AND p_room.capacity = 4
    AND p_room.block IN ('Ahoe', 'Bankoe', 'Dome', 'Hliha')
    AND NOT (p_room.block = 'Hliha' AND p_room.room_number IN ('22', '26', '29'))
    AND (
      p_room.gender = 'ALL'
      OR (p_room.block = 'Dome'
          AND p_room.room_number ~ '^(3[1-9]|40)$'
          AND p_room.gender = 'MALE'
          AND p_student_gender = 'MALE')
    );
$$;

CREATE OR REPLACE FUNCTION public.available_rooms_for_current_student()
RETURNS TABLE (
  id UUID,
  room_code TEXT,
  block TEXT,
  floor TEXT,
  room_number TEXT,
  capacity INTEGER,
  room_type TEXT,
  gender TEXT,
  available_beds BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_gender TEXT;
BEGIN
  SELECT gender INTO v_gender FROM public.students WHERE auth_user_id = auth.uid();
  IF v_gender IS NULL THEN
    RAISE EXCEPTION 'Choose your gender before selecting a block';
  END IF;

  RETURN QUERY
  SELECT r.id, r.room_code, r.block, r.floor, r.room_number, r.capacity,
         r.room_type, r.gender, count(b.id) AS available_beds
  FROM public.rooms r
  JOIN public.beds b ON b.room_id = r.id AND b.status = 'AVAILABLE'
  WHERE public.room_is_available_to_student(r, v_gender)
    AND NOT EXISTS (
      SELECT 1 FROM public.allocations a WHERE a.bed_id = b.id AND a.status = 'ACTIVE'
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.holds h
      WHERE h.bed_id = b.id AND h.status = 'ACTIVE' AND h.expires_at > now()
    )
  GROUP BY r.id
  ORDER BY r.block, r.room_number;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_room_hold(p_room_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s public.students; b public.beds; h public.holds; mins integer; opened boolean; r public.rooms;
BEGIN
 PERFORM public.cleanup_expired_holds();
 SELECT coalesce((SELECT value='true' FROM public.settings WHERE key='allocation_open'),false) INTO opened;
 IF NOT opened THEN RAISE EXCEPTION 'Allocation is currently closed'; END IF;
 SELECT * INTO s FROM public.students WHERE auth_user_id=auth.uid() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Student record is not linked to this account'; END IF;
 IF s.gender IS NULL THEN RAISE EXCEPTION 'Choose your gender before selecting a block'; END IF;
 IF NOT s.eligible THEN RAISE EXCEPTION 'Student is not eligible'; END IF;
 IF EXISTS(SELECT 1 FROM public.allocations WHERE student_id=s.id AND status='ACTIVE') THEN RAISE EXCEPTION 'Student already has an active allocation'; END IF;
 SELECT * INTO r FROM public.rooms WHERE id = p_room_id;
 IF NOT FOUND OR NOT public.room_is_available_to_student(r, s.gender) THEN RAISE EXCEPTION 'This room is not available for your selection'; END IF;
 mins:=coalesce((SELECT value::integer FROM public.settings WHERE key='hold_minutes'),3);
 SELECT x.* INTO b FROM public.beds x WHERE x.room_id=p_room_id AND x.status='AVAILABLE'
   AND NOT EXISTS(SELECT 1 FROM public.allocations a WHERE a.bed_id=x.id AND a.status='ACTIVE')
   AND NOT EXISTS(SELECT 1 FROM public.holds z WHERE z.bed_id=x.id AND z.status='ACTIVE' AND z.expires_at>now())
   ORDER BY x.bed_number LIMIT 1 FOR UPDATE SKIP LOCKED;
 IF NOT FOUND THEN RAISE EXCEPTION 'No bed is currently available in this room'; END IF;
 INSERT INTO public.holds(student_id,bed_id,expires_at) VALUES(s.id,b.id,now()+make_interval(mins=>mins)) RETURNING * INTO h;
 INSERT INTO public.audit_logs(actor_user_id,action,entity,entity_id,details) VALUES(auth.uid(),'HOLD','bed',b.id::text,jsonb_build_object('hold_id',h.id));
 RETURN jsonb_build_object('hold_id',h.id,'bed_id',b.id,'expires_at',h.expires_at);
END; $$;

CREATE OR REPLACE FUNCTION public.confirm_room_allocation(p_hold_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s public.students; h public.holds; b public.beds; r public.rooms; num text;
BEGIN
 PERFORM public.cleanup_expired_holds();
 SELECT * INTO s FROM public.students WHERE auth_user_id=auth.uid() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Student record is not linked to this account'; END IF;
 SELECT * INTO h FROM public.holds WHERE id=p_hold_id AND student_id=s.id FOR UPDATE;
 IF NOT FOUND OR h.status<>'ACTIVE' OR h.expires_at<=now() THEN RAISE EXCEPTION 'Hold is invalid or expired'; END IF;
 SELECT * INTO b FROM public.beds WHERE id=h.bed_id FOR UPDATE;
 IF b.status<>'AVAILABLE' THEN RAISE EXCEPTION 'Bed is no longer available'; END IF;
 SELECT * INTO r FROM public.rooms WHERE id=b.room_id;
 IF NOT public.room_is_available_to_student(r, s.gender) THEN RAISE EXCEPTION 'This room is no longer available for your selection'; END IF;
 IF EXISTS(SELECT 1 FROM public.allocations WHERE student_id=s.id AND status='ACTIVE') THEN RAISE EXCEPTION 'Student already has an active allocation'; END IF;
 num:='UHAS-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10));
 INSERT INTO public.allocations(allocation_number,student_id,bed_id) VALUES(num,s.id,b.id);
 UPDATE public.beds SET status='OCCUPIED' WHERE id=b.id;
 UPDATE public.holds SET status='CONFIRMED' WHERE id=h.id;
 INSERT INTO public.audit_logs(actor_user_id,action,entity,entity_id,details) VALUES(auth.uid(),'ALLOCATE','allocation',num,jsonb_build_object('student_id',s.student_id,'room',r.room_code,'bed_number',b.bed_number));
 RETURN jsonb_build_object('allocation_number',num,'student_id',s.student_id,'student_name',s.student_name,'room_code',r.room_code,'block',r.block,'room_number',r.room_number,'bed_number',b.bed_number);
END; $$;

GRANT EXECUTE ON FUNCTION public.set_student_gender(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.available_rooms_for_current_student() TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_room_hold(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_room_allocation(UUID) TO authenticated;


