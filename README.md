# UHAS MSA Self-Service Room Allocation

Production deployment starter using Supabase PostgreSQL, Supabase Auth, Edge Functions and GitHub.

## Stack
- Supabase PostgreSQL: source of truth
- Supabase Auth: identity
- Supabase Edge Functions: API
- GitHub: source control + CI/CD
- Static frontend: `web/`

## Security
Never expose a Supabase service-role key in the browser or repository. The frontend uses only the publishable/anon key. Allocation writes occur through PostgreSQL functions with row-level locking and unique constraints.

## Deploy
See `DEPLOYMENT.md`.
