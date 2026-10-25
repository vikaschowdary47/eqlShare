# Eqlshare web

Next.js 15 (App Router, TypeScript, Tailwind 4) + Supabase. Product source of truth: `../EQLSHARE_MASTER_BUILD_SPEC_V0.3.md`.

## Setup

1. `cp .env.example .env.local` and fill in your Supabase URL and anon key.
2. Apply the migrations to your project: `supabase link --project-ref <ref>` then `supabase db push`.
3. In Supabase Auth settings, set the Site URL to `NEXT_PUBLIC_SITE_URL` and add `<site>/auth/callback` to the redirect URLs.
4. `npm install && npm run dev`

## Checks

- `npx vitest run`: domain tests (cent-exact splits, balances, due states, statement parsing)
- `npm run lint`, `npx tsc --noEmit`, `npm run build`
- `scripts/test-db.sh`: applies every migration to a throwaway Postgres (with `supabase/tests/supabase_shim.sql` standing in for Supabase auth) and runs the authorization and Auto Bills tests. Set `PGHOST`, `PGPORT` and `PGUSER` for a local Postgres.

## Architecture

- `src/lib/domain/`: pure business rules shared by UI and server (money in integer cents, splits, balances, due states, statement extraction). No I/O.
- `supabase/migrations/`: schema, RLS (members can read their Space), and SECURITY DEFINER functions. **All writes go through these functions**, which re-validate every money invariant and permission. Clients have no insert/update/delete grants.
- `src/lib/actions.ts`: server actions that call those functions and turn database error codes into plain-English messages.
- `src/app/s/[spaceId]/…`: the app (Home, Bills, Activity, Space, Auto Bills).
- Space type (`shared_home | couple | family | group`) is a preset that changes labels and defaults only.

## Not in this build (by design)

No bank connections, payments or fund transfers. Email forwarding works only when `INBOUND_WEBHOOK_SECRET` and `SUPABASE_SERVICE_ROLE_KEY` are set and an inbound email provider posts to `/api/inbound/email`. Until then, use PDF upload. Reminder emails aren't sent; reminders are shareable links.

## Import from Splitwise

Screenshot-first; Splitwise is never contacted. `src/lib/import/extract.ts` is the only file that knows the vision provider (Gemini, `GEMINI_MODEL`, default `gemini-3.1-flash-lite`). Pure logic (validation, merging, duplicate detection, debt simplification, review checks) lives in `src/lib/domain/import.ts`. Opening balances are bills with `source = 'import'`: no due date, no reminders, settled through the normal report/confirm flow. People who haven't joined are placeholder members (`user_id` null) with single-use claim links (`/claim/<hex>`).

Live extraction check (spends a fraction of a cent): `GEMINI_LIVE=1 node --env-file=.env node_modules/.bin/vitest run tests/gemini.live.test.ts`
