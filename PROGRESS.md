# Homy — PROGRESS.md

**Project:** Homy (Private E2EE Android Messenger) — v2.1 full rebuild
**Current phase:** Phase 4 — E2EE Messaging Core (code complete + crypto verified; server conversation-creation blocked; awaiting device verification)
**Typecheck:** `npx tsc --noEmit` ✅ zero errors (last run: end of Phase 4 build)

---

## Phase 3 — Social Graph

### What was built
- `src/lib/social.ts` — data layer: exact-username lookup, send/accept/
  reject/withdraw requests, contacts derived from ACCEPTED requests,
  presence decoration, realtime subscriptions on friend_requests + presence.
- `src/hooks/useSocialGraph.ts` — single owner of social state; realtime
  refresh; teardown on sign-out.
- `src/screens/ChatsScreen.tsx` — contacts list with letter avatars, presence
  dots, add-friend form (+ button in header), incoming requests with
  Accept/Reject, outgoing requests with Cancel, and an always-present
  "Saved messages (you)" self-chat row (Part B Phase 3).

### Server model (VERIFIED against the live DB with two real sessions)
- `friend_requests(id, requester_id, recipient_id, status, created_at,
  updated_at)`; status ∈ pending | accepted.
- RLS: SELECT/UPDATE/DELETE limited to rows where I am requester or
  recipient; INSERT only with requester_id = me; self-request INSERT is
  blocked server-side (42501).
- Accept = recipient UPDATEs status → 'accepted' (verified live A↔B).
- Contacts are DERIVED client-side from accepted rows (no contacts table).
- Realtime channel subscribe confirmed; postgres_changes is RLS-filtered.
- `profiles` lookup by exact username works signed-in.

### Phase 3 owner tests (run on TWO phones or phone + emulator)
1. Register `alice_test` (or reuse) and `bob_test`. Both land on the Chats
   tab. EXPECT: header "Chats", a "+" button top-right, and a row
   "Saved messages (you)" with an accent avatar at the top of the list.
2. As alice: tap "+" → type `bob_test` → "Send request".
   EXPECT green/positive text "Request sent!"; a new row `bob_test` with
   subtitle "Request sent — waiting" and a Cancel button appears ABOVE the
   contacts (outgoing section).
3. As alice: tap "+" again → type `bob_test` → "Send request".
   EXPECT error text "You already sent them a request." (duplicate rejection).
4. As alice: type your own username `alice_test` → "Send request".
   EXPECT "You cannot add yourself." (self rejection).
5. As alice: type `no_such_user_xyz` → "Send request".
   EXPECT "No user with that username."
6. As bob (device 2): the Chats list should show `alice_test` with subtitle
   "Wants to be your contact" and Accept/Reject buttons — WITHIN ~2 SECONDS
   of alice sending, without refreshing (realtime subscription).
   If it only appears after pull-to-refresh, note it (realtime issue).
7. As bob: type `alice_test` → "Send request".
   EXPECT "They already sent you a request — accept it below." (inverse
   duplicate rejection).
8. As bob: tap Accept on alice's request.
   EXPECT the request row disappears; a contact row `alice_test` appears
   (alphabetically with letter avatar).
9. As alice: within ~2 s the contact row `bob_test` appears on alice's
   device too (realtime on the same table). EXPECT both devices now show the
   other as a contact. (accepted → contacts on both sides)
10. As bob: pull-to-refresh. EXPECT list reloads without errors.
11. Presence: with both apps in FOREGROUND, EXPECT the other contact's dot
    to be the accent color and subtitle "Online".
    KNOWN LIMITATION (see Blocked): presence rows of other users are not
    readable via REST in the current DB policies, so the dot may show
    offline even when the peer is online. If so, record it and move on —
    fix arrives with a dashboard policy change (needs owner action).
12. As bob: tap Reject flow — have a THIRD account `carol_test` send bob a
    request; bob taps Reject. EXPECT row disappears; carol's outgoing row
    disappears on her device within ~2 s.
13. As bob: logout → login again. EXPECT contacts/requests rehydrate from
    the server (no phantom rows).
14. Security: leave the app (home button) on the Chats tab.
    EXPECT blurred scrim over the list in the Recents snapshot.

### Blocked (Phase 3)
- Presence visibility: `presence` SELECT returns only my own row for a
  signed-in user (RLS), so contact online-dots cannot light up from REST.
  Fix requires a Supabase dashboard policy change (allow authenticated
  users to read presence of users they share an accepted request with) —
  OWNER ACTION NEEDED; the app already renders whatever the server allows.
- Two attempts were made to discover a `contacts`-style edge table and a
  membership column on `conversations` (50+ candidate names probed via the
  PostgREST schema cache). Neither exists readably; contacts are accepted
  requests per above — this is the verified model, not a workaround.

---

## Phase 4 — E2EE Messaging Core

### What was built
- `src/lib/crypto.ts` — pair-key E2EE: shared = scalarmult(mySK, theirPK);
  conversation key = hash(shared ∥ sorted identity pks); seal/open via
  nacl.secretbox + random 24-byte nonce. tweetnacl only, no custom crypto.
- `src/lib/messages.ts` — fetch peer identity key from `public_keys`,
  encrypt, insert into `messages` (\x hex bytea per Part E), list+decrypt
  thread oldest-first, realtime INSERT subscription per conversation.
- `src/screens/ChatScreen.tsx` — bubbles (mine accent/right, theirs
  surface/left), composer with Send, undecryptable messages render as
  "🔒 Encrypted message" instead of failing.
- `src/screens/ChatsScreen.tsx` — tapping a contact OR "Saved messages
  (you)" opens the chat (local stack state; no new navigation dependency).
- `src/components/SecurityScrim.tsx` — FIXED for SDK 57: content now
  wrapped in `BlurTargetView` with `blurTarget` ref (was silently falling
  back to no blur on Android; that was the warning in your Metro logs).

### Crypto verification (run locally, NOT on device)
Using the exact tweetnacl operations from crypto.ts with two fresh keypairs:
- Both sides derive the SAME 32-byte pair key ✔
- Unicode message round-trips byte-perfect ✔
- Tampered ciphertext rejected (secretbox auth) ✔
- Third party (Carol) cannot decrypt Alice→Bob traffic ✔

### Blocked (Phase 4) — SERVER SIDE, OWNER ACTION NEEDED
- `messages` INSERT is RLS-rejected (42501) unless a matching
  `conversations` row exists. No conversation row is created by request
  acceptance (verified: select returns [] for both parties after accept).
- No reachable RPC can create one (10 common names probed — all missing).
- The `conversations` table's membership column could not be identified
  (60+ candidate names rejected by the PostgREST schema cache; empty
  inserts hit RLS before column validation).
- CONSEQUENCE: in-app sends will show the honest error "The server rejected
  the message because the conversation row does not exist yet…" until the
  owner adds, in Supabase (SQL editor), EITHER a trigger on
  friend_requests UPDATE pending→accepted that inserts the conversation
  row (with whatever membership columns the schema has) OR an RPC the app
  can call. The app needs no change once that exists — messages.ts already
  writes conversation_id and will start working.
- Interim mapping: ChatScreen conversation id = the accepted request row's
  OTHER PARTY user id — update after owner adds the trigger if the server
  expects a different id.

### Phase 4 owner tests (after Phase 3 owner tests 1–14 pass)
1. As alice: tap the contact row `bob_test`.
   EXPECT chat screen opens: header `bob_test` + "End-to-end encrypted",
   empty thread shows "No messages yet. Say Hi!".
2. Type "Say Hi!" → Send.
   EXPECT (current blocked state) the red honest error about the missing
   conversation row — this is CORRECT behavior until the owner adds the
   server trigger/RPC described in Blocked above. After the owner adds it:
   EXPECT the bubble appears on the right in accent purple with a timestamp.
3. As bob (device 2): open chat with alice.
   EXPECT alice's message arrives within ~2 s WITHOUT refresh (realtime),
   rendered as a grey bubble on the left.
4. As bob: reply "Hi alice!" → EXPECT bob's bubble on the right.
5. As alice: bob's reply appears within ~2 s without refresh.
6. Force-close alice's app → reopen → PIN → open chat with bob.
   EXPECT full history reloads from the server and DECRYPTS (keys persisted
   in SecureStore; session key derived deterministically from identity keys).
7. On bob's device: logout → login (new prekey uploaded, identity keys kept).
   EXPECT alice's history still decrypts (pair key depends only on identity
   keys, which do not rotate).
8. Tamper check (advanced, optional): in Supabase → Table editor → messages,
   hand-edit one ciphertext byte of bob's message. Reload alice's chat.
   EXPECT that one message renders as "🔒 Encrypted message" and the rest
   render normally (secretbox auth failure is contained per-message).

---

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
- [x] Phase 2 — Supabase & Auth
- [x] Phase 3 — Social Graph
- [x] Phase 4 — E2EE Messaging Core (this section; blocked on server conversation creation)
- [ ] Phase 5 — Chat UX (Pixel-Perfect)
- [ ] Phase 6 — Interactions
- [ ] Phase 7 — Media & Voice
- [ ] Phase 8 — Multi-Device, Ship & Infra

**Next step:** owner runs Phase 3 + Phase 4 owner tests; adds the missing
conversation-creation trigger/RPC in Supabase (see Blocked). Phase 5
(Chat UX polish) proceeds after that per the master prompt.
