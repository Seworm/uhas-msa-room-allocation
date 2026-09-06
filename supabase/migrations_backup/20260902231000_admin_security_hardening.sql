BEGIN;

-- =========================================================
-- ADMIN SECURITY HARDENING
-- admin       = read-only
-- super_admin = administrative control
-- =========================================================

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT COALESCE(
        public.current_role() = 'super_admin',
        false
    );
$$;

GRANT EXECUTE ON FUNCTION public.is_super_admin()
TO authenticated;


-- =========================================================
-- PROFILES
-- Ordinary admins may view profiles.
-- Only super_admin may modify profiles/roles.
-- =========================================================

DROP POLICY IF EXISTS profiles_admin ON public.profiles;

CREATE POLICY profiles_admin_select
ON public.profiles
FOR SELECT
TO authenticated
USING (public.is_admin());

CREATE POLICY profiles_super_admin_manage
ON public.profiles
FOR ALL
TO authenticated
USING (public.is_super_admin())
WITH CHECK (public.is_super_admin());


-- =========================================================
-- STUDENTS
-- Ordinary admins can view.
-- Super admins can manage.
-- =========================================================

DROP POLICY IF EXISTS students_admin ON public.students;

CREATE POLICY students_admin_select
ON public.students
FOR SELECT
TO authenticated
USING (public.is_admin());

CREATE POLICY students_super_admin_manage
ON public.students
FOR ALL
TO authenticated
USING (public.is_super_admin())
WITH CHECK (public.is_super_admin());


-- =========================================================
-- ROOMS
-- =========================================================

DROP POLICY IF EXISTS rooms_admin ON public.rooms;

CREATE POLICY rooms_admin_select
ON public.rooms
FOR SELECT
TO authenticated
USING (public.is_admin());

CREATE POLICY rooms_super_admin_manage
ON public.rooms
FOR ALL
TO authenticated
USING (public.is_super_admin())
WITH CHECK (public.is_super_admin());


-- =========================================================
-- BEDS
-- =========================================================

DROP POLICY IF EXISTS beds_admin ON public.beds;

CREATE POLICY beds_admin_select
ON public.beds
FOR SELECT
TO authenticated
USING (public.is_admin());

CREATE POLICY beds_super_admin_manage
ON public.beds
FOR ALL
TO authenticated
USING (public.is_super_admin())
WITH CHECK (public.is_super_admin());


-- =========================================================
-- SETTINGS
-- Ordinary admins can read settings.
-- Only super_admin can modify them.
-- =========================================================

DROP POLICY IF EXISTS settings_admin ON public.settings;

CREATE POLICY settings_admin_select
ON public.settings
FOR SELECT
TO authenticated
USING (public.is_admin());

CREATE POLICY settings_super_admin_manage
ON public.settings
FOR ALL
TO authenticated
USING (public.is_super_admin())
WITH CHECK (public.is_super_admin());


-- =========================================================
-- Keep allocations, holds and audit logs read-only
-- through their existing admin SELECT policies.
--
-- Allocation changes should continue through controlled
-- PostgreSQL functions rather than arbitrary table writes.
-- =========================================================

COMMIT;