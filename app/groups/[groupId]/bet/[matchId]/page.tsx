'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import toast from 'react-hot-toast';
import ProtectedRoute from '@/components/ProtectedRoute';
import { useAuth } from '@/lib/AuthContext';
import { getMatchById, getUserBetForMatch, upsertUserBetForMatch } from '@/lib/matches';
import type { Match, Bet } from '@/lib/matches';
import { getUserGroupMember } from '@/lib/groups';
import type { GroupMember } from '@/lib/groups';

const STAKE = 1000;
type Outcome = 'team_a' | 'team_b' | 'draw';

// ── helpers ───────────────────────────────────────────────────────────────────

function formatMatchDate(ts: Match['matchDate']) {
  return ts.toDate().toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function StatusBadge({ status }: { status: Match['status'] }) {
  const styles: Record<Match['status'], string> = {
    live: 'bg-green-500/20 text-green-400',
    upcoming: 'bg-yellow-500/20 text-yellow-400',
    completed: 'bg-slate-600/40 text-[var(--text-muted)]',
    abandoned: 'bg-slate-600/40 text-[var(--text-muted)]',
  };
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${styles[status]}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}


function BackLink({ groupId }: { groupId: string }) {
  return (
    <Link
      href={`/groups/${groupId}`}
      className="inline-flex items-center gap-1.5 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
    >
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
      </svg>
      Back to Group
    </Link>
  );
}

function InfoScreen({ groupId, message }: { groupId: string; message: string }) {
  return (
    <div className="min-h-screen bg-[var(--bg-primary)] flex flex-col items-center justify-center gap-4 px-4">
      <p className="text-[var(--text-secondary)] text-base">{message}</p>
      <BackLink groupId={groupId} />
    </div>
  );
}

function getBetActionErrorMessage(err: unknown): string {
  if ((err as { code?: string })?.code === 'permission-denied') {
    return 'Firestore rules are blocking bet placement. Publish the latest Firestore rules and try again.';
  }
  return err instanceof Error ? err.message : 'Failed to place bet';
}

function OutcomeButton({
  label,
  value,
  selected,
  accentClass,
  onClick,
}: {
  label: string;
  value: Outcome;
  selected: Outcome | null;
  accentClass: string;
  onClick: () => void;
}) {
  const isSelected = selected === value;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded-xl py-4 px-3 font-semibold text-sm transition-all border-2 ${
        isSelected
          ? `${accentClass} border-current shadow-lg scale-[1.02]`
          : 'bg-[var(--bg-input)] text-[var(--text-secondary)] border-transparent hover:bg-[var(--bg-hover)]'
      }`}
    >
      {label}
    </button>
  );
}

// ── main content ──────────────────────────────────────────────────────────────

function BetContent() {
  const params = useParams<{ groupId: string; matchId: string }>();
  const { groupId, matchId } = params;
  const router = useRouter();
  const { user } = useAuth();

  const [match, setMatch] = useState<Match | null | undefined>(undefined);
  const [existingBet, setExistingBet] = useState<Bet | null | undefined>(undefined);
  const [member, setMember] = useState<GroupMember | null | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingData, setLoadingData] = useState(true);
  const [selected, setSelected] = useState<Outcome | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setLoadingData(true);
    Promise.all([
      getMatchById(matchId),
      getUserBetForMatch(matchId, user.uid),
      getUserGroupMember(groupId, user.uid),
    ])
      .then(([m, bet, mem]) => {
        if (cancelled) return;
        setMatch(m);
        setExistingBet(bet);
        setMember(mem);
        setSelected((bet?.pickedOutcome as Outcome | undefined) ?? null);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('[BetPage] Failed to load:', err);
        setLoadError('Failed to load match data. Please try again.');
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingData(false);
        }
      });
    return () => { cancelled = true; };
  }, [user, matchId, groupId]);

  async function handleConfirm() {
    if (!selected || !user) return;
    setConfirming(true);
    try {
      const wasExistingBet = existingBet !== null;
      await upsertUserBetForMatch(matchId, groupId, user.uid, selected, STAKE);
      toast.success(wasExistingBet ? 'Bet updated successfully!' : 'Bet placed successfully!');
      router.replace(`/groups/${groupId}`);
    } catch (err) {
      toast.error(getBetActionErrorMessage(err));
    } finally {
      setConfirming(false);
    }
  }

  // ── load error ───────────────────────────────────────────────────────────
  if (loadError) {
    return <InfoScreen groupId={groupId} message={loadError} />;
  }

  // ── loading ──────────────────────────────────────────────────────────────
  if (loadingData || match === undefined || existingBet === undefined || member === undefined) {
    return (
      <div className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)]">
        <div className="max-w-lg mx-auto px-6 py-8 space-y-6">
          <BackLink groupId={groupId} />
          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-[var(--card-padding)] space-y-4 animate-pulse">
            <div className="flex items-center justify-between gap-3">
              <div className="h-7 w-56 rounded bg-[var(--bg-input)]" />
              <div className="h-6 w-24 rounded bg-[var(--bg-input)]" />
            </div>
            <div className="h-4 w-36 rounded bg-[var(--bg-input)]" />
            <div className="h-4 w-28 rounded bg-[var(--bg-input)]" />
          </div>
          <div className="space-y-3">
            <div className="h-4 w-28 rounded bg-[var(--bg-input)] animate-pulse" />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div className="h-16 rounded-xl bg-[var(--bg-input)] animate-pulse" />
              <div className="h-16 rounded-xl bg-[var(--bg-input)] animate-pulse" />
              <div className="hidden h-16 rounded-xl bg-[var(--bg-input)] animate-pulse sm:block" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── not a member ─────────────────────────────────────────────────────────
  if (member === null) {
    return <InfoScreen groupId={groupId} message="Access denied — you are not a member of this group." />;
  }

  // ── match not found ──────────────────────────────────────────────────────
  if (match === null) {
    return <InfoScreen groupId={groupId} message="Match not found." />;
  }

  // ── betting closed ───────────────────────────────────────────────────────
  if (match.status !== 'upcoming' && match.status !== 'live') {
    return <InfoScreen groupId={groupId} message="Betting is closed for this match." />;
  }

  if (!match.bettingOpen) {
    return <InfoScreen groupId={groupId} message="Betting is currently closed for this match." />;
  }

  // ── main betting UI ──────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <div className="max-w-lg mx-auto px-6 py-8 space-y-6">
        <BackLink groupId={groupId} />

        {/* Match info card */}
        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-[var(--card-padding)] space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h1 className="text-xl font-bold text-[var(--text-primary)]">
              {match.teamA} <span className="text-[var(--text-muted)]">vs</span> {match.teamB}
            </h1>
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-[var(--bg-input)] text-[var(--text-secondary)]">
                {match.format}
              </span>
              <StatusBadge status={match.status} />
            </div>
          </div>
          <p className="text-xs text-[var(--text-muted)]">{formatMatchDate(match.matchDate)}</p>
          <div className="pt-1 border-t border-[var(--border)]">
            <p className="text-sm text-[var(--text-secondary)]">
              Stake: <span className="text-green-400 font-semibold">{STAKE} pts</span>
            </p>
          </div>
        </div>

        {existingBet && (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4 space-y-2">
            <p className="text-xs font-semibold text-[var(--text-secondary)]">Current bet</p>
            <div className="text-sm text-[var(--text-secondary)]">
              Picked: <span className="font-medium text-[var(--text-primary)]">{existingBet.pickedOutcome === 'team_a' ? match.teamA : existingBet.pickedOutcome === 'team_b' ? match.teamB : 'Draw'}</span>
            </div>
            <div className="text-sm text-[var(--text-secondary)]">
              Stake: <span className="font-medium text-[var(--text-primary)]">{existingBet.stake} pts</span>
            </div>
          </div>
        )}

        {/* Outcome picker */}
        <div className="space-y-3">
          <p className="text-sm font-medium text-[var(--text-secondary)]">Pick your outcome</p>
          <div className="flex gap-3">
            <OutcomeButton
              label={match.teamA}
              value="team_a"
              selected={selected}
              accentClass="bg-blue-500/20 text-blue-400"
              onClick={() => setSelected('team_a')}
            />
            {match.drawAllowed && (
              <OutcomeButton
                label="Draw"
                value="draw"
                selected={selected}
                accentClass="bg-slate-500/40 text-[var(--text-primary)]"
                onClick={() => setSelected('draw')}
              />
            )}
            <OutcomeButton
              label={match.teamB}
              value="team_b"
              selected={selected}
              accentClass="bg-red-500/20 text-red-400"
              onClick={() => setSelected('team_b')}
            />
          </div>
        </div>

        {/* Confirm button */}
        {selected && (
          <button
            onClick={handleConfirm}
            disabled={confirming}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-green-500 hover:bg-green-600 disabled:opacity-60 disabled:cursor-not-allowed px-4 py-3 font-semibold text-white transition-colors"
          >
            {confirming ? (
              <>
                <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                Placing bet…
              </>
            ) : (
              existingBet ? 'Update Bet' : 'Confirm Bet'
            )}
          </button>
        )}
      </div>
    </div>
  );
}

export default function GroupBetPage() {
  return (
    <ProtectedRoute>
      <BetContent />
    </ProtectedRoute>
  );
}









