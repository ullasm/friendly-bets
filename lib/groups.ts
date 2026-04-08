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
  query,
  where,
  orderBy,
  serverTimestamp,
  arrayUnion,
} from 'firebase/firestore';
import type { Timestamp } from 'firebase/firestore';
import { db } from './firebase';

// ── interfaces ────────────────────────────────────────────────────────────────

export interface Group {
  groupId: string;
  name: string;
  createdBy: string;
  inviteCode: string;
  createdAt: Timestamp;
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
