import {
  collection,
  collectionGroup,
  doc,
  addDoc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  query,
  where,
  orderBy,
  serverTimestamp,
  arrayUnion,
  arrayRemove,
} from 'firebase/firestore';
import type { WriteBatch } from 'firebase/firestore';
import type { Timestamp } from 'firebase/firestore';
import { db } from './firebase';

// ── interfaces ────────────────────────────────────────────────────────────────

export interface Group {
  groupId: string;
  name: string;
  createdBy: string;
  inviteCode: string;
  createdAt: Timestamp;
  /**
   * Points held in escrow from previous matches that ended in a draw or
   * abandonment with noDrawPolicy === 'rollover'. These are added to the
   * total pot of the next match that produces a clear winner and then reset
   * to 0. Field may be absent on legacy documents — treat as 0.
   */
  rolloverPot?: number;
}

export interface GroupMember {
  userId: string;
  displayName: string;
  avatarColor: string;
  role: 'admin' | 'member';
  totalPoints: number;
  joinedAt: Timestamp;
}

// ── helpers ───────────────────────────────────────────────────────────────────

export function generateInviteCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

async function isInviteCodeTaken(inviteCode: string): Promise<boolean> {
  const snap = await getDocs(
    query(collection(db, 'groups'), where('inviteCode', '==', inviteCode))
  );
  return !snap.empty;
}

async function generateUniqueInviteCode(): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const inviteCode = generateInviteCode();
    const taken = await isInviteCodeTaken(inviteCode);
    if (!taken) {
      return inviteCode;
    }
  }

  throw new Error('Failed to generate a unique invite code. Please try again.');
}

// ── Firestore functions ───────────────────────────────────────────────────────

export async function createGroup(
  name: string,
  userId: string,
  userDisplayName: string,
  userAvatarColor: string
): Promise<string> {
  const inviteCode = await generateUniqueInviteCode();

  const groupRef = await addDoc(collection(db, 'groups'), {
    name,
    createdBy: userId,
    inviteCode,
    createdAt: serverTimestamp(),
  });

  await setDoc(doc(db, 'groups', groupRef.id, 'members', userId), {
    userId,
    displayName: userDisplayName,
    avatarColor: userAvatarColor,
    role: 'admin',
    totalPoints: 0,
    joinedAt: serverTimestamp(),
  });

  await updateDoc(doc(db, 'users', userId), {
    groupIds: arrayUnion(groupRef.id),
  });

  return groupRef.id;
}

export async function getUserGroups(userId: string): Promise<Group[]> {
  let groupIds: string[] = [];

  try {
    const memberSnap = await getDocs(
      query(collectionGroup(db, 'members'), where('userId', '==', userId))
    );

    groupIds = memberSnap.docs
      .map((memberDoc) => memberDoc.ref.parent.parent?.id)
      .filter((groupId): groupId is string => Boolean(groupId));
  } catch {
    const userSnap = await getDoc(doc(db, 'users', userId));
    groupIds = userSnap.exists() ? (userSnap.data().groupIds ?? []) : [];
  }

  if (groupIds.length === 0) return [];

  const groups = await Promise.allSettled(
    Array.from(new Set(groupIds)).map(async (groupId) => {
      const snap = await getDoc(doc(db, 'groups', groupId));
      if (!snap.exists()) return null;
      return { groupId: snap.id, ...snap.data() } as Group;
    })
  );

  return groups
    .filter((result): result is PromiseFulfilledResult<Group | null> => result.status === 'fulfilled')
    .map((result) => result.value)
    .filter((group): group is Group => group !== null);
}

export async function getGroupById(groupId: string): Promise<Group | null> {
  const snap = await getDoc(doc(db, 'groups', groupId));
  if (!snap.exists()) return null;
  return { groupId: snap.id, ...snap.data() } as Group;
}

export async function getGroupByInviteCode(inviteCode: string): Promise<Group | null> {
  const normalizedInviteCode = inviteCode.trim().toUpperCase();
  const snap = await getDocs(
    query(collection(db, 'groups'), where('inviteCode', '==', normalizedInviteCode))
  );
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { groupId: d.id, ...d.data() } as Group;
}

export async function getGroupMembers(groupId: string): Promise<GroupMember[]> {
  const snap = await getDocs(
    query(
      collection(db, 'groups', groupId, 'members'),
      orderBy('totalPoints', 'desc')
    )
  );
  return snap.docs.map((d) => d.data() as GroupMember);
}

export async function joinGroup(
  groupId: string,
  userId: string,
  displayName: string,
  avatarColor: string
): Promise<void> {
  const memberRef = doc(db, 'groups', groupId, 'members', userId);
  const existing = await getDoc(memberRef);
  if (existing.exists()) return;

  await setDoc(memberRef, {
    userId,
    displayName,
    avatarColor,
    role: 'member',
    totalPoints: 0,
    joinedAt: serverTimestamp(),
  });

  await setDoc(
    doc(db, 'users', userId),
    {
      uid: userId,
      displayName,
      avatarColor,
      role: 'member',
      totalPoints: 0,
      groupIds: arrayUnion(groupId),
    },
    { merge: true }
  );
}

export async function isGroupMember(groupId: string, userId: string): Promise<boolean> {
  const snap = await getDoc(doc(db, 'groups', groupId, 'members', userId));
  return snap.exists();
}

export async function isGroupAdmin(groupId: string, userId: string): Promise<boolean> {
  const snap = await getDoc(doc(db, 'groups', groupId, 'members', userId));
  if (!snap.exists()) return false;
  return (snap.data() as GroupMember).role === 'admin';
}

export async function promoteMember(groupId: string, userId: string): Promise<void> {
  await updateDoc(doc(db, 'groups', groupId, 'members', userId), { role: 'admin' });
}

export async function demoteMember(groupId: string, userId: string): Promise<void> {
  await updateDoc(doc(db, 'groups', groupId, 'members', userId), { role: 'member' });
}

export async function removeMember(groupId: string, userId: string): Promise<void> {
  if (process.env.ALLOW_REMOVE_FROM_GROUP !== 'true') {
    throw new Error('Member removal is disabled');
  }
  await deleteDoc(doc(db, 'groups', groupId, 'members', userId));
}

export async function regenerateInviteCode(groupId: string): Promise<string> {
  const newCode = await generateUniqueInviteCode();
  await updateDoc(doc(db, 'groups', groupId), { inviteCode: newCode });
  return newCode;
}

export async function getUserGroupMember(
  groupId: string,
  userId: string
): Promise<GroupMember | null> {
  const snap = await getDoc(doc(db, 'groups', groupId, 'members', userId));
  if (!snap.exists()) return null;
  return snap.data() as GroupMember;
}

export async function updateGroupName(groupId: string, name: string): Promise<void> {
  await updateDoc(doc(db, 'groups', groupId), { name });
}


export async function updateMemberDisplayName(
  groupId: string,
  userId: string,
  displayName: string
): Promise<void> {
  await updateDoc(doc(db, 'groups', groupId, 'members', userId), { displayName });
}

// ── deleteGroupCascade helpers ────────────────────────────────────────────────

/**
 * Maximum Firestore WriteBatch operations per commit.
 * The hard limit is 500; we use 499 to leave one slot free for the group
 * document delete that anchors the final batch.
 */
const BATCH_LIMIT = 499;

/**
 * Commits an array of WriteBatch instances sequentially, collecting any
 * per-batch errors rather than aborting on the first failure. This gives
 * callers full diagnostic information about which chunks succeeded.
 *
 * NOTE: Firestore client-side batches are NOT atomic across chunks.
 * If a later chunk fails, earlier chunks have already committed.
 * For true atomicity across >500 ops you need Cloud Functions + admin SDK.
 */
async function flushBatches(batches: WriteBatch[], context: string): Promise<void> {
  for (let i = 0; i < batches.length; i++) {
    try {
      await batches[i].commit();
    } catch (err) {
      console.error(
        `[deleteGroupCascade] Batch ${i + 1}/${batches.length} failed (${context}):`,
        err
      );
      throw new Error(
        `[deleteGroupCascade] Batch ${i + 1} of ${batches.length} failed — ` +
        `stopping to minimise partial writes. Context: ${context}. ` +
        `Detail: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
}

// ── deleteGroupCascade ────────────────────────────────────────────────────────

/**
 * Deletes a group and ALL associated data:
 *  - All bets linked to the group
 *  - All matches linked to the group
 *  - The group document itself
 *  - All members subcollection documents
 *  - Removes the groupId from every member's users/{uid}.groupIds array
 *
 * Writes are chunked into sequential WriteBatch commits of ≤ 499 ops each
 * to stay under Firestore's 500-operation hard limit.
 *
 * ⚠️  Each chunk is committed independently; this is NOT a single atomic
 * transaction. For a fully atomic cascade you need Cloud Functions with the
 * Firebase Admin SDK.
 */
export async function deleteGroupCascade(groupId: string, adminUserId: string): Promise<void> {
  // ── 1. Feature flag guard ────────────────────────────────────────────────
  if (process.env.ALLOW_DELETE_GROUP !== 'true') {
    throw new Error('Group deletion is disabled');
  }

  // ── 2. Auth guard ────────────────────────────────────────────────────────
  const admin = await getUserGroupMember(groupId, adminUserId);
  if (!admin || admin.role !== 'admin') {
    throw new Error('Admin privileges required to delete this group');
  }

  // ── 2. Fetch all documents that need to be removed ───────────────────────
  const [betsSnap, matchesSnap, membersSnap] = await Promise.all([
    getDocs(query(collection(db, 'bets'),    where('groupId', '==', groupId))),
    getDocs(query(collection(db, 'matches'), where('groupId', '==', groupId))),
    getDocs(collection(db, 'groups', groupId, 'members')),
  ]);

  const betDocs     = betsSnap.docs;
  const matchDocs   = matchesSnap.docs;
  const memberDocs  = membersSnap.docs;
  const memberIds   = memberDocs.map((d) => d.id);

  const totalOps =
    betDocs.length +    // delete bets
    matchDocs.length +  // delete matches
    1 +                 // delete group doc
    memberDocs.length + // delete member subcollection docs
    memberIds.length;   // arrayRemove groupId from each users/{uid}

  console.info(
    `[deleteGroupCascade] groupId=${groupId} | ` +
    `bets=${betDocs.length} matches=${matchDocs.length} ` +
    `members=${memberDocs.length} totalOps=${totalOps}`
  );

  // ── 3. Build all batches ─────────────────────────────────────────────────
  //
  // Ordering rationale:
  //   a) Delete bets + matches first (no Firestore-Rules dependency).
  //   b) Delete the group doc BEFORE member docs so that any in-flight Rules
  //      check that calls isGroupAdmin() is already working with a gone group.
  //   c) Delete member subcollection docs.
  //   d) Strip groupId from each users/{uid} profile last (best-effort cleanup).
  //
  const batches: WriteBatch[] = [];
  let current = writeBatch(db);
  let opCount = 0;

  function enqueue(operation: (b: WriteBatch) => void): void {
    if (opCount >= BATCH_LIMIT) {
      batches.push(current);
      current = writeBatch(db);
      opCount = 0;
    }
    operation(current);
    opCount++;
  }

  // (a) Bets
  for (const d of betDocs) {
    enqueue((b) => b.delete(d.ref));
  }

  // (b) Matches
  for (const d of matchDocs) {
    enqueue((b) => b.delete(d.ref));
  }

  // (b) Group document — must land in the same batch as the last member delete
  //     or an earlier one so Rules are satisfied. We append it here so it
  //     commits together with or before the member docs.
  enqueue((b) => b.delete(doc(db, 'groups', groupId)));

  // (c) Member subcollection docs
  for (const d of memberDocs) {
    enqueue((b) => b.delete(d.ref));
  }

  // (d) Strip groupId from users/{uid}.groupIds for EVERY member
  for (const uid of memberIds) {
    enqueue((b) =>
      b.update(doc(db, 'users', uid), { groupIds: arrayRemove(groupId) })
    );
  }

  // Push the last in-progress batch (it will have at least the group delete)
  if (opCount > 0) {
    batches.push(current);
  }

  console.info(
    `[deleteGroupCascade] committing ${batches.length} batch(es) ` +
    `(${totalOps} ops, limit=${BATCH_LIMIT}/batch)`
  );

  // ── 4. Commit all batches sequentially ─────────────────────────────────
  await flushBatches(batches, `groupId=${groupId}`);

  console.info(`[deleteGroupCascade] completed — groupId=${groupId}`);
}

