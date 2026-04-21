/**
 * tests/setup/provisionUsers.ts
 *
 * Firebase provisioning script for WhoWins E2E test suite.
 *
 * Run with:  npm run test:setup
 *
 * What it does:
 *  1. Parses .env.test and prints the provision plan.
 *  2. Safety-checks that the dev server is reachable.
 *  3. Cleans up any existing Firestore groups whose display_name matches the
 *     groups in .env.test (e.g. "GroupA", "FamilyGroupA") — idempotent re-runs.
 *  4. Creates Firebase Auth accounts for every unique test user.
 *     If an account already exists the UID is reused (no error).
 *  5. Writes Firestore documents:
 *       users/{uid}                   — one per unique user
 *       groups/{groupId}              — one per group
 *       groups/{groupId}/members/{uid} — one per group×user
 *     All documents are tagged with _createdByTest:true and _testSession.
 *  6. Writes tests/test-session-uids.json for use by Playwright tests.
 *  7. Verifies the written data by reading it back from Firestore.
 *  8. Prints a final summary.
 *
 * NOTE: Do NOT use lib/firebaseAdmin.ts — that file requires the
 * FIREBASE_SERVICE_ACCOUNT_KEY env var. This script reads
 * serviceAccountKey.json directly to stay self-contained.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import { parseEnvTest, TestUser, TestGroup } from '../utils/parseEnvTest';

// ── Firebase Admin (initialised once below) ──────────────────────────────────

import * as admin from 'firebase-admin';

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

// ── Constants ─────────────────────────────────────────────────────────────────

const AVATAR_COLORS = [
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
];

/** Generates a random 6-char alphanumeric invite code (uppercase). */
function generateInviteCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// ── Safety check ──────────────────────────────────────────────────────────────

function checkServerReachable(baseUrl: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const loginUrl = `${baseUrl}/login`;
    const mod = loginUrl.startsWith('https') ? https : http;

    const req = mod.get(loginUrl, { timeout: 5000 }, (res) => {
      if (res.statusCode && res.statusCode < 500) {
        resolve();
      } else {
        reject(
          new Error(
            `Dev server at ${loginUrl} returned HTTP ${res.statusCode}.\n` +
            'Start the server with "npm run dev" before running test:setup.'
          )
        );
      }
    });

    req.on('error', () => {
      reject(
        new Error(
          `Cannot reach dev server at ${loginUrl}.\n` +
          'Start the server with "npm run dev" before running test:setup.'
        )
      );
    });

    req.on('timeout', () => {
      req.destroy();
      reject(
        new Error(
          `Timed out connecting to ${loginUrl}.\n` +
          'Start the server with "npm run dev" before running test:setup.'
        )
      );
    });
  });
}

// ── Cleanup existing groups ───────────────────────────────────────────────────

/**
 * Deletes Firestore groups whose `name` matches any of the given display names,
 * along with their members subcollections. This makes re-runs idempotent.
 */
async function cleanupExistingGroups(displayNames: string[]): Promise<void> {
  const db = admin.firestore();
  console.log('\n── Step 3: Cleaning up existing groups ──────────────────────');

  for (const name of displayNames) {
    const snap = await db.collection('groups').where('name', '==', name).get();
    if (snap.empty) {
      console.log(`  - No existing group found with name "${name}"`);
      continue;
    }

    for (const groupDoc of snap.docs) {
      const groupId = groupDoc.id;

      // Delete members subcollection
      const membersSnap = await db.collection(`groups/${groupId}/members`).get();
      if (!membersSnap.empty) {
        const batch = db.batch();
        for (const memberDoc of membersSnap.docs) {
          batch.delete(memberDoc.ref);
        }
        await batch.commit();
      }

      // Delete the group document
      await groupDoc.ref.delete();
      console.log(`  ✓ Deleted group "${name}" (${groupId}), removed ${membersSnap.size} member docs`);
    }
  }
}

// ── Unique-user deduplication ─────────────────────────────────────────────────

interface UniqueUser extends TestUser {
  /** Deterministic avatar colour derived from insertion order. */
  avatarColor: string;
  isSuperAdmin: boolean;
}

/**
 * Collect every unique user across all groups (deduplicated by email).
 * The super-admin is included first; then users in group insertion order.
 */
function collectUniqueUsers(
  superAdmin: { email: string; password: string },
  groups: TestGroup[]
): UniqueUser[] {
  const seen = new Map<string, UniqueUser>(); // email → UniqueUser
  let colorIdx = 0;

  function addUser(user: TestUser, isSuperAdmin = false): void {
    if (seen.has(user.email)) return;
    seen.set(user.email, {
      ...user,
      avatarColor: AVATAR_COLORS[colorIdx % AVATAR_COLORS.length],
      isSuperAdmin,
    });
    colorIdx++;
  }

  // Super-admin first (alias "superadmin" used only for key-generation)
  addUser(
    { alias: 'superadmin', name: 'Super Admin', email: superAdmin.email, password: superAdmin.password },
    true
  );

  for (const group of groups) {
    for (const u of group.admins)  addUser(u);
    for (const u of group.members) addUser(u);
  }

  return Array.from(seen.values());
}

// ── Firebase Auth provisioning ────────────────────────────────────────────────

function isUserNotFound(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: string }).code === 'auth/user-not-found'
  );
}

/**
 * Creates Firebase Auth accounts for every unique user.
 * If an account already exists the existing UID is reused — no error thrown.
 * Returns a Map<email, uid>.
 */
async function createAuthUsers(
  uniqueUsers: UniqueUser[]
): Promise<Map<string, string>> {
  const auth = admin.auth();
  const emailToUid = new Map<string, string>();

  console.log('\n── Step 4: Creating / verifying Firebase Auth accounts ──────');

  for (const user of uniqueUsers) {
    try {
      const existing = await auth.getUserByEmail(user.email);
      // Account already exists — reuse the UID
      emailToUid.set(user.email, existing.uid);
      console.log(`  ↩ Auth account already exists: ${user.name} <${user.email}>  uid=${existing.uid}`);
    } catch (err: unknown) {
      if (isUserNotFound(err)) {
        // Create a fresh account
        const record = await auth.createUser({
          email: user.email,
          password: user.password,
          displayName: user.name,
        });
        emailToUid.set(user.email, record.uid);
        console.log(`  ✓ Created Auth user: ${user.name} <${user.email}>  uid=${record.uid}`);
      } else {
        throw err;
      }
    }
  }

  return emailToUid;
}

// ── Firestore provisioning ────────────────────────────────────────────────────

interface SessionData {
  sessionId: string;
  uids: Record<string, string>;
  groupIds: Record<string, string>;
}

async function provisionFirestore(
  config: ReturnType<typeof parseEnvTest>,
  emailToUid: Map<string, string>
): Promise<SessionData> {
  const db = admin.firestore();
  const { sessionId, superAdmin, groups } = config;
  const now = admin.firestore.FieldValue.serverTimestamp();
  const testMeta = { _createdByTest: true, _testSession: sessionId };

  // ── users/{uid} ─────────────────────────────────────────────────────────
  console.log('\n── Step 5a: Writing users/{uid} documents ───────────────────');

  const uniqueUsers = collectUniqueUsers(superAdmin, groups);
  const batch1 = db.batch();

  for (const user of uniqueUsers) {
    const uid = emailToUid.get(user.email)!;
    const userRef = db.doc(`users/${uid}`);

    const doc: Record<string, unknown> = {
      uid,
      displayName: user.name,
      email: user.email,
      role: 'member',
      avatarColor: user.avatarColor,
      groupIds: [],          // will be updated per-group below
      createdAt: now,
      ...testMeta,
    };

    if (user.isSuperAdmin) {
      doc.superAdmin = true;
    }

    batch1.set(userRef, doc);
    console.log(`  ✓ Queued user doc: ${user.name}${user.isSuperAdmin ? ' [superAdmin]' : ''}`);
  }

  await batch1.commit();
  console.log('  ✓ users batch committed');

  // ── groups/{groupId} + members subcollection ──────────────────────────────
  console.log('\n── Step 5b: Writing groups and member subcollections ─────────');

  const groupIds: Record<string, string> = {};

  for (const group of groups) {
    // Create the group document
    const groupRef = db.collection('groups').doc();
    const groupId = groupRef.id;
    groupIds[group.key] = groupId;

    await groupRef.set({
      name: group.displayName,
      createdBy: emailToUid.get(group.admins[0].email)!,
      inviteCode: generateInviteCode(),
      createdAt: now,
      ...testMeta,
    });
    console.log(`  ✓ Created group "${group.displayName}" (${groupId})`);

    // Write member subcollection documents
    const batch2 = db.batch();
    const allMembers: { user: TestUser; role: 'admin' | 'member' }[] = [
      ...group.admins.map((u) => ({ user: u, role: 'admin' as const })),
      ...group.members.map((u) => ({ user: u, role: 'member' as const })),
    ];

    for (const { user, role } of allMembers) {
      const uid = emailToUid.get(user.email)!;
      const memberRef = db.doc(`groups/${groupId}/members/${uid}`);

      // Find the user's avatar color from uniqueUsers
      const uniqueUser = uniqueUsers.find((u) => u.email === user.email)!;

      batch2.set(memberRef, {
        userId: uid,
        displayName: user.name,
        avatarColor: uniqueUser.avatarColor,
        role,
        joinedAt: now,
        ...testMeta,
      });
    }

    await batch2.commit();
    console.log(`  ✓ Wrote ${allMembers.length} member docs for "${group.displayName}"`);

    // Update each member's groupIds array in their user doc
    const batch3 = db.batch();
    for (const { user } of allMembers) {
      const uid = emailToUid.get(user.email)!;
      batch3.update(db.doc(`users/${uid}`), {
        groupIds: admin.firestore.FieldValue.arrayUnion(groupId),
      });
    }
    await batch3.commit();
    console.log(`  ✓ Updated groupIds for ${allMembers.length} users`);
  }

  // ── Build session UIDs record ─────────────────────────────────────────────
  const uids: Record<string, string> = {
    superAdmin: emailToUid.get(superAdmin.email)!,
  };

  for (const group of groups) {
    for (const user of group.admins) {
      uids[`${group.key}_admin_${user.alias}`] = emailToUid.get(user.email)!;
    }
    for (const user of group.members) {
      uids[`${group.key}_member_${user.alias}`] = emailToUid.get(user.email)!;
    }
  }

  return { sessionId, uids, groupIds };
}

// ── Write session file ────────────────────────────────────────────────────────

function writeSessionFile(sessionData: SessionData): void {
  const outPath = path.resolve(process.cwd(), 'tests', 'test-session-uids.json');
  fs.writeFileSync(outPath, JSON.stringify(sessionData, null, 2) + '\n', 'utf-8');
  console.log(`\n── Step 6: Session file written ─────────────────────────────`);
  console.log(`  ${outPath}`);
}

// ── Verification ──────────────────────────────────────────────────────────────

async function verify(
  config: ReturnType<typeof parseEnvTest>,
  sessionData: SessionData,
  emailToUid: Map<string, string>
): Promise<void> {
  const db = admin.firestore();
  const { superAdmin, groups } = config;
  const { groupIds } = sessionData;

  console.log('\n── Step 7: Verification ─────────────────────────────────────');

  // Check superAdmin flag
  const saUid = emailToUid.get(superAdmin.email)!;
  const saDoc = await db.doc(`users/${saUid}`).get();
  if (!saDoc.exists || !saDoc.data()?.superAdmin) {
    throw new Error(`Verification failed: superAdmin flag missing for uid=${saUid}`);
  }
  console.log(`  ✓ superAdmin flag set on users/${saUid}`);

  // Check each group
  for (const group of groups) {
    const groupId = groupIds[group.key];
    const groupDoc = await db.doc(`groups/${groupId}`).get();
    if (!groupDoc.exists) {
      throw new Error(`Verification failed: groups/${groupId} does not exist`);
    }
    console.log(`  ✓ Group doc exists: groups/${groupId} ("${group.displayName}")`);

    const membersSnap = await db.collection(`groups/${groupId}/members`).get();
    const expectedCount = group.admins.length + group.members.length;
    if (membersSnap.size !== expectedCount) {
      throw new Error(
        `Verification failed: groups/${groupId}/members has ${membersSnap.size} docs, expected ${expectedCount}`
      );
    }
    console.log(`  ✓ Member count correct: ${membersSnap.size}/${expectedCount} for "${group.displayName}"`);

    // Check each member has groupId in their user doc
    for (const user of [...group.admins, ...group.members]) {
      const uid = emailToUid.get(user.email)!;
      const userDoc = await db.doc(`users/${uid}`).get();
      const userGroupIds: string[] = userDoc.data()?.groupIds ?? [];
      if (!userGroupIds.includes(groupId)) {
        throw new Error(
          `Verification failed: users/${uid} groupIds does not include ${groupId}`
        );
      }
    }
    console.log(`  ✓ All members' groupIds arrays contain ${groupId}`);
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('══════════════════════════════════════════════════════════════');
  console.log('  WhoWins E2E Test — Provision Users');
  console.log('══════════════════════════════════════════════════════════════');

  // Step 1: Parse .env.test
  console.log('\n── Step 1: Parsing .env.test ────────────────────────────────');
  const config = parseEnvTest();
  const uniqueUsers = collectUniqueUsers(config.superAdmin, config.groups);

  console.log(`  Session ID : ${config.sessionId}`);
  console.log(`  Base URL   : ${config.baseUrl}`);
  console.log(`  Unique users to create: ${uniqueUsers.length}`);
  for (const u of uniqueUsers) {
    console.log(`    - ${u.name} <${u.email}>${u.isSuperAdmin ? ' [superAdmin]' : ''}`);
  }
  console.log(`  Groups to create: ${config.groups.length}`);
  for (const g of config.groups) {
    console.log(`    - [${g.key}] "${g.displayName}"  admins=${g.admins.length}  members=${g.members.length}`);
  }

  // Step 2: Safety check — dev server must be running
  console.log('\n── Step 2: Checking dev server reachability ─────────────────');
  await checkServerReachable(config.baseUrl);
  console.log(`  ✓ Dev server is reachable at ${config.baseUrl}`);

  // Initialise Firebase Admin
  initAdmin();

  // Step 3: Cleanup existing groups with matching display names
  const groupDisplayNames = config.groups.map((g) => g.displayName);
  await cleanupExistingGroups(groupDisplayNames);

  // Step 4: Create / reuse Firebase Auth accounts
  const emailToUid = await createAuthUsers(uniqueUsers);

  // Step 5: Write Firestore documents
  const sessionData = await provisionFirestore(config, emailToUid);

  // Step 6: Write session file
  writeSessionFile(sessionData);

  // Step 7: Verify
  await verify(config, sessionData, emailToUid);

  // Step 8: Summary
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  Provisioning complete!');
  console.log(`  Session ID : ${sessionData.sessionId}`);
  console.log('  Group IDs  :');
  for (const [key, id] of Object.entries(sessionData.groupIds)) {
    console.log(`    ${key} → ${id}`);
  }
  console.log('  UIDs       :');
  for (const [key, uid] of Object.entries(sessionData.uids)) {
    console.log(`    ${key} → ${uid}`);
  }
  console.log('══════════════════════════════════════════════════════════════');
  console.log('\nYou may now run:  npm run test:e2e');
}

main().catch((err) => {
  console.error('\n[provisionUsers] FATAL:', err.message ?? err);
  process.exit(1);
});
