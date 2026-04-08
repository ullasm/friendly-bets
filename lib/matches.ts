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
  orderBy,
  increment,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import type { Timestamp as TimestampType } from 'firebase/firestore';
import { db } from './firebase';

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
  totalPoints: number;
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
  status: 'pending' | 'won' | 'lost' | 'refunded';
  placedAt: TimestampType;
}

export interface BetInput {
  pickedOutcome: Bet['pickedOutcome'];
  stake: number;
}

function groupMemberRef(groupId: string, userId: string) {
  return doc(db, 'groups', groupId, 'members', userId);
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
  fields: Partial<Pick<Match, 'teamA' | 'teamB' | 'format' | 'drawAllowed' | 'noDrawPolicy' | 'matchDate' | 'bettingOpen'>>
): Promise<void> {
  await updateDoc(doc(db, 'matches', matchId), fields as Record<string, unknown>);
}

export async function deleteMatch(matchId: string): Promise<void> {
  await deleteDoc(doc(db, 'matches', matchId));
}

// -- bet functions ------------------------------------------------------------

export async function placeBet(
  matchId: string,
  groupId: string,
  userId: string,
  pickedOutcome: 'team_a' | 'team_b' | 'draw',
  stake: number
): Promise<string> {
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

export async function getUserBetsForGroup(
  groupId: string,
  userId: string
): Promise<Bet[]> {
  const snap = await getDocs(
    query(collection(db, 'bets'), where('userId', '==', userId))
  );
  return snap.docs
    .filter((d) => d.data().groupId === groupId)
    .map((d) => ({ id: d.id, ...d.data() } as Bet));
}

export async function getBetsForGroup(groupId: string): Promise<Bet[]> {
  const snap = await getDocs(
    query(collection(db, 'bets'), where('groupId', '==', groupId))
  );

  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Bet));
}

export async function getUserBetForMatch(
  matchId: string,
  userId: string
): Promise<Bet | null> {
  const snap = await getDocs(
    query(collection(db, 'bets'), where('userId', '==', userId))
  );
  if (snap.empty) return null;
  const found = snap.docs.find((d) => d.data().matchId === matchId);
  if (!found) return null;
  return { id: found.id, ...found.data() } as Bet;
}

export async function getGroupBetsForMatch(
  matchId: string,
  groupId: string
): Promise<Bet[]> {
  const snap = await getDocs(
    query(collection(db, 'bets'), where('groupId', '==', groupId))
  );
  return snap.docs
    .filter((d) => d.data().matchId === matchId)
    .map((d) => ({ id: d.id, ...d.data() } as Bet));
}

export async function getMemberBetForMatch(
  matchId: string,
  groupId: string,
  userId: string
): Promise<Bet | null> {
  const bets = await getGroupBetsForMatch(matchId, groupId);
  return bets.find((bet) => bet.userId === userId) ?? null;
}

async function rollbackSettledMatch(matchId: string, groupId: string): Promise<void> {
  const bets = await getGroupBetsForMatch(matchId, groupId);

  await Promise.all(
    bets.map(async (bet) => {
      const previousDelta = bet.pointsDelta ?? 0;

      if (previousDelta !== 0) {
        await updateDoc(groupMemberRef(groupId, bet.userId), {
          totalPoints: increment(-previousDelta),
        });
      }

      await updateDoc(doc(db, 'bets', bet.id), {
        status: 'pending',
        pointsDelta: null,
      });
    })
  );
}

// -- settlement ---------------------------------------------------------------

export async function settleMatch(
  matchId: string,
  groupId: string,
  result: string,
  noDrawPolicy: string
): Promise<void> {
  const bets = await getGroupBetsForMatch(matchId, groupId);
  const matchRef = doc(db, 'matches', matchId);

  async function refundAll() {
    await Promise.all(
      bets.map((b) =>
        updateDoc(doc(db, 'bets', b.id), { status: 'refunded', pointsDelta: 0 })
      )
    );
  }

  if (result === 'abandoned') {
    await refundAll();
    await updateDoc(matchRef, {
      status: 'abandoned',
      result: 'abandoned',
      bettingOpen: false,
      bettingClosedAt: Timestamp.now(),
    });
    return;
  }

  if (result === 'draw') {
    const drawBets = bets.filter((b) => b.pickedOutcome === 'draw');
    const otherBets = bets.filter((b) => b.pickedOutcome !== 'draw');

    if (drawBets.length === 0) {
      if (noDrawPolicy === 'refund') {
        await refundAll();
      }
      await updateDoc(matchRef, {
        status: 'completed',
        result: 'draw',
        bettingOpen: false,
        bettingClosedAt: Timestamp.now(),
      });
      return;
    }

    const losersStake = otherBets.reduce((sum, bet) => sum + bet.stake, 0);
    const winnerShare = Math.floor(losersStake / drawBets.length);

    await Promise.all([
      ...drawBets.map((bet) =>
        updateDoc(doc(db, 'bets', bet.id), { status: 'won', pointsDelta: winnerShare }).then(() =>
          updateDoc(groupMemberRef(groupId, bet.userId), { totalPoints: increment(winnerShare) })
        )
      ),
      ...otherBets.map((bet) =>
        updateDoc(doc(db, 'bets', bet.id), { status: 'lost', pointsDelta: -bet.stake }).then(() =>
          updateDoc(groupMemberRef(groupId, bet.userId), { totalPoints: increment(-bet.stake) })
        )
      ),
    ]);

    await updateDoc(matchRef, {
      status: 'completed',
      result: 'draw',
      bettingOpen: false,
      bettingClosedAt: Timestamp.now(),
    });
    return;
  }

  const winnerBets = bets.filter((bet) => bet.pickedOutcome === result);
  const loserBets = bets.filter((bet) => bet.pickedOutcome !== result);

  const losersStake = loserBets.reduce((sum, bet) => sum + bet.stake, 0);
  const winnerShare = winnerBets.length > 0 ? Math.floor(losersStake / winnerBets.length) : 0;

  await Promise.all([
    ...winnerBets.map((bet) =>
      updateDoc(doc(db, 'bets', bet.id), { status: 'won', pointsDelta: winnerShare }).then(() =>
        updateDoc(groupMemberRef(groupId, bet.userId), { totalPoints: increment(winnerShare) })
      )
    ),
    ...loserBets.map((bet) =>
      updateDoc(doc(db, 'bets', bet.id), { status: 'lost', pointsDelta: -bet.stake }).then(() =>
        updateDoc(groupMemberRef(groupId, bet.userId), { totalPoints: increment(-bet.stake) })
      )
    ),
  ]);

  await updateDoc(matchRef, {
    status: 'completed',
    result,
    bettingOpen: false,
    bettingClosedAt: Timestamp.now(),
  });
}

export async function declareMatchResult(
  matchId: string,
  groupId: string,
  result: 'team_a' | 'team_b' | 'draw' | 'abandoned',
  noDrawPolicy: string
): Promise<void> {
  const currentMatch = await getMatchById(matchId);
  if (!currentMatch) {
    throw new Error('Match not found');
  }

  if (currentMatch.status === 'completed' || currentMatch.status === 'abandoned') {
    await rollbackSettledMatch(matchId, groupId);
  }

  await settleMatch(matchId, groupId, result, noDrawPolicy);
}


export async function adminUpsertBetForMatch(
  matchId: string,
  groupId: string,
  userId: string,
  betInput: BetInput
): Promise<void> {
  const currentMatch = await getMatchById(matchId);
  if (!currentMatch) {
    throw new Error('Match not found');
  }

  const shouldResettle = currentMatch.status === 'completed' || currentMatch.status === 'abandoned';

  if (shouldResettle) {
    await rollbackSettledMatch(matchId, groupId);
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
    await settleMatch(matchId, groupId, currentMatch.result, currentMatch.noDrawPolicy);
  }
}

export async function adminClearBetForMatch(
  matchId: string,
  groupId: string,
  userId: string
): Promise<void> {
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
    await rollbackSettledMatch(matchId, groupId);
  }

  await deleteDoc(doc(db, 'bets', existingBet.id));

  if (shouldResettle) {
    await settleMatch(matchId, groupId, currentMatch.result, currentMatch.noDrawPolicy);
  }
}

// -- leaderboard --------------------------------------------------------------

export async function getAllUsers(): Promise<LeaderboardUser[]> {
  const snap = await getDocs(
    query(collection(db, 'users'), orderBy('totalPoints', 'desc'))
  );
  return snap.docs.map((d) => d.data() as LeaderboardUser);
}








