# Homy — PROGRESS.md

**Project:** Homy (Private E2EE Android Messenger) — v2.1 full rebuild
**Current phase:** Phase 1 — Foundation & UI Shell (code complete, awaiting device verification)
**Typecheck:** `npx tsc --noEmit` ✅ zero errors (last run: end of Phase 1 build)

---

## Phase 1 — Foundation & UI Shell

### Done-criteria status
- [x] Fresh Expo (managed) TypeScript project created in `homy/` (Expo SDK 57, RN 0.86.3, React 19.2, TS 6 strict)
- [x] Workspace checked first: no previous-attempt files existed, so nothing needed moving to `/legacy`
- [x] Dark theme constants matching Part C exactly (`src/theme/theme.ts` — single source of truth)
- [x] Inter font loaded and applied (400 regular / 500 medium / 600 semibold via `@expo-google-fonts/inter`)
- [x] Bottom tabs: Chats / Settings placeholders, dark-themed (`src/navigation/RootTabs.tsx`)
- [x] Background blur/scrim on AppState change (`src/components/SecurityScrim.tsx`, `App.tsx`)
- [x] `polyfills.ts` wired exactly per Part H, imported as the FIRST line of `App.tsx`
- [x] `npx tsc --noEmit` clean — zero errors
- [x] Git: repo on `main`, origin = github.com/avinabasarker/homy, `.env` + `node_modules/` proven ignored via `git check-ignore`
- [ ] **Waiting on user:** verify in Expo Go on Android phone (dark theme + tabs + Inter; scrim visible in Recents)

### Known issues
- `npm audit` reports 22 vulnerabilities (7 moderate / 15 high) — all in template dev tooling, standard for fresh Expo scaffolds, none in runtime dependencies. No action taken (audit fix --force would upgrade past SDK 57). Revisit if it grows.
- None blocking Phase 1.

### Design decisions for values Part C does not specify (flagged for your review)
- List-screen headers: 20dp Inter SemiBold (Part C defines only the 16sp/600 chat title).
- Tab bar labels: 11dp Inter Medium; tab bar top hairline `#2A2A2A`.
- Silhouette avatar: `#3A3A44` circle, person shape `#A0A0B0` at 55% opacity.
- Android blur: `blurMethod="dimezisBlurView"` (SDK 57 API; legacy `experimentalBlurMethod` is deprecated) + `rgba(18,18,18,0.55)` dim on top.
- Settings "signed out" card body text: 13dp Inter Regular.

---

## Environment notes (Phase 1 setup)
- Windows PC; Git for Windows 2.56 provides bash. Node 24.21, npm 11.19.
- Git identity set repo-locally: `avinabasarker` / `avinabasarker@users.noreply.github.com` (no global identity existed).
- Expo packages installed ONLY via `npx expo install`; only `tweetnacl` via plain npm.
- Rule: work ONLY inside `homy/`; commit + push at end of every phase behind a passing typecheck; never commit `.env` or secrets.

---

## Roadmap
- [x] **Phase 1 — Foundation & UI Shell** (this file's top section)
- [ ] **Phase 2 — Supabase & Auth** (needs: Project URL + anon key into `.env`; "Confirm email" OFF; sign-ups ON; stray test users deleted)
- [ ] Phase 3 — Social Graph
- [ ] Phase 4 — E2EE Messaging Core
- [ ] Phase 5 — Chat UX (Pixel-Perfect)
- [ ] Phase 6 — Interactions
- [ ] Phase 7 — Media & Voice
- [ ] Phase 8 — Multi-Device, Ship & Infra

**Next step:** user verifies Phase 1 in Expo Go, then types: `Phase 1 done. Proceed to Phase 2.`
