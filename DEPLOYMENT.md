# Deployment

## 1. Create Supabase project
Create a project and obtain its Project Ref, Project URL and publishable/anon key.

## 2. Install/login to Supabase CLI
```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
```

## 3. Apply schema
```bash
supabase db push
```

## 4. Deploy functions
```bash
supabase functions deploy rooms
supabase functions deploy allocate-room
supabase functions deploy my-allocation
```

## 5. Configure Auth
Use Supabase Auth. For production, prefer institutional email/magic-link or another verified institutional identity flow. Do not use student ID alone as authentication.

## 6. Load real data
Import approved students into `public.students`, rooms into `public.rooms`, and beds into `public.beds`. Link each authenticated user to the correct `students.auth_user_id`.

## 7. Configure frontend
Edit `web/config.js` with the project URL and publishable key, or inject these values through your chosen static-host build process.

## 8. GitHub Actions
Add repository secrets:
- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_PROJECT_REF`

Push to `main` to deploy migrations/functions.

## 9. Pre-launch test
Test simultaneous attempts for the same final bed, duplicate clicks, expired holds, already-allocated students, ineligible students, closed allocation, and network retries. Verify no duplicate active allocation exists for a student or bed.

## 10. Go live
Freeze student/room data, export a backup, run smoke tests, then change `allocation_open` to `true` using an authorized admin process.
