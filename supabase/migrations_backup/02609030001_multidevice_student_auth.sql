begin;

-- ============================================================
-- MULTI-DEVICE STUDENT AUTHENTICATION
-- ============================================================
--
-- The old system associated a student with the anonymous
-- Supabase Auth UID of the first browser/device.
--
-- The new system uses a permanent Supabase Auth account
-- per student.
--
-- student.auth_user_id remains the link between:
--
--     public.students.id
--              ↓
--     auth.users.id
--
-- BUT it is now the ID of the student's permanent Auth account,
-- not an anonymous browser account.
--
-- ============================================================


-- ------------------------------------------------------------
-- 1. Make auth_user_id unique
-- ------------------------------------------------------------

create unique index if not exists
students_auth_user_id_unique
on public.students (auth_user_id)
where auth_user_id is not null;


-- ------------------------------------------------------------
-- 2. Remove the old "activation is permanently consumed"
--    behaviour from the database authority.
--
-- IMPORTANT:
-- We deliberately DO NOT delete access_code_used.
--
-- Existing application/database code may still reference it.
--
-- The new login function will NOT use access_code_used to
-- determine whether login is allowed.
-- ------------------------------------------------------------


-- ------------------------------------------------------------
-- 3. Create a secure helper to locate a student by student_id
--    and verify the access code.
--
-- This function is SECURITY DEFINER because the student login
-- endpoint is unauthenticated.
--
-- It deliberately returns only the fields required by the
-- authentication Edge Function.
-- ------------------------------------------------------------

create or replace function public.authenticate_student_access_code(
    p_student_id text,
    p_access_code text
)
returns table (
    id uuid,
    student_id text,
    student_name text,
    programme text,
    level text,
    gender text,
    eligible boolean,
    auth_user_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
begin

    return query
    select
        s.id,
        s.student_id,
        s.student_name,
        s.programme,
        s.level,
        s.gender,
        s.eligible,
        s.auth_user_id
    from public.students s
    where upper(trim(s.student_id)) = upper(trim(p_student_id))
      and trim(s.access_code) = trim(p_access_code)
    limit 1;

end;
$$;


-- ------------------------------------------------------------
-- 4. Do NOT allow normal users to execute this function.
--
-- The Edge Function will use the service-role connection.
-- ------------------------------------------------------------

revoke all
on function public.authenticate_student_access_code(text, text)
from public;

revoke all
on function public.authenticate_student_access_code(text, text)
from anon;

revoke all
on function public.authenticate_student_access_code(text, text)
from authenticated;


commit;