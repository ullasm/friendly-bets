import { collection, query, where, getDocs, updateDoc, doc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import {
  getActiveMatches,
  updateMasterMatchStatus,
  saveSourceData,
  markSourceDataParsed,
} from '@/lib/masterMatches';
import { fetchMatchInfo, parseMatchInfoUpdate } from '@/lib/cricapiSeries';
import { declareMatchResult } from '@/lib/settleMatch';
import type { MatchResult, NoDrawPolicy } from '@/lib/settleMatch';

// Find all group matches linked to a masterMatch and settle them
async function propagateResultToGroupMatches(
  cricApiMatchId: string,
  result: MatchResult
): Promise<string[]> {
  const snap = await getDocs(
    query(collection(db, 'matches'), where('cricApiMatchId', '==', cricApiMatchId))
  );

  const settled: string[] = [];

  await Promise.all(
    snap.docs.map(async (d) => {
      const match = d.data();
      // Skip already-settled matches unless we want to re-declare
      if (match.status === 'completed' || match.status === 'abandoned') return;

      const matchId = d.id;
      const groupId = match.groupId as string;
      const noDrawPolicy = (match.noDrawPolicy ?? 'refund') as NoDrawPolicy;

      try {
        await declareMatchResult(matchId, groupId, result, noDrawPolicy);
        settled.push(matchId);
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

  // 2. Mark matches as live if start time has passed
  const justStarted = activeMatches.filter(
    (m) => !m.matchStarted && m.startsAt.toDate() <= now
  );

  if (justStarted.length > 0) {
    const startedIds = justStarted.map((m) => m.sourceMatchId);

    try {
      for (let i = 0; i < startedIds.length; i += 30) {
        const chunk = startedIds.slice(i, i + 30);
        const snap = await getDocs(
          query(collection(db, 'matches'), where('cricApiMatchId', 'in', chunk))
        );
        await Promise.all(
          snap.docs
            .filter((d) => d.data().bettingOpen === true)
            .map((d) =>
              updateDoc(doc(db, 'matches', d.id), {
                bettingOpen: false,
                bettingClosedAt: new Date(),
              })
            )
        );
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
