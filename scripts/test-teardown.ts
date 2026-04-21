/**
 * scripts/test-teardown.ts
 *
 * Removes all Firebase data provisioned by test:setup.
 *
 * Run with:  npm run test:remove
 *
 * What it does (each step is gated by the [teardown] flags in .env.test):
 *  1. Reads tests/test-session-uids.json for the known groupIds and UIDs.
 *  2. Deletes matches tagged with _testSession or belonging to provisioned groups.
 *  3. Deletes bets  tagged with _testSession or belonging to provisioned groups.
 *  4. Deletes groups/{groupId}/members subcollections + the group documents.
 *  5. Deletes users/{uid} Firestore documents.
 *  6. Deletes Firebase Auth accounts.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as admin from 'firebase-admin';
import { parseEnvTest } from '../tests/utils/parseEnvTest';

// ── Firebase Admin init ───────────────────────────────────────────────────────

function initAdmin(): void {
  if (admin.apps.length) return;
  const keyPath = path.resolve(process.cwd(), 'serviceAccountKey.json');
  if (!fs.existsSync(keyPath)) {
    throw new Error(
      `serviceAccountKey.json not found at: ${keyPath}\n` +
      'Download it from Firebase Console → Project settings → Service accounts.'
    );
  }
  const serviceAccount = JSON.parse(fs.readFileSync(keyPath, 'utf-8'));
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}

// ── Session file ──────────────────────────────────────────────────────────────

interface SessionData {
  sessionId: string;
  uids: Record<string, string>;
  groupIds: Record<string, string>;
}

function readSessionFile(): SessionData {
  const sessionPath = path.resolve(process.cwd(), 'tests', 'test-session-uids.json');
  if (!fs.existsSync(sessionPath)) {
    throw new Error(
      `tests/test-session-uids.json not found.\n` +
      'Run npm run test:setup first, or there is nothing to remove.'
    );
  }
  return JSON.parse(fs.readFileSync(sessionPath, 'utf-8')) as SessionData;
}

// ── Delete helpers ────────────────────────────────────────────────────────────

/** Deletes all docs in a query in batches of 400. */
async function deleteQuery(query: admin.firestore.Query, label: string): Promise<number> {
  const db = admin.firestore();
  let total = 0;

  while (true) {
    const snap = await query.limit(400).get();
    if (snap.empty) break;

    const batch = db.batch();
    for (const doc of snap.docs) batch.delete(doc.ref);
    await batch.commit();
    total += snap.size;
  }

  if (total > 0) console.log(`  ✓ Deleted ${total} ${label} document(s)`);
  else           console.log(`  - No ${label} documents found`);

  return total;
}

/** Deletes the members subcollection of a group, then the group doc itself. */
async function deleteGroup(db: admin.firestore.Firestore, groupId: string, name: string): Promise<void> {
  const membersSnap = await db.collection(`groups/${groupId}/members`).get();
  if (!membersSnap.empty) {
    const batch = db.batch();
    for (const doc of membersSnap.docs) batch.delete(doc.ref);
    await batch.commit();
    console.log(`  ✓ Deleted ${membersSnap.size} member doc(s) from "${name}" (${groupId})`);
  }
  await db.doc(`groups/${groupId}`).delete();
  console.log(`  ✓ Deleted group "${name}" (${groupId})`);
}

// ── Teardown steps ────────────────────────────────────────────────────────────

async function deleteMatches(db: admin.firestore.Firestore, session: SessionData): Promise<void> {
  console.log('\n── Matches ──────────────────────────────────────────────────');
  const groupIds = Object.values(session.groupIds);

  // Delete by _testSession tag
  await deleteQuery(
    db.collection('matches').where('_testSession', '==', session.sessionId),
    'matches (by session)'
  );

  // Also sweep by each groupId in case session tag differs
  for (const groupId of groupIds) {
    await deleteQuery(
      db.collection('matches').where('groupId', '==', groupId),
      `matches (groupId=${groupId})`
    );
  }
}

async function deleteBets(db: admin.firestore.Firestore, session: SessionData): Promise<void> {
  console.log('\n── Bets ─────────────────────────────────────────────────────');
  const groupIds = Object.values(session.groupIds);

  await deleteQuery(
    db.collection('bets').where('_testSession', '==', session.sessionId),
    'bets (by session)'
  );

  for (const groupId of groupIds) {
    await deleteQuery(
      db.collection('bets').where('groupId', '==', groupId),
      `bets (groupId=${groupId})`
    );
  }
}

const EXTRA_CLEANUP_GROUP_NAMES = ['Test Group Delete Me'];

async function deleteGroups(db: admin.firestore.Firestore, session: SessionData): Promise<void> {
  console.log('\n── Groups ───────────────────────────────────────────────────');

  // Delete groups provisioned by test:setup
  for (const [key, groupId] of Object.entries(session.groupIds)) {
    const doc = await db.doc(`groups/${groupId}`).get();
    if (doc.exists) {
      await deleteGroup(db, groupId, key);
    } else {
      console.log(`  - Group "${key}" (${groupId}) not found, skipping`);
    }
  }

  // Delete any stray groups matching known test names
  for (const name of EXTRA_CLEANUP_GROUP_NAMES) {
    const snap = await db.collection('groups').where('name', '==', name).get();
    if (snap.empty) {
      console.log(`  - No group with name "${name}" found, skipping`);
      continue;
    }
    for (const doc of snap.docs) {
      await deleteGroup(db, doc.id, name);
    }
  }
}

/**
 * Deletes phantom (empty) group documents — documents that have no fields but
 * still appear in the console because a subcollection (e.g. members) exists.
 * Uses listDocuments() which returns phantom refs that .get() queries skip.
 */
async function deletePhantomGroups(db: admin.firestore.Firestore): Promise<void> {
  console.log('\n── Phantom (empty) groups ───────────────────────────────────');
  const allRefs = await db.collection('groups').listDocuments();
  let count = 0;

  for (const ref of allRefs) {
    const snap = await ref.get();
    if (!snap.exists) {
      // Delete members subcollection before removing the phantom ref
      const membersSnap = await ref.collection('members').get();
      if (!membersSnap.empty) {
        const batch = db.batch();
        for (const doc of membersSnap.docs) batch.delete(doc.ref);
        await batch.commit();
      }
      await ref.delete();
      console.log(`  ✓ Deleted phantom group ${ref.id} (${membersSnap.size ?? 0} member doc(s) removed)`);
      count++;
    }
  }

  if (count === 0) console.log('  - No phantom groups found');
}

async function deleteUsers(db: admin.firestore.Firestore, session: SessionData): Promise<void> {
  console.log('\n── Firestore user docs ──────────────────────────────────────');
  const uniqueUids = [...new Set(Object.values(session.uids))];
  const batch = db.batch();
  for (const uid of uniqueUids) batch.delete(db.doc(`users/${uid}`));
  await batch.commit();
  console.log(`  ✓ Deleted ${uniqueUids.length} user doc(s)`);
}

async function deleteAuthUsers(session: SessionData): Promise<void> {
  console.log('\n── Firebase Auth accounts ───────────────────────────────────');
  const auth = admin.auth();
  const uniqueUids = [...new Set(Object.values(session.uids))];

  for (const uid of uniqueUids) {
    try {
      await auth.deleteUser(uid);
      console.log(`  ✓ Deleted Auth user uid=${uid}`);
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === 'auth/user-not-found') {
        console.log(`  - Auth user uid=${uid} not found, skipping`);
      } else {
        throw err;
      }
    }
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('══════════════════════════════════════════════════════════════');
  console.log('  WhoWins E2E Test — Remove provisioned users and groups');
  console.log('══════════════════════════════════════════════════════════════');

  const session = readSessionFile();
  const config  = parseEnvTest();
  const { teardown } = config;

  console.log(`\n  Session ID : ${session.sessionId}`);
  console.log('  Groups     :', Object.entries(session.groupIds).map(([k, v]) => `${k}=${v}`).join(', '));
  console.log('  UIDs       :', Object.values(session.uids).length, 'unique user(s)');
  console.log('\n  Teardown flags from .env.test:');
  console.log(`    delete_firebase_auth_users  = ${teardown.deleteFirebaseAuthUsers}`);
  console.log(`    delete_firestore_groups     = ${teardown.deleteFirestoreGroups}`);
  console.log(`    delete_firestore_matches    = ${teardown.deleteFirestoreMatches}`);
  console.log(`    delete_firestore_bets       = ${teardown.deleteFirestoreBets}`);
  console.log(`    delete_firestore_users      = ${teardown.deleteFirestoreUsers}`);

  initAdmin();
  const db = admin.firestore();

  if (teardown.deleteFirestoreMatches) await deleteMatches(db, session);
  if (teardown.deleteFirestoreBets)    await deleteBets(db, session);
  if (teardown.deleteFirestoreGroups)  await deleteGroups(db, session);
  await deletePhantomGroups(db);
  if (teardown.deleteFirestoreUsers)   await deleteUsers(db, session);
  if (teardown.deleteFirebaseAuthUsers) await deleteAuthUsers(session);

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  Teardown complete.');
  console.log('══════════════════════════════════════════════════════════════\n');
}

main().catch((err) => {
  console.error('\n[test-teardown] FATAL:', err.message ?? err);
  process.exit(1);
});
