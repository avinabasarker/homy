// hiddenMessages.ts — owner smoke-test BUG 5: "Delete for me".
//
// LOCAL-ONLY hide list. The message stays on the server and stays visible
// to the peer; it disappears PERMANENTLY from MY thread. Implemented with
// a dedicated SQLite table (hidden_messages); the existing messages table
// is untouched — every thread query filters out hidden ids at render time.
//
// A conversation-scoped store would need a second lookup key per row; the
// message id alone is enough because UUIDs are globally unique.
import { openDatabaseSync } from 'expo-sqlite';

let db: ReturnType<typeof openDatabaseSync> | null = null;

function getDb(): ReturnType<typeof openDatabaseSync> {
  if (!db) {
    db = openDatabaseSync('homy-local.db');
    db.execSync(`
      create table if not exists hidden_messages (
        message_id text primary key not null,
        hidden_at integer not null
      );
    `);
  }
  return db;
}

export async function hideMessageLocally(messageId: string): Promise<void> {
  const d = getDb();
  await d.runAsync(
    'insert or replace into hidden_messages (message_id, hidden_at) values (?, ?)',
    [messageId, Date.now()],
  );
}

export async function listHiddenMessageIds(): Promise<Set<string>> {
  const d = getDb();
  const rows = await d.getAllAsync<{ message_id: string }>(
    'select message_id from hidden_messages',
  );
  return new Set(rows.map((r) => r.message_id));
}
