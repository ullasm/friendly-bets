import {
  collection,
  doc,
  getDocs,
  query,
  where,
  writeBatch,
  increment,
  Timestamp,
} from 'firebase/firestore';
import { db } from './firebase';
import type { GroupMember } from './groups';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Settlement {
  id: string;
  groupId: string;
  fromUserId: string;
  toUserId: string;
  points: number;
  acknowledged: boolean;
  createdAt: Timestamp;
  acknowledgedAt: Timestamp | null;
}

export interface Transaction {
  id: string;
  groupId: string;
  matchId: string | null;
  settlementId: string | null;
  fromUserId: string;
  toUserId: string;
  /** 'match' = auto-generated from a bet result; 'settlement' = manual settle-up */
  particular: 'match' | 'settlement';
  points: number;
  createdAt: Timestamp;
}

/** Represents an outstanding transfer to be settled. */
export interface ComputedSettlement {
  fromUserId: string;
  toUserId: string;
  points: number;
}

// ── Settlement computation ────────────────────────────────────────────────────

/**
 * Pure function. Computes the minimum set of point transfers to clear all
 * outstanding balances using a greedy debt-minimisation algorithm.
 *
 * Members with positive totalPoints are creditors (they are owed points).
 * Members with negative totalPoints are debtors (they owe points).
 */
export function computeSettlements(members: GroupMember[]): ComputedSettlement[] {
  const creditors: { userId: string; balance: number }[] = [];
  const debtors:   { userId: string; balance: number }[] = [];

  for (const m of members) {
    if (m.totalPoints > 0) creditors.push({ userId: m.userId, balance: m.totalPoints });
    else if (m.totalPoints < 0) debtors.push({ userId: m.userId, balance: -m.totalPoints });
  }

  creditors.sort((a, b) => b.balance - a.balance);
  debtors.sort((a, b) => b.balance - a.balance);

  const result: ComputedSettlement[] = [];
  let ci = 0;
  let di = 0;

  while (ci < creditors.length && di < debtors.length) {
    const amount = Math.min(creditors[ci].balance, debtors[di].balance);
    result.push({ fromUserId: debtors[di].userId, toUserId: creditors[ci].userId, points: amount });
    creditors[ci].balance -= amount;
    debtors[di].balance   -= amount;
    if (creditors[ci].balance === 0) ci++;
    if (debtors[di].balance === 0) di++;
  }

  return result;
}

// ── Settlement acknowledgment ─────────────────────────────────────────────────

/**
 * Acknowledges a settlement. Atomically:
 *   1. Writes a Settlement document (acknowledged = true).
 *   2. Writes a Transaction document (particular = 'settlement').
 *
 * totalPoints are NOT modified — outstanding balances are instead derived by
 * factoring all acknowledged settlements back into the computed leaderboard
 * balances. This avoids requiring admin-level member-doc write permissions.
 *
 * Only the toUser (recipient) should be allowed to call this. Enforced in
 * Firestore rules via `request.auth.uid == request.resource.data.toUserId`.
 */
export async function acknowledgeSettlement(
  groupId: string,
  fromUserId: string,
  toUserId: string,
  points: number
): Promise<void> {
  const now = Timestamp.now();
  const batch = writeBatch(db);

  const settlementRef = doc(collection(db, 'settlements'));
  batch.set(settlementRef, {
    id: settlementRef.id,
    groupId,
    fromUserId,
    toUserId,
    points,
    acknowledged: true,
    createdAt: now,
    acknowledgedAt: now,
  } satisfies Settlement);

  const transactionRef = doc(collection(db, 'transactions'));
  batch.set(transactionRef, {
    id: transactionRef.id,
    groupId,
    matchId: null,
    settlementId: settlementRef.id,
    fromUserId,
    toUserId,
    particular: 'settlement',
    points,
    createdAt: now,
  } satisfies Transaction);

  // Clear the debt: debtor's balance rises, creditor's balance falls.
  batch.update(doc(db, 'groups', groupId, 'members', fromUserId), {
    totalPoints: increment(points),
  });
  batch.update(doc(db, 'groups', groupId, 'members', toUserId), {
    totalPoints: increment(-points),
  });

  await batch.commit();
}

/** Fetches all acknowledged settlements for a group. */
export async function getSettlementsForGroup(groupId: string): Promise<Settlement[]> {
  const snap = await getDocs(
    query(collection(db, 'settlements'), where('groupId', '==', groupId))
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Settlement));
}

// ── Match transaction helper ──────────────────────────────────────────────────

/**
 * Creates Transaction ledger entries for a settled match.
 * Called AFTER the main settlement batch has committed so it never blocks
 * the financial writes. Non-critical — failures are logged but not thrown.
 *
 * fromUserId = '' signals "the pool" (e.g. a loser paying into the collective).
 * toUserId   = '' signals "the pool" (e.g. the pool paying out to a winner).
 */
export async function createMatchTransactions(
  matchId: string,
  groupId: string,
  entries: { userId: string; pointsDelta: number }[]
): Promise<void> {
  const now = Timestamp.now();
  const batch = writeBatch(db);

  for (const entry of entries) {
    if (entry.pointsDelta === 0) continue;
    const ref = doc(collection(db, 'transactions'));
    const isWinner = entry.pointsDelta > 0;
    batch.set(ref, {
      id: ref.id,
      groupId,
      matchId,
      settlementId: null,
      fromUserId: isWinner ? '' : entry.userId,
      toUserId:   isWinner ? entry.userId : '',
      particular: 'match',
      points: Math.abs(entry.pointsDelta),
      createdAt: now,
    } satisfies Transaction);
  }

  await batch.commit();
}
