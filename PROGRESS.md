# Homy — PROGRESS.md

**Project:** Homy (Private E2EE Android Messenger) — v2.1 full rebuild
**Current phase:** Phase 2 — Supabase & Auth (code complete, awaiting device verification)
**Typecheck:** `npx tsc --noEmit` ✅ zero errors (last run: end of Phase 2 build)

---

## Phase 2 — Supabase & Auth

### Done-criteria status
- [x] `.env` with real `EXPO_PUBLIC_SUPABASE_URL` + `EXPO_PUBLIC_SUPABASE_ANON_KEY` (gitignored, proven)
- [x] Supabase client with Part H #6 config (`src/lib/supabase.ts`)
- [x] Auth core: `registerAccount`, `loginAccount`, `restoreSession`, `setPin`/`verifyPin`, `signOut`, `ensureDeviceKeys`, `startPresenceHeartbeat`, `validateUsername`, `isUsernameAvailable`
- [x] Part H #13 registration order: keys + phrase generated → signUp → SecureStore → DB writes
- [x] Part H #3: `signUp` passes `options.data.username` (DB trigger builds the profile)
- [x] Part H #4: null session after signUp → "turn Confirm email OFF" error
- [x] Part H #5 error mapping: duplicate → "That username is taken." / bad login → "Wrong username or password."
- [x] PIN per Part H #7: 16-byte salt, 2000× nacl.hash, SecureStore JSON, constant-time compare, 4–8 digits
- [x] SecureStore keys per Part H #2: `homy_id_sk_<uid>`, `homy_id_pk_<uid>`, `homy_prekey_sk_<uid>`, `homy_recovery_<uid>`, `homy_pin_<uid>`
- [x] Auth UI: Register → Recovery Phrase 3×4 grid with "I have saved it" gate → tabs; Login; PIN setup/unlock; background re-lock; logout
- [x] Old session in AsyncStorage → PIN screen on restart
- [x] Presence heartbeat: immediate + every 45 s; offline (best-effort) on logout
- [x] `npx tsc --noEmit` — zero errors
- [ ] **Waiting on user:** register `alice_test` (WRITE THE 12 WORDS ON PAPER) → dashboard; check profiles/public_keys/prekeys/presence rows in Supabase; logout→login; force-close → PIN; duplicate username → "taken"; wrong password → "Wrong username or password."

### Known issues
- `npm audit`: 22 dev-tooling vulnerabilities (unchanged from Phase 1; none in runtime deps).
- `ensureDeviceKeys` rotates the device prekey on every login; prekey consumption semantics arrive with Phase 4 messaging.
- After logout the PIN is cleared (device-local); next login asks for a new PIN. Multi-device identity sync happens in Phase 8 via encrypted backup.
- Recovery-phrase gate persists via AsyncStorage flag, so a mid-registration crash re-shows the phrase instead of losing it.

### Design decisions (values Part C does not specify — flagged for review)
- Error/danger color: `#B84A4A` (Part C defines no error color).
- Inputs: surface bg, 12 radius, 1px `#2A2A2A` border; buttons: accent bg, 12 radius, 48 min height.
- Welcome screen: accent "H" logo circle, ghost secondary button.

---

## Environment notes
- Windows PC; Git for Windows 2.56 (bash at `F:/Programs/Git`). Node 24.21, npm 11.19.
- Expo SDK 57, RN 0.86.3, React 19.2.3, TS 6.0.3 (strict).
- Supabase project: `thsgapycytdkvkfwmlcj` (URL written WITHOUT the /rest/v1 suffix in `.env`).
- Phase 1 git note: push required one-time interactive Git Credential Manager sign-in (user-side).
- Rules honored: expo packages ONLY via `npx expo install`; work only inside `homy/`; typecheck before every commit; never commit `.env`/secrets; never log secrets.

---

## Roadmap
- [x] Phase 1 — Foundation & UI Shell
- [x] Phase 2 — Supabase & Auth (this section)
- [ ] Phase 3 — Social Graph
- [ ] Phase 4 — E2EE Messaging Core
- [ ] Phase 5 — Chat UX (Pixel-Perfect)
- [ ] Phase 6 — Interactions
- [ ] Phase 7 — Media & Voice
- [ ] Phase 8 — Multi-Device, Ship & Infra

**Next step:** user runs the Phase 2 done-checklist on their phone, then types: `Phase 2 done. Proceed to Phase 3.`
