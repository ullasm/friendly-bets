import { getAdminDb } from '@/lib/firebaseAdmin';
import {
  getActiveMatches,
  updateMasterMatchStatus,
  saveSourceData,
  markSourceDataParsed,
} from '@/lib/masterMatches';
import { fetchMatchInfo, parseMatchInfoUpdate } from '@/lib/cricapiSeries';
import type { MatchResult, NoDrawPolicy } from '@/lib/settleMatch';
import { FieldValue } from 'firebase-admin/firestore';

// ── Admin-SDK settlement ───────────────────────────────────────────────────────
//
// settleMatch.ts uses the client SDK (for use in the browser).
// Server-side sync uses the Admin SDK (bypasses Firestore security rules).

async function adminSettleMatch(
  matchId: string,
  groupId: string,
  result: MatchResult,
  noDrawPolicy: NoDrawPolicy
): Promise<string> {
  const matchRef = getAdminDb().doc(`matches/${matchId}`);
  const matchSnap = await matchRef.get();
  if (!matchSnap.exists) return 'match_not_found';

  const matchData = matchSnap.data()!;
  if (matchData.status === 'completed' || matchData.status === 'abandoned') {
    return 'already_settled';
  }

  const betsSnap = await getAdminDb()
    .collection('bets')
    .where('matchId', '==', matchId)
    .where('groupId', '==', groupId)
    .get();

  const bets = betsSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as Array<{
    id: string;
    userId: string;
    stake: number;
    pickedOutcome: string;
  }>;

  const groupSnap = await getAdminDb().doc(`groups/${groupId}`).get();
  const rolloverPot = (groupSnap.data()?.rolloverPot as number | undefined) ?? 0;

  const batch = getAdminDb().batch();

  const baseMatchUpdate = {
    bettingOpen: false,
    bettingClosedAt: new Date(),
    result,
  };

  if (bets.length === 0) {
    const finalStatus = result === 'abandoned' ? 'abandoned' : 'completed';
    batch.update(matchRef, { ...baseMatchUpdate, status: finalStatus });
    await batch.commit();
    return 'no_bets';
  }

  if (result === 'abandoned') {
    for (const bet of bets) {
      batch.update(getAdminDb().doc(`bets/${bet.id}`), { status: 'refunded', pointsDelta: 0 });
    }
    batch.update(matchRef, { ...baseMatchUpdate, status: 'abandoned' });
    await batch.commit();
    return 'refund';
  }

  const winnerBets = bets.filter((b) => b.pickedOutcome === result);
  const loserBets  = bets.filter((b) => b.pickedOutcome !== result);
  const isDrawLike = result === 'draw';
  const noWinners  = winnerBets.length === 0;

  if (isDrawLike && noWinners && noDrawPolicy === 'rollover') {
    for (const bet of bets) {
      batch.update(getAdminDb().doc(`bets/${bet.id}`), { status: 'locked', pointsDelta: 0 });
    }
    const thisPot = bets.reduce((s, b) => s + b.stake, 0);
    batch.update(getAdminDb().doc(`groups/${groupId}`), { rolloverPot: FieldValue.increment(thisPot) });
    batch.update(matchRef, { ...baseMatchUpdate, status: 'completed' });
    await batch.commit();
    return 'rollover';
  }

  if (isDrawLike && noWinners && noDrawPolicy === 'refund') {
    for (const bet of bets) {
      batch.update(getAdminDb().doc(`bets/${bet.id}`), { status: 'refunded', pointsDelta: 0 });
    }
    batch.update(matchRef, { ...baseMatchUpdate, status: 'completed' });
    await batch.commit();
    return 'refund';
  }

  // Payout
  const totalWinnerStake = winnerBets.reduce((s, b) => s + b.stake, 0);
  const totalLoserStake  = loserBets.reduce((s, b) => s + b.stake, 0);
  const distributedPot   = totalLoserStake + rolloverPot;

  const rawShares = winnerBets.map((bet) => ({
    bet,
    share: Math.floor((bet.stake / totalWinnerStake) * distributedPot),
  }));

  const totalAllocated    = rawShares.reduce((s, w) => s + w.share, 0);
  const roundingRemainder = distributedPot - totalAllocated;
  if (roundingRemainder > 0 && rawShares.length > 0) {
    const sortedIndices = rawShares
      .map((_, i) => i)
      .sort((a, b) =>
        rawShares[b].bet.stake !== rawShares[a].bet.stake
          ? rawShares[b].bet.stake - rawShares[a].bet.stake
          : a - b
      );
    for (let r = 0; r < roundingRemainder; r++) {
      rawShares[sortedIndices[r % sortedIndices.length]].share += 1;
    }
  }

  for (const { bet, share } of rawShares) {
    batch.update(getAdminDb().doc(`bets/${bet.id}`), { status: 'won', pointsDelta: share });
    if (share !== 0) {
      batch.update(getAdminDb().doc(`groups/${groupId}/members/${bet.userId}`), {
        totalPoints: FieldValue.increment(share),
      });
    }
  }
  for (const bet of loserBets) {
    batch.update(getAdminDb().doc(`bets/${bet.id}`), { status: 'lost', pointsDelta: -bet.stake });
    batch.update(getAdminDb().doc(`groups/${groupId}/members/${bet.userId}`), {
      totalPoints: FieldValue.increment(-bet.stake),
    });
  }

  if (rolloverPot > 0) {
    batch.update(getAdminDb().doc(`groups/${groupId}`), { rolloverPot: 0 });
  }
  batch.update(matchRef, { ...baseMatchUpdate, status: 'completed' });
  await batch.commit();
  return 'payout';
}

// Find all group matches linked to a masterMatch and settle them
async function propagateResultToGroupMatches(
  cricApiMatchId: string,
  result: MatchResult
): Promise<string[]> {
  const snap = await getAdminDb()
    .collection('matches')
    .where('cricApiMatchId', '==', cricApiMatchId)
    .get();

  const settled: string[] = [];

  await Promise.all(
    snap.docs.map(async (d) => {
      const match = d.data();
      if (match.status === 'completed' || match.status === 'abandoned') return;

      const matchId = d.id;
      const groupId = match.groupId as string;
      const noDrawPolicy = (match.noDrawPolicy ?? 'refund') as NoDrawPolicy;

      try {
        const outcome = await adminSettleMatch(matchId, groupId, result, noDrawPolicy);
        settled.push(`${matchId}(${outcome})`);
      } catch (err) {
        console.error(`[propagate] Failed to settle matchId=${matchId}:`, err);
      }
    })
  );

  return settled;
}

export async function runSync(): Promise<Response> {
  const now = new Date();

  // 1. Fetch all active (not ended) masterMatches
  const activeMatches = await getActiveMatches();
  if (activeMatches.length === 0) {
    return Response.json({ synced: 0, reason: 'no_active_matches' });
  }

  const results: string[] = [];

  // 2. Mark matches as live if start time has passed and close betting
  const justStarted = activeMatches.filter(
    (m) => !m.matchStarted && m.startsAt.toDate() <= now
  );

  if (justStarted.length > 0) {
    const startedIds = justStarted.map((m) => m.sourceMatchId);

    try {
      for (let i = 0; i < startedIds.length; i += 30) {
        const chunk = startedIds.slice(i, i + 30);
        const snap = await getAdminDb()
          .collection('matches')
          .where('cricApiMatchId', 'in', chunk)
          .get();
        const batch = getAdminDb().batch();
        let changed = false;
        for (const d of snap.docs) {
          if (d.data().bettingOpen === true) {
            batch.update(d.ref, { bettingOpen: false, bettingClosedAt: new Date() });
            changed = true;
          }
        }
        if (changed) await batch.commit();
      }
    } catch (err) {
      results.push(`warn: could not close betting for just-started matches — ${String(err)}`);
    }

    await Promise.all(
      justStarted.map((m) =>
        updateMasterMatchStatus(m.sourceMatchId, {
          matchStarted: true,
          status: 'live',
        })
      )
    );
    results.push(`marked_live: ${justStarted.length}`);
  }

  // 3. For currently live matches, call CricAPI to get updated status
  const liveMatches = activeMatches.filter((m) => m.matchStarted && !m.matchEnded);
  const allLive = [...liveMatches, ...justStarted];

  if (allLive.length === 0) {
    return Response.json({ synced: 0, reason: 'no_live_matches', details: results });
  }

  let apiCallCount = 0;

  await Promise.all(
    allLive.map(async (m) => {
      try {
        const raw = await fetchMatchInfo(m.sourceMatchId);
        apiCallCount++;

        const sourceDataId = await saveSourceData({
          type: 'match_info',
          api: 'cricapi',
          data: JSON.stringify(raw),
          parsed: false,
        });

        const updates = parseMatchInfoUpdate(raw, m);
        await updateMasterMatchStatus(m.sourceMatchId, updates);
        await markSourceDataParsed(sourceDataId);

        results.push(`updated: ${m.sourceMatchId} → ${updates.status}`);

        // Propagate completed result to all group matches linked via cricApiMatchId
        if (updates.matchEnded && updates.result && updates.result !== 'pending') {
          const settled = await propagateResultToGroupMatches(
            m.sourceMatchId,
            updates.result as MatchResult
          );
          if (settled.length > 0) {
            results.push(`settled group matches: ${settled.join(', ')}`);
          }
        }
      } catch (err) {
        results.push(`error: ${m.sourceMatchId} — ${String(err)}`);
      }
    })
  );

  return Response.json({ synced: allLive.length, apiCalls: apiCallCount, details: results });
}
