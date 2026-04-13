'use client';

import type { Match, Bet } from '@/lib/matches';

// ── helpers (duplicated from page.tsx to keep this file self-contained) ────────

export function getPickedLabel(match: Match, pickedOutcome: Bet['pickedOutcome']) {
  if (pickedOutcome === 'team_a') return match.teamA;
  if (pickedOutcome === 'team_b') return match.teamB;
  return 'Draw';
}

export function getMatchResultLabel(match: Match) {
  if (match.result === 'team_a') return `${match.teamA} won`;
  if (match.result === 'team_b') return `${match.teamB} won`;
  if (match.result === 'draw') return 'Match drawn';
  if (match.result === 'abandoned') return 'Match abandoned';
  return 'Result not declared';
}

function computePotentialOutcomes(
  match: Match,
  bets: Bet[],
  memberNames: Record<string, string>
): { label: string; deltas: { name: string; delta: number }[] }[] {
  if (bets.length === 0) return [];

  const outcomes = [
    { outcome: 'team_a', label: match.teamA },
    { outcome: 'team_b', label: match.teamB },
    ...(match.drawAllowed ? [{ outcome: 'draw', label: 'Draw' }] : []),
  ];

  return outcomes.map(({ outcome, label }) => {
    const winners = bets.filter((b) => b.pickedOutcome === outcome);
    const losers  = bets.filter((b) => b.pickedOutcome !== outcome);
    const totalWinnerStake = winners.reduce((s, b) => s + b.stake, 0);
    const totalLoserStake  = losers.reduce((s, b) => s + b.stake, 0);

    const winnerDeltas = winners.map((bet) => ({
      name: memberNames[bet.userId] ?? 'Unknown',
      delta: totalWinnerStake > 0
        ? Math.floor((bet.stake / totalWinnerStake) * totalLoserStake)
        : 0,
    }));
    const loserDeltas = losers.map((bet) => ({
      name: memberNames[bet.userId] ?? 'Unknown',
      delta: -bet.stake,
    }));

    return {
      label,
      deltas: [...winnerDeltas, ...loserDeltas].sort((a, b) => b.delta - a.delta),
    };
  }).filter(({ deltas }) => deltas.length > 0);
}

function getMatchPointSummary(bets: Bet[], memberNames: Record<string, string>) {
  return bets
    .filter((bet) => bet.pointsDelta !== null)
    .map((bet) => ({
      id: bet.id,
      displayName: memberNames[bet.userId] ?? 'Unknown',
      pointsDelta: bet.pointsDelta ?? 0,
      status: bet.status,
    }))
    .sort((a, b) => b.pointsDelta - a.pointsDelta || a.displayName.localeCompare(b.displayName));
}

// ── WhoBettedSection ──────────────────────────────────────────────────────────

interface WhoBettedSectionProps {
  match: Match;
  bets: Bet[];
  memberNames: Record<string, string>;
  currentUserId?: string;
  hasBorder?: boolean;
}

export function WhoBettedSection({ match, bets, memberNames, currentUserId, hasBorder = false }: WhoBettedSectionProps) {
  if (bets.length === 0) return null;

  const betsByOutcome = bets.reduce<Record<string, Bet[]>>((acc, bet) => {
    const label = getPickedLabel(match, bet.pickedOutcome);
    acc[label] ??= [];
    acc[label].push(bet);
    return acc;
  }, {});

  return (
    <div className={hasBorder ? 'border-t border-[var(--border)] pt-3' : ''}>
      <p className="text-xs font-semibold text-[var(--text-secondary)]">Who betted</p>
      <div className="mt-2 space-y-2">
        {Object.entries(betsByOutcome).map(([label, outcomeBets]) => (
          <div key={label} className="flex flex-wrap items-start gap-2 text-xs">
            <span className="rounded-full bg-[var(--bg-card)] px-2 py-0.5 font-medium text-[var(--text-primary)]">
              {label}
            </span>
            <div className="flex flex-wrap gap-1.5">
              {outcomeBets.map((bet) => {
                const isMe = bet.userId === currentUserId;
                const displayName = memberNames[bet.userId] ?? 'Unknown';
                return (
                  <span
                    key={bet.id}
                    className={`rounded-full px-2 py-0.5 ${
                      isMe
                        ? 'bg-green-500/15 text-green-400'
                        : 'bg-[var(--bg-card)] text-[var(--text-secondary)]'
                    }`}
                  >
                    {displayName}{isMe ? ' (you)' : ''}: {bet.stake} pts
                  </span>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── PotentialOutcomesSection ──────────────────────────────────────────────────

interface PotentialOutcomesSectionProps {
  match: Match;
  bets: Bet[];
  memberNames: Record<string, string>;
}

export function PotentialOutcomesSection({ match, bets, memberNames }: PotentialOutcomesSectionProps) {
  if (bets.length === 0) return null;

  const uniqueSides = new Set(bets.map((b) => b.pickedOutcome));
  if (uniqueSides.size < 2) {
    return (
      <div className="border-t border-[var(--border)] pt-3">
        <p className="text-xs text-[var(--text-muted)] italic">
          No bets on the other side — no points will change regardless of result.
        </p>
      </div>
    );
  }

  const outcomes = computePotentialOutcomes(match, bets, memberNames);
  if (outcomes.length === 0) return null;

  return (
    <div className="border-t border-[var(--border)] pt-3 space-y-1">
      <p className="text-xs font-semibold text-[var(--text-secondary)]">If...</p>
      {outcomes.map(({ label, deltas }) => (
        <div key={label} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <span className="font-medium text-[var(--text-primary)] shrink-0">{label} wins:</span>
          {deltas.map(({ name, delta }, i) => (
            <span key={`${name}-${i}`} className={delta >= 0 ? 'text-green-400' : 'text-red-400'}>
              {name} {delta >= 0 ? `+${delta}` : delta}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

// ── PointsSummarySection ──────────────────────────────────────────────────────

interface PointsSummarySectionProps {
  bets: Bet[];
  memberNames: Record<string, string>;
  resultLabel: string;
}

export function PointsSummarySection({ bets, memberNames, resultLabel }: PointsSummarySectionProps) {
  const pointSummary = getMatchPointSummary(bets, memberNames);

  return (
    <div className="border-t border-[var(--border)] pt-3 space-y-2">
      <div className="flex items-center gap-2 text-xs font-medium text-[var(--text-primary)]">
        <span aria-hidden>🏆</span>
        <span>{resultLabel}</span>
      </div>
      {pointSummary.length === 0 ? (
        <p className="text-xs text-[var(--text-muted)]">No point changes recorded for this match.</p>
      ) : (
        <div className="space-y-2">
          {[
            pointSummary.filter((e) => e.pointsDelta >= 0),
            pointSummary.filter((e) => e.pointsDelta < 0),
          ].map((group, gi) =>
            group.length === 0 ? null : (
              <div key={gi} className="flex flex-wrap gap-2">
                {group.map((entry) => (
                  <span
                    key={entry.id}
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                      entry.pointsDelta > 0
                        ? 'bg-green-500/15 text-green-400'
                        : entry.pointsDelta < 0
                        ? 'bg-red-500/15 text-red-400'
                        : 'bg-[var(--bg-card)] text-[var(--text-muted)]'
                    }`}
                  >
                    {entry.displayName}: {entry.pointsDelta > 0 ? '+' : ''}{entry.pointsDelta} pts
                  </span>
                ))}
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}
