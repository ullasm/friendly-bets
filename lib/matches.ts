import {
  collection,
  doc,
  addDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  query,
  where,
  limit,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import type { Timestamp as TimestampType } from 'firebase/firestore';
import { db } from './firebase';
import {
  settleMatch as settleMatchEngine,
  rollbackSettlement,
  declareMatchResult as declareMatchResultEngine,
} from './settleMatch';
export type { SettlementSummary, MatchResult, NoDrawPolicy } from './settleMatch';

// -- interfaces ---------------------------------------------------------------

export interface Match {
  id: string;
  groupId: string;
  teamA: string;
  teamB: string;
  format: 'T20' | 'ODI' | 'Test';
  drawAllowed: boolean;
  matchDate: TimestampType;
  status: 'upcoming' | 'live' | 'completed' | 'abandoned';
  result: 'team_a' | 'team_b' | 'draw' | 'pending' | 'abandoned';
  noDrawPolicy: 'refund' | 'rollover';
  bettingOpen: boolean;
  bettingClosedAt: TimestampType | null;
  cricApiMatchId: string | null;
}

export interface LeaderboardUser {
  uid: string;
  displayName: string;
  email: string;
  role: 'admin' | 'member';
  avatarColor: string;
}

export interface Bet {
  id: string;
  matchId: string;
  groupId: string;
  userId: string;
  pickedOutcome: 'team_a' | 'team_b' | 'draw';
  stake: number;
  pointsDelta: number | null;
  /**
   * pending  — bet not yet settled
   * won      — bet won; pointsDelta is the net gain
   * lost     — bet lost; pointsDelta is the negative stake
   * refunded — match abandoned or draw-refund policy; pointsDelta = 0
   * locked   — pot rolled over to next match; pointsDelta = 0 until paid out
   */
  status: 'pending' | 'won' | 'lost' | 'refunded' | 'locked';
  placedAt: TimestampType;
}

export interface BetInput {
  pickedOutcome: Bet['pickedOutcome'];
  stake: number;
}


// -- match functions ----------------------------------------------------------

export async function getMatches(groupId: string): Promise<Match[]> {
  const snap = await getDocs(
    query(collection(db, 'matches'), where('groupId', '==', groupId))
  );
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() } as Match))
    .sort((a, b) => b.matchDate.toMillis() - a.matchDate.toMillis());
}

export async function getMatchById(matchId: string): Promise<Match | null> {
  const snap = await getDoc(doc(db, 'matches', matchId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() } as Match;
}

export async function createMatch(
  groupId: string,
  matchData: Record<string, unknown>
): Promise<string> {
  const ref = await addDoc(collection(db, 'matches'), {
    ...matchData,
    groupId,
  });
  return ref.id;
}

export async function updateMatch(
  matchId: string,
  updates: Partial<Match>
): Promise<void> {
  await updateDoc(doc(db, 'matches', matchId), updates);
}

export async function deleteMatch(matchId: string): Promise<void> {
  await deleteDoc(doc(db, 'matches', matchId));
}

// -- bet functions ------------------------------------------------------------

export async function placeBet(
  matchId: string,
  groupId: string,
  userId: string,
  bet: BetInput
): Promise<void> {
  // Check if user already has a bet for this match
  const existingBet = await getUserBetForMatch(matchId, userId);
  if (existingBet) {
    // Update existing bet
    await updateDoc(doc(db, 'bets', existingBet.id), {
      pickedOutcome: bet.pickedOutcome,
      stake: bet.stake,
      placedAt: serverTimestamp(),
    });
  } else {
    // Create new bet
    await addDoc(collection(db, 'bets'), {
      matchId,
      groupId,
      userId,
      pickedOutcome: bet.pickedOutcome,
      stake: bet.stake,
      pointsDelta: null,
      status: 'pending',
      placedAt: serverTimestamp(),
    });
  }
}

export async function getUserBetForMatch(
  matchId: string,
  userId: string
): Promise<Bet | null> {
  const snap = await getDocs(
    query(
      collection(db, 'bets'),
      where('matchId', '==', matchId),
      where('userId', '==', userId),
      limit(1)
    )
  );
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...d.data() } as Bet;
}

/**
 * Upserts (creates or updates) a user's bet for a match.
 * Used by the betting UI.
 * @returns The bet ID if a new bet was created, void if updated
 */
export async function upsertUserBetForMatch(
  matchId: string,
  groupId: string,
  userId: string,
  pickedOutcome: Bet['pickedOutcome'],
  stake: number
): Promise<string | void> {
  const existingBet = await getUserBetForMatch(matchId, userId);
  
  if (existingBet) {
    // Update existing bet
    await updateDoc(doc(db, 'bets', existingBet.id), {
      pickedOutcome,
      stake,
      placedAt: serverTimestamp(),
    });
  } else {
    // Create new bet
    const ref = await addDoc(collection(db, 'bets'), {
      matchId,
      groupId,
      userId,
      pickedOutcome,
      stake,
      pointsDelta: null,
      status: 'pending',
      placedAt: serverTimestamp(),
    });
    return ref.id;
  }
}

/**
 * Removes a user's bet for a match.
 * Used by the betting UI.
 */
export async function removeUserBetForMatch(
  matchId: string,
  userId: string
): Promise<void> {
  const existingBet = await getUserBetForMatch(matchId, userId);
  if (existingBet) {
    await deleteDoc(doc(db, 'bets', existingBet.id));
  }
}

/**
 * Closes betting for a match by setting bettingOpen to false.
 * Used by the group dashboard for admin actions.
 */
export async function closeBettingForMatch(matchId: string): Promise<void> {
  await updateDoc(doc(db, 'matches', matchId), {
    bettingOpen: false,
    bettingClosedAt: serverTimestamp(),
  });
}

/**
 * Returns all bets for a user in a group.
 * Requires composite index: bets [ userId ASC, groupId ASC ]
 */
export async function getUserBetsForGroup(
  groupId: string,
  userId: string
): Promise<Bet[]> {
  const snap = await getDocs(
    query(
      collection(db, 'bets'),
      where('userId', '==', userId),
      where('groupId', '==', groupId)
    )
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Bet));
}

/**
 * Returns the last N settled bets for a user in a group, ordered by matchDate.
 * Only includes bets with status 'won', 'lost', 'refunded', or 'locked' (excludes 'pending').
 * Returns most recent N bets, sorted left-to-right by match date (oldest first, newest last).
 */
export async function getLastNBetsForUser(
  groupId: string,
  userId: string,
  n: number = 5
): Promise<Bet[]> {
  const snap = await getDocs(
    query(
      collection(db, 'bets'),
      where('userId', '==', userId),
      where('groupId', '==', groupId)
    )
  );
  
  // Get all non-pending bets
  const bets = snap.docs
    .map((d) => ({ id: d.id, ...d.data() } as Bet))
    .filter((bet) => bet.status !== 'pending');
  
  // Fetch match data for each bet to get matchDate
  const betsWithMatchDate = await Promise.all(
    bets.map(async (bet) => {
      try {
        const matchSnap = await getDoc(doc(db, 'matches', bet.matchId));
        const matchData = matchSnap.exists() ? matchSnap.data() : null;
        return {
          ...bet,
          matchDate: matchData ? (matchData.matchDate as TimestampType) : bet.placedAt,
        };
      } catch {
        // Fallback to placedAt if match fetch fails
        return {
          ...bet,
          matchDate: bet.placedAt,
        };
      }
    })
  );
  
  // Sort by matchDate descending (newest first) to get most recent bets
  // Then take last N (most recent N) and reverse to ascending (oldest first, left to right)
  return betsWithMatchDate
    .sort((a, b) => b.matchDate.toMillis() - a.matchDate.toMillis())
    .slice(0, n)
    .reverse();
}

/**
 * Returns all bets placed in a group across all matches.
 * Single-field query — no composite index required.
 */
export async function getBetsForGroup(groupId: string): Promise<Bet[]> {
  const snap = await getDocs(
    query(collection(db, 'bets'), where('groupId', '==', groupId))
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Bet));
}

/**
 * Returns all bets for a specific match scoped to a group.
 * Requires composite index: bets [ matchId ASC, groupId ASC ]
 */
export async function getBetsForMatch(matchId: string, groupId: string): Promise<Bet[]> {
  const snap = await getDocs(
    query(
      collection(db, 'bets'),
      where('matchId', '==', matchId),
      where('groupId', '==', groupId)
    )
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Bet));
}

/**
 * Returns all bets from all members for a specific match in a group.
 * Alias of getBetsForMatch — kept for clarity at call sites (settlement, admin).
 * Requires composite index: bets [ matchId ASC, groupId ASC ]
 */
export async function getGroupBetsForMatch(
  matchId: string,
  groupId: string
): Promise<Bet[]> {
  return getBetsForMatch(matchId, groupId);
}

/**
 * Returns one specific member's bet for a match, or null.
 * Requires composite index: bets [ userId ASC, matchId ASC, groupId ASC ]
 */
export async function getMemberBetForMatch(
  matchId: string,
  groupId: string,
  userId: string
): Promise<Bet | null> {
  const snap = await getDocs(
    query(
      collection(db, 'bets'),
      where('userId', '==', userId),
      where('matchId', '==', matchId),
      where('groupId', '==', groupId),
      limit(1)
    )
  );
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...d.data() } as Bet;
}

// -- settlement (delegates to lib/settleMatch.ts) -----------------------------

/**
 * Settles a match. Delegates to the full settlement engine in lib/settleMatch.ts.
 * @see settleMatch.ts for full rollover / proportional payout logic.
 */
export async function settleMatch(
  matchId: string,
  groupId: string,
  result: string,
  noDrawPolicy: string
): Promise<void> {
  await settleMatchEngine({
    matchId,
    groupId,
    result:       result       as import('./settleMatch').MatchResult,
    noDrawPolicy: noDrawPolicy as import('./settleMatch').NoDrawPolicy,
  });
}

/**
 * Declares (or re-declares) a match result. Rolls back any prior settlement
 * before applying the new one. Returns a SettlementSummary for UI toasts.
 */
export async function declareMatchResult(
  matchId: string,
  groupId: string,
  result: 'team_a' | 'team_b' | 'draw' | 'abandoned',
  noDrawPolicy: Match['noDrawPolicy']
): Promise<import('./settleMatch').SettlementSummary> {
  if (process.env.ALLOW_MANAGE_MATCHES !== 'true') {
    throw new Error('Match management is disabled');
  }
  return declareMatchResultEngine(matchId, groupId, result, noDrawPolicy);
}


export async function adminUpsertBetForMatch(
  matchId: string,
  groupId: string,
  userId: string,
  betInput: BetInput
): Promise<void> {
  if (process.env.ALLOW_MANAGE_MATCHES !== 'true') {
    throw new Error('Match management is disabled');
  }
  const currentMatch = await getMatchById(matchId);
  if (!currentMatch) {
    throw new Error('Match not found');
  }

  if (betInput.pickedOutcome === 'draw' && !currentMatch.drawAllowed) {
    throw new Error('Draw is not allowed for this match');
  }

  const shouldResettle = currentMatch.status === 'completed' || currentMatch.status === 'abandoned';

  if (shouldResettle) {
    await rollbackSettlement(matchId, groupId);
  }

  const existingBet = await getMemberBetForMatch(matchId, groupId, userId);

  if (existingBet) {
    await updateDoc(doc(db, 'bets', existingBet.id), {
      pickedOutcome: betInput.pickedOutcome,
      stake: betInput.stake,
      pointsDelta: null,
      status: 'pending',
    });
  } else {
    await addDoc(collection(db, 'bets'), {
      matchId,
      groupId,
      userId,
      pickedOutcome: betInput.pickedOutcome,
      stake: betInput.stake,
      pointsDelta: null,
      status: 'pending',
      placedAt: serverTimestamp(),
    });
  }

  if (shouldResettle) {
    await settleMatchEngine({
      matchId,
      groupId,
      result:       currentMatch.result as Match['result'] & import('./settleMatch').MatchResult,
      noDrawPolicy: currentMatch.noDrawPolicy,
    });
  }
}

export async function adminClearBetForMatch(
  matchId: string,
  groupId: string,
  userId: string
): Promise<void> {
  if (process.env.ALLOW_MANAGE_MATCHES !== 'true') {
    throw new Error('Match management is disabled');
  }
  const currentMatch = await getMatchById(matchId);
  if (!currentMatch) {
    throw new Error('Match not found');
  }

  const existingBet = await getMemberBetForMatch(matchId, groupId, userId);
  if (!existingBet) {
    return;
  }

  const shouldResettle = currentMatch.status === 'completed' || currentMatch.status === 'abandoned';

  if (shouldResettle) {
    await rollbackSettlement(matchId, groupId);
  }

  await deleteDoc(doc(db, 'bets', existingBet.id));

  if (shouldResettle) {
    await settleMatch(matchId, groupId, currentMatch.result, currentMatch.noDrawPolicy);
  }
}

/**
 * Returns all completed matches for a group, ordered by matchDate ascending.
 * Used for the running total ledger to show match history chronologically.
 */
export async function getCompletedMatchesForGroup(groupId: string): Promise<Match[]> {
  const snap = await getDocs(
    query(
      collection(db, 'matches'),
      where('groupId', '==', groupId),
      where('status', '==', 'completed')
    )
  );
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() } as Match))
    .sort((a, b) => a.matchDate.toMillis() - b.matchDate.toMillis());
}
