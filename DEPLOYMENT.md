# UHAS Asogli Hall Room Allocation — Deployment

This repository contains a static GitHub Pages frontend and Supabase backend.

## Fastest production deployment

### 1. Create/link the Supabase project

Create a Supabase project and note:

- Project Ref
- Project URL
- Publishable/anon key

The frontend already contains the project URL and publishable key in `web/config.js`. The publishable key is safe for browser use. **Never put the service-role key in the frontend.**

### 2. Deploy the database

Install/login to the Supabase CLI, then:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

The migrations create the schema, student authentication, room inventory, allocation rules, phone-number functions, admin reporting, and security controls.

### 3. Deploy all Edge Functions

```bash
supabase functions deploy student-login
supabase functions deploy rooms
supabase functions deploy allocate-room
supabase functions deploy my-allocation
supabase functions deploy get-student-phone
supabase functions deploy update-student-phone
```

The deployed functions use Supabase's server-side environment variables. Do not add `SUPABASE_SERVICE_ROLE_KEY` to `web/config.js`.

### 4. GitHub Pages

There are two supported deployment methods.

**Recommended:** push the repository to GitHub and enable GitHub Actions. The included workflows deploy:

- `web/` → GitHub Pages
- `supabase/` → Supabase migrations and Edge Functions

Add these GitHub repository secrets:

- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_PROJECT_REF`

Then push to `main`.

**Alternative:** if GitHub Pages is configured manually as **Deploy from a branch**, use the repository root. The root `index.html` redirects visitors to `web/`.

### 5. Admin portal

The administrator portal is:

```text
/web/admin/
```

An administrator must have a Supabase Auth email/password account and a matching `public.profiles` row with role:

- `admin`
- `super_admin`

### 6. Student data

The repository currently contains the supplied student seed. Before opening allocation, confirm that the seed exactly matches the approved student list.

If access codes are real production credentials, keep the repository private and reissue/rotate codes if they were exposed.

## Production smoke test

After deployment, verify:

1. Student login with a valid index number and access code.
2. Invalid credentials are rejected.
3. Repeated failed login attempts are rate-limited.
4. A student can log in again from another browser/device.
5. Existing phone numbers load correctly.
6. New phone numbers save correctly.
7. Gender selection is saved and cannot be changed through the normal flow.
8. Only eligible rooms are displayed for the student's gender.
9. Dome rooms 31–40 are male-only.
10. Ahoe 01–04 remain staged until the configured unlocking condition is reached.
11. Holding a room creates a temporary reservation.
12. Returning to the room list cancels the active hold.
13. An expired hold cannot be confirmed.
14. Confirmation creates exactly one active allocation.
15. Two students cannot receive the same bed.
16. An already allocated student cannot allocate another room.
17. Closed allocation prevents new holds.
18. Admin login and role enforcement work.
19. Admin room, allocation, unallocated-student and audit reports work.
20. Student portal shows the confirmed room, bed and safe roommate information.
21. Student phone numbers are never shown to roommates.
22. No service-role credential appears in browser files.

## Important migration ordering

Migration filenames are intentionally ordered so the initial schema and student seed run before the final multi-device authentication migration.

The old incorrectly ordered file:

```text
02609030001_multidevice_student_auth.sql
```

is retained only for migration-history compatibility. The active multi-device implementation is:

```text
202609030003_multidevice_student_auth.sql
```

For a brand-new Supabase project, `supabase db push` should apply the complete migration set in filename order.

If a Supabase project has already applied older migrations, do not delete or rename migrations that are recorded in its remote migration history. Apply forward migrations instead.

## Going live

Before setting `allocation_open` to `true`:

1. Confirm the final student list.
2. Confirm the room inventory.
3. Confirm administrator accounts.
4. Back up the database.
5. Run the smoke tests above.
6. Open allocation through an authorized administrator/database process.
