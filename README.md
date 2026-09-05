# UHAS MSA Self-Service Room Allocation

Production-ready UHAS Asogli Hall room-allocation portal using:

- Supabase PostgreSQL
- Supabase Auth
- Supabase Edge Functions
- GitHub Actions
- GitHub Pages
- Static HTML/CSS/JavaScript frontend

## Student flow

1. Student enters Index Number + Access Code.
2. The Edge Function verifies the access code against its database hash.
3. A permanent Supabase Auth account is created/reused.
4. The browser receives a normal Supabase Auth session.
5. Student saves/confirms a phone number and selects gender.
6. Student chooses a block.
7. The database determines eligible rooms.
8. Student temporarily holds a bed.
9. Student can cancel the hold or confirm it.
10. The database creates the final allocation under transaction locking.
11. An allocated student can return later and view the room, bed and safe roommate information.

## Allocation rules

- 4 supported blocks: Ahoe, Bankoe, Dome, Hliha.
- 40 rooms per block.
- 160 rooms total.
- 4 beds per room.
- 640 beds total.
- Dome rooms 31–40 are male-only.
- Maximum established female rooms: 68.
- Maximum established male rooms: 92, including the 10 permanent male-only Dome rooms.
- Ahoe rooms 01–04 are staged and remain locked until all other bookable rooms are full.

## Deployment structure

```text
/
├── index.html                 # GitHub Pages branch-deployment fallback
├── web/
│   ├── index.html             # Student portal
│   ├── app.js
│   ├── styles.css
│   ├── config.js
│   └── admin/
│       ├── index.html
│       ├── admin.js
│       └── admin.css
├── supabase/
│   ├── config.toml
│   ├── migrations/
│   └── functions/
└── .github/workflows/
```

The recommended GitHub Actions workflow publishes `web/` to GitHub Pages and deploys the Supabase backend.

## Security

- The browser uses only the Supabase publishable/anon key.
- The service-role key is used only inside server-side Edge Functions.
- Student access codes are verified against hashes.
- Authentication verification is rate-limited.
- Allocation decisions use PostgreSQL transaction/advisory locking and unique active-allocation constraints.
- Student phone numbers are not returned to roommates.
- Administrator reporting functions enforce administrator roles.
- Security-definer functions have controlled execution grants.

## Deployment

See `DEPLOYMENT.md` for the exact production deployment sequence and smoke-test checklist.

## Data note

The repository contains the supplied student seed. Verify it against the authoritative approved student list before production.

The room inventory migration creates the standard 160-room/640-bed inventory on an empty database and does not overwrite an existing approved inventory.
