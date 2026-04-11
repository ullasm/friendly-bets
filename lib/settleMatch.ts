/**
 * lib/settleMatch.ts
 *
 * The single source of truth for match settlement.
 *
 * Responsibilities
 * ─────────────────
 * 1. Fetch all bets + the group's current rolloverPot.
 * 2. Based on the result + noDrawPolicy, decide one of four outcomes:
 *      a) Payout   — clear winners exist; matched-stake payout where winners
 *                    profit at most 1:1, losers only pay what's needed to cover
 *                    winners. RolloverPot added on top of matched winners' share.
 *      b) Rollover — no winners (draw/abandoned + noDrawPolicy = 'rollover');
 *                    add thisMatchPot to rolloverPot, mark bets 'locked'.
 *      c) Refund   — draw/abandoned + noDrawPolicy = 'refund'; return stakes.
 *      d) No-bets  — nothing to settle; just update match status.
 * 3. Write every change atomically in a single WriteBatch.
 * 4. Expose a rollbackSettlement() that exactly reverses a prior settlement
 *    by inverting each bet's stored pointsDelta.
 *
 * Atomicity note
 * ──────────────
 * Firestore client-side WriteBatch is atomic within a single commit (≤ 500 ops).
 * For groups with extremely large bet counts, consider migrating settlement to a
 * Cloud Function using the Admin SDK and a Firestore Transaction.
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  limit,
  writeBatch,
  increment,
  Timestamp,
} from 'firebase/firestore';
import type { WriteBatch as WriteBatchType } from 'firebase/firestore';
import { db } from './firebase';
import type { Bet, Match } from './matches';

// ── Public types ──────────────────────────────────────────────────────────────

export type MatchResult = 'team_a' | 'team_b' | 'draw' | 'abandoned';
export type NoDrawPolicy = 'refund' | 'rollover';

export interface SettlementInput {
  matchId: string;
  groupId: string;
  result: MatchResult;
  noDrawPolicy: NoDrawPolicy;
}

/**
 * A human-readable summary of what the settlement engine decided.
 * Returned from settleMatch() for logging / toast messages.
 */
export interface SettlementSummary {
  outcome: 'payout' | 'rollover' | 'refund' | 'no_bets';
  totalPot: number;
  rolloverPotBefore: number;
  rolloverPotAfter: number;
  /** How many bets were resolved. */
  betCount: number;
  /** Number of winners (0 for refund/rollover/no_bets). */
  winnerCount: number;
  /** Total points paid out to winners (0 for non-payout outcomes). */
  totalPayout: number;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function memberRef(groupId: string, userId: string) {
  return doc(db, 'groups', groupId, 'members', userId);
}

async function fetchBetsForMatch(matchId: string, groupId: string): Promise<Bet[]> {
  const snap = await getDocs(
    query(
      collection(db, 'bets'),
      where('matchId', '==', matchId),
      where('groupId', '==', groupId)
    )
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Bet));
}

async function fetchRolloverPot(groupId: string): Promise<number> {
  const snap = await getDoc(doc(db, 'groups', groupId));
  if (!snap.exists()) return 0;
  return (snap.data().rolloverPot as number | undefined) ?? 0;
}

/**
 * Validates that the total number of Firestore operations in this settlement
 * will not exceed the client-side WriteBatch hard limit (500 ops).
 *
 * Ops per settlement:
 *   • 1 match update
 *   • 1 group update  (rolloverPot)
 *   • N bet updates   (1 per bet)
 *   • M member updates (1 per UNIQUE userId that has a non-zero pointsDelta)
 *
 * In practice, M ≤ N, so worst case ≤ 2 + 2N ops.
 * Flag a warning if we're getting close — a Cloud Function is the right fix
 * for very large groups, but this ensures we fail fast rather than silently
 * truncating writes.
 */
function assertBatchCapacity(betCount: number): void {
  // 2 fixed writes (match + group) + up to 2 writes per bet (bet + member)
  const estimatedOps = 2 + betCount * 2;
  if (estimatedOps > 499) {
    throw new Error(
      `[settleMatch] Settlement would require ~${estimatedOps} Firestore writes ` +
      `which exceeds the 499-op client-side batch limit. ` +
      `Migrate this match to a Cloud Function for safe atomic settlement.`
    );
  }
}

// ── Core settlement logic ─────────────────────────────────────────────────────

/**
 * Settles a match fully:
 *   1. Fetches all bets + current rolloverPot
 *   2. Decides the outcome (payout / rollover / refund / no_bets)
 *   3. Writes everything atomically in a single WriteBatch
 *   4. Returns a SettlementSummary for logging / UI toasts
 */
export async function settleMatch(input: SettlementInput): Promise<SettlementSummary> {
  const { matchId, groupId, result, noDrawPolicy } = input;

  // ── 1. Read phase (all reads before any writes) ───────────────────────────
  const [bets, rolloverPotBefore] = await Promise.all([
    fetchBetsForMatch(matchId, groupId),
    fetchRolloverPot(groupId),
  ]);

  assertBatchCapacity(bets.length);

  const matchRef    = doc(db, 'matches', matchId);
  const groupRef    = doc(db, 'groups',  groupId);
  const thisPot = bets.reduce((sum, b) => sum + b.stake, 0);

  const batch = writeBatch(db);

  // Common match fields written for every outcome
  const baseMatchUpdate = {
    bettingOpen:      false,
    bettingClosedAt:  Timestamp.now(),
    result,
  };

  // ── 2a. No bets at all ────────────────────────────────────────────────────
  if (bets.length === 0) {
    const finalStatus = result === 'abandoned' ? 'abandoned' : 'completed';
    batch.update(matchRef, { ...baseMatchUpdate, status: finalStatus });
    await batch.commit();

    return {
      outcome: 'no_bets',
      totalPot: 0,
      rolloverPotBefore,
      rolloverPotAfter: rolloverPotBefore,
      betCount: 0,
      winnerCount: 0,
      totalPayout: 0,
    };
  }

  // ── 2b. Abandoned ─────────────────────────────────────────────────────────
  //   Always refund (regardless of noDrawPolicy), because a match didn't play.
  if (result === 'abandoned') {
    for (const bet of bets) {
      batch.update(doc(db, 'bets', bet.id), {
        status: 'refunded',
        pointsDelta: 0,
      });
      // Refunds return the stake, but we originally just deducted nothing —
      // stakes are virtual points already "in the pot", so status 'refunded'
      // signals they cost the user nothing. No member points to adjust.
    }

    batch.update(matchRef, { ...baseMatchUpdate, status: 'abandoned' });
    // rolloverPot is NOT touched on abandonment — the existing pot stays.

    await batch.commit();

    return {
      outcome: 'refund',
      totalPot: thisPot,
      rolloverPotBefore,
      rolloverPotAfter: rolloverPotBefore,
      betCount: bets.length,
      winnerCount: 0,
      totalPayout: 0,
    };
  }

  // ── Identify winning + losing bets ────────────────────────────────────────
  const winnerBets = bets.filter((b) => b.pickedOutcome === result);
  const loserBets  = bets.filter((b) => b.pickedOutcome !== result);

  // ── 2c. Draw / rollover ───────────────────────────────────────────────────
  //   A draw with noDrawPolicy === 'rollover' AND no one bet on 'draw':
  //   Lock this match's pot into rolloverPot; pay nobody.
  //
  //   If someone DID bet on 'draw', they count as winners and fall through
  //   to the payout branch below.
  const isDrawLikeResult = result === 'draw';
  const noWinners        = winnerBets.length === 0;

  if (isDrawLikeResult && noWinners && noDrawPolicy === 'rollover') {
    // Mark all bets as 'locked' in the rollover — a new status that signals
    // the pot was rolled over rather than refunded or lost.
    for (const bet of bets) {
      batch.update(doc(db, 'bets', bet.id), {
        status: 'locked',
        pointsDelta: 0, // no points moved yet; will be resolved when pot pays out
      });
    }

    batch.update(groupRef, { rolloverPot: increment(thisPot) });
    batch.update(matchRef, { ...baseMatchUpdate, status: 'completed' });

    await batch.commit();

    return {
      outcome: 'rollover',
      totalPot: thisPot,
      rolloverPotBefore,
      rolloverPotAfter: rolloverPotBefore + thisPot,
      betCount: bets.length,
      winnerCount: 0,
      totalPayout: 0,
    };
  }

  // ── 2d. Draw / refund ─────────────────────────────────────────────────────
  if (isDrawLikeResult && noWinners && noDrawPolicy === 'refund') {
    for (const bet of bets) {
      batch.update(doc(db, 'bets', bet.id), {
        status: 'refunded',
        pointsDelta: 0,
      });
    }

    batch.update(matchRef, { ...baseMatchUpdate, status: 'completed' });

    await batch.commit();

    return {
      outcome: 'refund',
      totalPot: thisPot,
      rolloverPotBefore,
      rolloverPotAfter: rolloverPotBefore,
      betCount: bets.length,
      winnerCount: 0,
      totalPayout: 0,
    };
  }

  // ── 2e. Payout (Matched Stake) ───────────────────────────────────────────
  //
  //   Matched Stake rules:
  //     1. A winner's profit is capped at 1:1 (their own stake).
  //     2. Total payout to winners ≤ total loss from losers.
  //     3. matchedStake = min(totalWinnerStake, totalLoserStake)
  //
  //   Winners share (matchedStake + rolloverPot) proportionally by their stake.
  //   Since matchedStake ≤ totalWinnerStake, each winner's share ≤ their stake
  //   automatically — the 1:1 cap is structurally enforced.
  //
  //   Losers only pay a proportional share of matchedStake, so if the winning
  //   side bet less, losers get back the unmatched portion of their stake.

  const totalWinnerStake = winnerBets.reduce((sum, b) => sum + b.stake, 0);
  const totalLoserStake  = loserBets.reduce((sum, b) => sum + b.stake, 0);

  // The portion of stakes that are "matched" between the two sides.
  const matchedStake = Math.min(totalWinnerStake, totalLoserStake);

  // Winners receive matchedStake + any rolloverPot, split proportionally.
  const winnerPot = matchedStake + rolloverPotBefore;

  const rawWinnerShares = winnerBets.map((bet) => ({
    bet,
    share: totalWinnerStake > 0
      ? Math.floor((bet.stake / totalWinnerStake) * winnerPot)
      : 0,
  }));

  // Largest-remainder rounding for winners
  const totalWinnerAllocated = rawWinnerShares.reduce((s, w) => s + w.share, 0);
  const winnerRemainder = winnerPot - totalWinnerAllocated;
  if (winnerRemainder > 0 && rawWinnerShares.length > 0) {
    const sortedWinnerIndices = rawWinnerShares
      .map((_, i) => i)
      .sort((a, b) =>
        rawWinnerShares[b].bet.stake !== rawWinnerShares[a].bet.stake
          ? rawWinnerShares[b].bet.stake - rawWinnerShares[a].bet.stake
          : a - b
      );
    for (let r = 0; r < winnerRemainder; r++) {
      rawWinnerShares[sortedWinnerIndices[r % sortedWinnerIndices.length]].share += 1;
    }
  }

  // Losers only pay their proportional share of matchedStake.
  const rawLoserDeductions = loserBets.map((bet) => ({
    bet,
    deduction: totalLoserStake > 0
      ? Math.floor((bet.stake / totalLoserStake) * matchedStake)
      : 0,
  }));

  // Largest-remainder rounding for losers
  const totalLoserAllocated = rawLoserDeductions.reduce((s, d) => s + d.deduction, 0);
  const loserRemainder = matchedStake - totalLoserAllocated;
  if (loserRemainder > 0 && rawLoserDeductions.length > 0) {
    const sortedLoserIndices = rawLoserDeductions
      .map((_, i) => i)
      .sort((a, b) =>
        rawLoserDeductions[b].bet.stake !== rawLoserDeductions[a].bet.stake
          ? rawLoserDeductions[b].bet.stake - rawLoserDeductions[a].bet.stake
          : a - b
      );
    for (let r = 0; r < loserRemainder; r++) {
      rawLoserDeductions[sortedLoserIndices[r % sortedLoserIndices.length]].deduction += 1;
    }
  }

  let totalPayout = 0;

  for (const { bet, share } of rawWinnerShares) {
    batch.update(doc(db, 'bets', bet.id), {
      status: 'won',
      pointsDelta: share,
    });
    if (share !== 0) {
      batch.update(memberRef(groupId, bet.userId), {
        totalPoints: increment(share),
      });
    }
    totalPayout += share;
  }

  for (const { bet, deduction } of rawLoserDeductions) {
    batch.update(doc(db, 'bets', bet.id), {
      status: 'lost',
      pointsDelta: -deduction,
    });
    if (deduction !== 0) {
      batch.update(memberRef(groupId, bet.userId), {
        totalPoints: increment(-deduction),
      });
    }
  }

  // Reset rolloverPot to 0 now that it has been paid out
  if (rolloverPotBefore > 0) {
    batch.update(groupRef, { rolloverPot: 0 });
  }

  batch.update(matchRef, { ...baseMatchUpdate, status: 'completed' });

  await batch.commit();

  return {
    outcome: 'payout',
    totalPot: thisPot,
    rolloverPotBefore,
    rolloverPotAfter: 0,
    betCount: bets.length,
    winnerCount: winnerBets.length,
    totalPayout,
  };
}

// ── Rollback ──────────────────────────────────────────────────────────────────

/**
 * Exactly reverses a prior settlement by inverting each bet's stored pointsDelta.
 *
 * Safe properties:
 *  - Reads ALL bets for the match first (including 'locked' rollover bets).
 *  - Only touches member points for bets with a non-zero pointsDelta.
 *  - Resets every bet to status:'pending', pointsDelta:null.
 *  - Does NOT touch the group's rolloverPot — that is the responsibility of the
 *    caller (declareMatchResult), which must decide whether to drop the pot or
 *    keep it. By convention:
 *      • If rolling back a 'rollover' outcome → subtract thisPot from rolloverPot.
 *      • Otherwise → rolloverPot is unchanged.
 *
 * @returns The list of bets that were reversed (useful for the caller to
 *          compute rolloverPot adjustments).
 */
export async function rollbackSettlement(
  matchId: string,
  groupId: string
): Promise<Bet[]> {
  const bets = await fetchBetsForMatch(matchId, groupId);
  assertBatchCapacity(bets.length);

  const batch = writeBatch(db);
  let adjustedCount = 0;

  for (const bet of bets) {
    const delta = bet.pointsDelta ?? 0;

    if (delta !== 0) {
      // Invert the delta: if they gained +10, subtract 10; if lost −5, add 5.
      batch.update(memberRef(groupId, bet.userId), {
        totalPoints: increment(-delta),
      });
      adjustedCount++;
    }

    batch.update(doc(db, 'bets', bet.id), {
      status: 'pending',
      pointsDelta: null,
    });
  }

  if (bets.length > 0) {
    await batch.commit();
  }

  console.info(
    `[rollbackSettlement] matchId=${matchId} groupId=${groupId} ` +
    `bets=${bets.length} memberAdjustments=${adjustedCount}`
  );

  return bets;
}

// ── declareMatchResult ─────────────────────────────────────────────────────────

/**
 * Public entry point used by the admin panel.
 *
 * 1. If the match was previously settled (completed/abandoned), rolls back the
 *    prior settlement first, including restoring the rolloverPot if needed.
 * 2. Settles the match with the new result.
 *
 * @returns SettlementSummary from the new settlement (useful for admin toasts).
 */
export async function declareMatchResult(
  matchId: string,
  groupId: string,
  result: MatchResult,
  noDrawPolicy: NoDrawPolicy
): Promise<SettlementSummary> {
  // ── Step 1: Load current match state ─────────────────────────────────────
  const matchSnap = await getDoc(doc(db, 'matches', matchId));
  if (!matchSnap.exists()) {
    throw new Error(`[declareMatchResult] Match not found: ${matchId}`);
  }

  const currentMatch = { id: matchSnap.id, ...matchSnap.data() } as Match;
  const wasSettled   =
    currentMatch.status === 'completed' || currentMatch.status === 'abandoned';

  // ── Step 2: Roll back the previous settlement if it existed ──────────────
  if (wasSettled) {
    const previousBets = await rollbackSettlement(matchId, groupId);

    // If the PREVIOUS outcome was a rollover, restore the rolloverPot by
    // removing the contribution this match made to it.
    const previousWasRollover =
      currentMatch.result === 'draw' &&
      currentMatch.noDrawPolicy === 'rollover' &&
      previousBets.every((b) => b.pointsDelta === 0 || b.pointsDelta === null);

    if (previousWasRollover) {
      const thisPot = previousBets.reduce((sum, b) => sum + b.stake, 0);
      if (thisPot > 0) {
        const groupSnap = await getDoc(doc(db, 'groups', groupId));
        const currentPot = (groupSnap.data()?.rolloverPot as number | undefined) ?? 0;
        const restoredPot = Math.max(0, currentPot - thisPot);

        const rb = writeBatch(db);
        rb.update(doc(db, 'groups', groupId), { rolloverPot: restoredPot });
        await rb.commit();

        console.info(
          `[declareMatchResult] Restored rolloverPot: ${currentPot} → ${restoredPot} ` +
          `(reverted contribution of ${thisPot} from matchId=${matchId})`
        );
      }
    }
  }

  // ── Step 3: Settle with the new result ───────────────────────────────────
  const summary = await settleMatch({ matchId, groupId, result, noDrawPolicy });

  console.info(
    `[declareMatchResult] matchId=${matchId} result=${result} ` +
    `outcome=${summary.outcome} payout=${summary.totalPayout} ` +
    `rolloverBefore=${summary.rolloverPotBefore} rolloverAfter=${summary.rolloverPotAfter}`
  );

  return summary;
}
