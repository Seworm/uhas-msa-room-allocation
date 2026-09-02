create or replace function public.admin_dashboard_summary()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_students jsonb;
    v_rooms jsonb;
    v_beds jsonb;
    v_holds jsonb;
    v_allocations jsonb;
    v_gender jsonb;
    v_allocation_open boolean;
begin
    if not public.is_admin() then
        raise exception 'Admin access required';
    end if;

    /*
      STUDENTS
      activated_at is the actual activation timestamp column.
    */
    select jsonb_build_object(
        'total', count(*),
        'eligible', count(*) filter (where eligible = true),
        'activated', count(*) filter (where activated_at is not null),
        'unallocated_eligible',
            count(*) filter (
                where eligible = true
                and not exists (
                    select 1
                    from public.allocations a
                    where a.student_id = students.id
                      and a.status = 'ACTIVE'
                )
            )
    )
    into v_students
    from public.students;

    /*
      ROOMS
    */
    select jsonb_build_object(
        'total', count(*),
        'active', count(*) filter (where active = true),
        'bookable', count(*) filter (where bookable = true)
    )
    into v_rooms
    from public.rooms;

    /*
      BEDS
    */
    select jsonb_build_object(
        'total', count(*),
        'occupied', count(*) filter (where status = 'OCCUPIED'),
        'available', count(*) filter (where status = 'AVAILABLE')
    )
    into v_beds
    from public.beds;

    /*
      HOLDS
    */
    select jsonb_build_object(
        'active', count(*) filter (where status = 'ACTIVE')
    )
    into v_holds
    from public.holds;

    /*
      ALLOCATIONS
    */
    select jsonb_build_object(
        'active', count(*) filter (where status = 'ACTIVE')
    )
    into v_allocations
    from public.allocations;

    /*
      GENDER
    */
    select jsonb_build_object(
        'male', count(*) filter (where upper(gender) = 'MALE'),
        'female', count(*) filter (where upper(gender) = 'FEMALE'),
        'unset', count(*) filter (
            where gender is null
               or trim(gender) = ''
        )
    )
    into v_gender
    from public.students;

    /*
      ALLOCATION OPEN/CLOSED
    */
    select coalesce(
        (
            select
                case
                    when lower(value::text) in ('true', '"true"') then true
                    else false
                end
            from public.settings
            where key = 'allocation_open'
            limit 1
        ),
        false
    )
    into v_allocation_open;

    return jsonb_build_object(
        'students', coalesce(v_students, '{}'::jsonb),
        'rooms', coalesce(v_rooms, '{}'::jsonb),
        'beds', coalesce(v_beds, '{}'::jsonb),
        'holds', coalesce(v_holds, '{}'::jsonb),
        'allocations', coalesce(v_allocations, '{}'::jsonb),
        'gender', coalesce(v_gender, '{}'::jsonb),
        'allocation_open', v_allocation_open
    );
end;
$$;

grant execute on function public.admin_dashboard_summary()
to authenticated;