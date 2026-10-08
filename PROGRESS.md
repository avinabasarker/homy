# Homy — PROGRESS.md

**Project:** Homy (Private E2EE Android Messenger) — v2.1 full rebuild
**Current phase:** Phase 5 — Chat UX Pixel-Perfect (code complete; awaiting device verification)
**Typecheck:** `npx tsc --noEmit` ✅ zero errors (last run: end of Phase 5 build)

---

## Phase 5 — Chat UX (Pixel-Perfect)

### What was built (presentation ONLY — zero changes to crypto/messages/social logic)
- `src/components/Bubble.tsx` — NEW bubble component: 16px radius; sender
  RIGHT on accent `#5E5CE6`; receiver LEFT on surface `#1E1E1E`; text
  15sp/400. Tail is a corner-cut (4px) on the LAST bubble of a
  consecutive-sender group; grouped bubbles carry no tail.
- `src/screens/ChatScreen.tsx` — REBUILT:
  - Grouping: consecutive messages from one sender group; gapless look.
  - Timestamps HIDDEN by default; long-press a bubble toggles its time
    (11sp/500, `#A0A0B0`). Long-press again (or another bubble) hides.
  - Entrance animation via `react-native-reanimated` 4 (worklets on the
    UI thread): fade + slide-up + springy pop, 60fps. Messages already in
    the thread at mount do NOT animate — only newly arrived/sent ones do.
  - Empty thread renders `EmptyState` (silhouette + "No messages yet.
    Say Hi!") per Part C.
- Haptics via `expo-haptics`: LIGHT impact ONLY when a message from the
  OTHER party arrives while the chat is open. Never on send, never on UI
  clicks. Guarded by sender-id check + strictly-growing message count.
- `src/lib/messages.ts` — one ADDITION (read-only, reuses existing
  primitives): `listLastMessages(peerIds, myUserId, keys)` decrypts the
  last message per conversation for list previews. No writes, no new
  tables, no schema knowledge added.
- `src/screens/ChatsScreen.tsx` — contact rows now show: letter avatar,
  DECRYPTED last-message preview (one line, numberOfLines=1), relative
  time ("now" / "5m" / "3h" / weekday). Self-chat row stays on top and
  gets its own preview. Request rows keep Accept/Reject/Cancel actions.
- Empty states per Part C: chat uses `EmptyState` (silhouette + "No
  messages yet. Say Hi!"); list keeps its existing empty text.
- Dependencies added via `npx expo install` (SDK-57-matched):
  `react-native-reanimated@4.5.1`, `react-native-worklets@0.10.1`,
  `expo-haptics@~57.0.3`. No babel config needed — babel-preset-expo
  auto-configures the worklets plugin.

### Single-device test: inject a fake incoming message (Supabase SQL editor)

**⚠️ LABEL: THIS IS A DELIBERATELY UNDECRYPTABLE MESSAGE.** It will render
as 🔒 "Encrypted message" — that is CORRECT and expected. The point is to
trigger the REALTIME subscription on your device while the chat is open,
so you can verify the pop-in ANIMATION and the HAPTIC buzz. Delete the row
afterwards (see step 5).

Run this in Supabase → SQL Editor while the chat is OPEN on your device
(replace `<ALICE_UUID>`, `<BOB_UUID>`, `<CONVERSATION_UUID>` — get all
three from Table editor → conversations / profiles):

```sql
-- 1) Find the conversation (first party = whoever is logged in on the
--    device that will RECEIVE the fake message is NOT required — either
--    participant works; the receiving device must be either user_a/user_b).
--    If you already know the conversation id, skip this SELECT.
select id, user_a, user_b from conversations
where user_a = '<ALICE_UUID>' or user_b = '<ALICE_UUID>';

-- 2) Insert the fake message. 24-byte nonce = 48 hex chars; 32-byte
--    ciphertext = 64 hex chars. Both are VALID bytea shapes so the row is
--    well-formed, but the plaintext is random garbage — secretbox auth
--    will fail on decrypt, which is exactly what we want to observe.
insert into messages (conversation_id, sender_id, ciphertext, nonce)
values (
  '<CONVERSATION_UUID>'::uuid,
  '<OTHER_PARTY_UUID_NOT_THE_DEVICE_OWNER>'::uuid,
  decode('00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff', 'hex'),
  decode('00112233445566778899aabbccddeeff0011223344556677', 'hex')
);

-- 3) (verification on device) The bubble should pop in with the
--    slide-up+spring animation, the phone should buzz ONCE (light), and
--    the bubble text should read "🔒 Encrypted message".

-- 4) Long-press it → the timestamp appears; long-press again → hides.

-- 5) Clean up:
delete from messages
where conversation_id = '<CONVERSATION_UUID>'::uuid
  and ciphertext = decode('00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff', 'hex');
```

### Phase 5 owner tests (single phone + SQL editor)
1. Open any chat with history. EXPECT: bubbles grouped by sender; only the
   bottom bubble of each group has the tail corner-cut; no timestamps
   visible.
2. Long-press any bubble → EXPECT its timestamp (HH:MM) appears bottom-
   right inside the bubble, 11sp grey. Long-press the same bubble again →
   EXPECT hidden. Long-press a different bubble → EXPECT only that one
   shows a time.
3. Send "test 3" → EXPECT it pops in with slide-up + spring on the RIGHT
   (accent). NO vibration on send.
4. Run the fake-message INSERT above with the chat open. EXPECT: one
   light vibration, the 🔒 bubble pops in on the LEFT (surface grey) with
   the same animation, no timestamp visible.
5. Navigate back to Chats. EXPECT the contact row shows "🔒 Encrypted
   message" (or your last real message) as the one-line preview, plus a
   relative time on the right ("now").
6. Run the DELETE above. Reopen the chat → EXPECT the 🔒 bubble gone.
7. Fresh account with no messages: EXPECT the EmptyState silhouette +
   "No messages yet. Say Hi!" in the chat; the Chats list keeps its own
   empty text.
8. Scroll-smoothness: send 10+ messages in a row. EXPECT no dropped
   frames while bubbles animate in (worklets run off the JS thread).

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
    to be the accent color and subtitle "Online". The deployed
    presence_select policy now permits friends to read each other's rows;
    a clean two-session re-verification is pending (the earlier REST probe
    was invalidated by a session-clobbering bug in the probe itself).
12. As bob: tap Reject flow — have a THIRD account `carol_test` send bob a
    request; bob taps Reject. EXPECT row disappears; carol's outgoing row
    disappears on her device within ~2 s.
13. As bob: logout → login again. EXPECT contacts/requests rehydrate from
    the server (no phantom rows).
14. Security: leave the app (home button) on the Chats tab.
    EXPECT blurred scrim over the list in the Recents snapshot.

### Blocked (Phase 3)
- ~~Presence visibility: `presence` SELECT returns only my own row~~
  **RESOLVED:** the deployed `presence_select` policy now reads
  `are_friends(auth.uid(), user_id)`. Re-verify on device with two real
  sessions (Phase 3 owner test 11).
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

### Blocked (Phase 4) — RESOLVED 2026-10-08
- ~~`messages` INSERT is RLS-rejected (42501) unless a matching
  `conversations` row exists~~ **FIXED:** the owner added the server RPC
  `ensure_conversation(peer uuid) -> uuid` (documented in
  supabase/schema.sql, which is now the committed source of truth). The
  app calls it via `ensureConversation(peerId)` in messages.ts — send
  path, thread-list path, and realtime subscription all resolve the id
  through it. Self-chat resolves it with the user's own id.
- Presence: the deployed `presence_select` policy allows friends to read
  each other's presence. An earlier two-session probe reported unreadable
  presence rows, but that probe was invalidated by a session-clobbering
  bug in the probe itself (shared AsyncStorage session). A clean
  re-verification with two independent sessions needs to be run on
  device; no server change believed necessary.

### Phase 4 owner tests — ONE phone, account switching (after Phase 3 tests 1–14 pass)
1. Logged in as alice: tap the contact row `bob_test`.
   EXPECT chat screen opens: header `bob_test` + "End-to-end encrypted",
   empty thread shows "No messages yet. Say Hi!".
2. Type "Say Hi!" → Send.
   EXPECT the bubble appears immediately on the RIGHT in accent purple with
   a timestamp (sends now work via the ensure_conversation RPC; the old
   "conversation row does not exist" error should be gone).
3. Tap ‹ back → re-open the SAME contact.
   EXPECT "Say Hi!" is still there (fetched + decrypted from the server).
4. Logout → login as bob → open the chat with alice.
   EXPECT "Say Hi!" renders as a GREY bubble on the LEFT (bob decrypts
   alice's message with the same pair key).
5. As bob: reply "Hi alice!" → EXPECT bob's bubble on the RIGHT.
6. Self-chat: as bob, tap "Saved messages (you)".
   EXPECT the same chat UI; send "my note to self" → EXPECT it appears on
   the RIGHT. Back → re-open → EXPECT it persisted + decrypted (server
   created the a-b self-conversation row via the RPC).
7. Restart-and-decrypt: force-close the app → reopen → PIN → open the
   alice chat (as bob) and Saved messages.
   EXPECT full history reloads from the server and DECRYPTS (identity keys
   persisted in SecureStore; pair key derived deterministically from
   identity keys, which do not rotate on login).
8. Tamper check (advanced, optional): in Supabase → Table editor → messages,
   hand-edit one ciphertext byte. Reload the chat. EXPECT that ONE message
   renders as "🔒 Encrypted message" and the rest render normally
   (secretbox auth failure is contained per-message).

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
- [x] Phase 4 — E2EE Messaging Core (conversation creation FIXED — server RPC)
- [x] Phase 5 — Chat UX (Pixel-Perfect) (this section)
- [ ] Phase 6 — Interactions
- [ ] Phase 7 — Media & Voice
- [ ] Phase 8 — Multi-Device, Ship & Infra

**Next step:** owner runs Phase 3 + Phase 4 owner tests, then the Phase 5
single-device list above (with the fake-message SQL INSERT for testing
animations/haptics without a second phone).
