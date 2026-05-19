# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev       # Dev server (Vite, hot reload)
npm run build     # Production build → dist/
npm run preview   # Preview the production build locally
```

There are no tests. No linter is configured.

**Asset generators** (run from repo root with Node.js):
```bash
node gen-icons.cjs           # Generates public/icons/icon-192.png and icon-512.png
node gen-feature-graphic.cjs # Generates public/feature-graphic.png (1024×500 Play Store banner)
```

**Android TWA build** (runs in GitHub Actions — see `.github/workflows/build-android.yml`):
```bash
node twa/gen-android.cjs     # Generates the full Gradle project in twa/android/
# Then built via: gradle assembleRelease (inside the workflow)
```

## Architecture

**Stack:** React 18 (no router) + Vite + Supabase + Vercel

### Frontend — single file SPA

All UI lives in `src/App.jsx` (~2600 lines). There is no routing library — the app uses a `page` state string (`'resumen' | 'calendario' | 'gastos' | 'flota' | 'stats' | 'admin'`) and `authState` (`'loading' | 'auth' | 'inactive' | 'onboarding' | 'app' | 'demo'`) to render the correct screen.

Key component hierarchy:
- `App` — root, owns all state, handles auth lifecycle and data loading
  - `AuthScreen` — login/register/Google OAuth + "Probar Demo" button
  - `OnboardingScreen` — first-run wizard (config turno base, add autos/choferes)
  - `InactiveScreen` — shown when account is pending approval or subscription expired
  - `SubscriptionScreen` — Mobbex payment trigger
  - `AdminScreen` — admin panel (activate users, extend subscriptions)
  - `TutorialOverlay` — 7-slide onboarding tutorial with CSS mockup illustrations; always shown on demo entry, shown once for real users (keyed by `localStorage.flota_tutorial`)
  - `ResumenPage` — dashboard (weekly/monthly income, maintenance alerts)
  - `CalendarioPage` → `DayModal` — shift calendar; tapping a day opens a modal to register turno/franco
  - `GastosPage` — expense list + add form
  - `FlotaPage` — tabbed: `AutosTab` | `MantItemsTab` | `DeudasTab`
  - `StatsPage` — 6-month bar chart, deuda histórica

**Demo mode:** `isDemoMode` flag is set by `enterDemoMode()`. All data functions short-circuit to return data from `src/demoData.js`. Mutations show a toast instead of hitting Supabase.

### Data layer (`src/data.js`)

All Supabase calls are thin async functions exported from `data.js`. Every write uses `uid()` (gets current session user ID) to scope data per-user. RLS in Supabase enforces the same scoping server-side.

The heavy query is `getResumen()` — it fetches autos, choferes, turnos, francos, gastos, kms, config, mantenimiento, and user_mant_items in parallel and assembles the full fleet state object that most pages consume.

### Backend (Vercel Serverless Functions)

- `api/mobbex-create.js` — creates a Mobbex checkout session for subscriptions
- `api/mobbex-webhook.js` — receives Mobbex payment confirmations and calls `admin_add_payment` RPC to extend the user's subscription in Supabase

Required Vercel env vars: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `MOBBEX_API_KEY`, `MOBBEX_ACCESS_TOKEN`, `MOBBEX_PRICE`

### Database (Supabase)

Run migrations in order in Supabase SQL Editor:
1. `migration.sql` — full schema (destructive, drops all existing tables)
2. `migration_addendum.sql` — adds `turno_base` to autos, `user_mant_items` table, performance indexes
3. `migration_addendum2.sql` — adds `vtv_vence` and `seguro_vence` columns to autos

All tables use RLS with `auth.uid() = user_id` policies. Admin operations use Postgres functions (`get_all_profiles`, `admin_set_activo`, `admin_add_payment`) called via `supabase.rpc()` because the service role key is only used server-side in the webhook.

### PWA / Android

- `public/sw.js` — service worker with stale-while-revalidate strategy. Cache name is `flota-v5`. **When deploying breaking JS changes, bump the cache name** so old clients clear their cache on next activation.
- `public/manifest.json` — PWA manifest targeting `flota-v2.vercel.app`
- `public/.well-known/assetlinks.json` — Digital Asset Links for Android TWA verification. The SHA-256 fingerprint here must match the keystore used to sign the APK. **After any new Android build with a new keystore, update this file.**
- `twa/gen-android.cjs` — generates a complete Gradle 8.x + AGP 8.3.2 Android project from scratch. Keystore path is resolved via `rootProject.file()` relative to `twa/android/`.
- The GitHub Actions workflow (`build-android.yml`) restores the keystore from the `KEYSTORE_B64` secret if set, otherwise generates a new one and outputs the base64 + SHA-256 in the run summary.
