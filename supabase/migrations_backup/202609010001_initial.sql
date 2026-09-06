create extension if not exists pgcrypto;

create type public.bed_status as enum ('AVAILABLE','OCCUPIED','MAINTENANCE');
create type public.allocation_status as enum ('ACTIVE','CANCELLED','REVOKED');
create type public.hold_status as enum ('ACTIVE','EXPIRED','CONFIRMED','CANCELLED');

create table public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 role text not null default 'student' check(role in ('student','admin','super_admin')),
 created_at timestamptz not null default now()
);
create table public.students (
 id uuid primary key default gen_random_uuid(),
 auth_user_id uuid unique references auth.users(id) on delete set null,
 student_id text not null unique,
 student_name text not null,
 level text,
 programme text,
 gender text,
 email text,
 eligible boolean not null default false,
 priority_group integer not null default 100,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table public.rooms (
 id uuid primary key default gen_random_uuid(),
 room_code text not null unique,
 block text not null,
 floor text,
 room_number text not null,
 capacity integer not null check(capacity>0),
 room_type text,
 gender text,
 active boolean not null default true,
 created_at timestamptz not null default now()
);
create table public.beds (
 id uuid primary key default gen_random_uuid(),
 room_id uuid not null references public.rooms(id) on delete restrict,
 bed_number integer not null check(bed_number>0),
 status public.bed_status not null default 'AVAILABLE',
 created_at timestamptz not null default now(),
 unique(room_id,bed_number)
);
create table public.holds (
 id uuid primary key default gen_random_uuid(),
 student_id uuid not null references public.students(id) on delete restrict,
 bed_id uuid not null references public.beds(id) on delete restrict,
 expires_at timestamptz not null,
 status public.hold_status not null default 'ACTIVE',
 created_at timestamptz not null default now()
);
create table public.allocations (
 id uuid primary key default gen_random_uuid(),
 allocation_number text not null unique,
 student_id uuid not null references public.students(id) on delete restrict,
 bed_id uuid not null references public.beds(id) on delete restrict,
 status public.allocation_status not null default 'ACTIVE',
 allocated_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table public.audit_logs (
 id bigint generated always as identity primary key,
 actor_user_id uuid references auth.users(id) on delete set null,
 action text not null,
 entity text not null,
 entity_id text,
 details jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now()
);
create table public.settings (key text primary key,value text not null,updated_at timestamptz not null default now());
insert into public.settings(key,value) values ('allocation_open','false'),('hold_minutes','3'),('system_name','UHAS MSA Room Allocation') on conflict do nothing;

create unique index one_active_allocation_student on public.allocations(student_id) where status='ACTIVE';
create unique index one_active_allocation_bed on public.allocations(bed_id) where status='ACTIVE';
create unique index one_active_hold_student on public.holds(student_id) where status='ACTIVE';
create unique index one_active_hold_bed on public.holds(bed_id) where status='ACTIVE';
create index beds_status_idx on public.beds(status);
create index students_eligibility_idx on public.students(eligible,priority_group);
create index holds_expiry_idx on public.holds(expires_at);

alter table public.profiles enable row level security;
alter table public.students enable row level security;
alter table public.rooms enable row level security;
alter table public.beds enable row level security;
alter table public.holds enable row level security;
alter table public.allocations enable row level security;
alter table public.audit_logs enable row level security;
alter table public.settings enable row level security;

create or replace function public.current_role() returns text language sql stable security definer set search_path=public as $$ select role from public.profiles where id=auth.uid(); $$;
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path=public as $$ select coalesce(public.current_role() in ('admin','super_admin'),false); $$;

create policy profiles_self on public.profiles for select to authenticated using(id=auth.uid());
create policy profiles_admin on public.profiles for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy students_self on public.students for select to authenticated using(auth_user_id=auth.uid());
create policy students_admin on public.students for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy rooms_read on public.rooms for select to authenticated using(active=true);
create policy rooms_admin on public.rooms for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy beds_read on public.beds for select to authenticated using(status='AVAILABLE');
create policy beds_admin on public.beds for all to authenticated using(public.is_admin()) with check(public.is_admin());
create policy allocations_self on public.allocations for select to authenticated using(student_id in(select id from public.students where auth_user_id=auth.uid()));
create policy allocations_admin on public.allocations for select to authenticated using(public.is_admin());
create policy holds_self on public.holds for select to authenticated using(student_id in(select id from public.students where auth_user_id=auth.uid()));
create policy holds_admin on public.holds for select to authenticated using(public.is_admin());
create policy audit_admin on public.audit_logs for select to authenticated using(public.is_admin());
create policy settings_read on public.settings for select to authenticated using(key in('allocation_open','hold_minutes','system_name'));
create policy settings_admin on public.settings for all to authenticated using(public.is_admin()) with check(public.is_admin());

create or replace function public.cleanup_expired_holds() returns void language sql security definer set search_path=public as $$ update public.holds set status='EXPIRED' where status='ACTIVE' and expires_at<=now(); $$;

create or replace function public.create_room_hold(p_room_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare s public.students; b public.beds; h public.holds; mins integer; opened boolean;
begin
 perform public.cleanup_expired_holds();
 select coalesce((select value='true' from public.settings where key='allocation_open'),false) into opened;
 if not opened then raise exception 'Allocation is currently closed'; end if;
 select * into s from public.students where auth_user_id=auth.uid() for update;
 if not found then raise exception 'Student record is not linked to this account'; end if;
 if not s.eligible then raise exception 'Student is not eligible'; end if;
 if exists(select 1 from public.allocations where student_id=s.id and status='ACTIVE') then raise exception 'Student already has an active allocation'; end if;
 mins:=coalesce((select value::integer from public.settings where key='hold_minutes'),3);
 select x.* into b from public.beds x join public.rooms r on r.id=x.room_id where x.room_id=p_room_id and x.status='AVAILABLE' and r.active=true and not exists(select 1 from public.allocations a where a.bed_id=x.id and a.status='ACTIVE') and not exists(select 1 from public.holds z where z.bed_id=x.id and z.status='ACTIVE' and z.expires_at>now()) order by x.bed_number limit 1 for update skip locked;
 if not found then raise exception 'No bed is currently available in this room'; end if;
 insert into public.holds(student_id,bed_id,expires_at) values(s.id,b.id,now()+make_interval(mins=>mins)) returning * into h;
 insert into public.audit_logs(actor_user_id,action,entity,entity_id,details) values(auth.uid(),'HOLD','bed',b.id::text,jsonb_build_object('hold_id',h.id));
 return jsonb_build_object('hold_id',h.id,'bed_id',b.id,'expires_at',h.expires_at);
end; $$;

create or replace function public.confirm_room_allocation(p_hold_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare s public.students; h public.holds; b public.beds; r public.rooms; num text;
begin
 perform public.cleanup_expired_holds();
 select * into s from public.students where auth_user_id=auth.uid() for update;
 if not found then raise exception 'Student record is not linked to this account'; end if;
 select * into h from public.holds where id=p_hold_id and student_id=s.id for update;
 if not found or h.status<>'ACTIVE' or h.expires_at<=now() then raise exception 'Hold is invalid or expired'; end if;
 select * into b from public.beds where id=h.bed_id for update;
 if b.status<>'AVAILABLE' then raise exception 'Bed is no longer available'; end if;
 select * into r from public.rooms where id=b.room_id;
 if not r.active then raise exception 'Room is no longer active'; end if;
 if exists(select 1 from public.allocations where student_id=s.id and status='ACTIVE') then raise exception 'Student already has an active allocation'; end if;
 num:='UHAS-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10));
 insert into public.allocations(allocation_number,student_id,bed_id) values(num,s.id,b.id);
 update public.beds set status='OCCUPIED' where id=b.id;
 update public.holds set status='CONFIRMED' where id=h.id;
 insert into public.audit_logs(actor_user_id,action,entity,entity_id,details) values(auth.uid(),'ALLOCATE','allocation',num,jsonb_build_object('student_id',s.student_id,'room',r.room_code,'bed_number',b.bed_number));
 return jsonb_build_object('allocation_number',num,'student_id',s.student_id,'student_name',s.student_name,'room_code',r.room_code,'block',r.block,'room_number',r.room_number,'bed_number',b.bed_number);
end; $$;

grant execute on function public.create_room_hold(uuid) to authenticated;
grant execute on function public.confirm_room_allocation(uuid) to authenticated;
