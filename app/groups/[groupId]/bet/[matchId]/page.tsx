'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import AppNavbar from '@/components/AppNavbar';
import ProtectedRoute from '@/components/ProtectedRoute';
import { useAuth } from '@/lib/AuthContext';
import { getMatchById, getUserBetForMatch, upsertUserBetForMatch } from '@/lib/matches';
import type { Match, Bet } from '@/lib/matches';
import { getUserGroupMember } from '@/lib/groups';
import type { GroupMember } from '@/lib/groups';
import { Spinner, Button, Badge, Card, PageHeader, CenteredCard, matchStatusVariant, betStatusVariant } from '@/components/ui';

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

function outcomeLabel(outcome: Bet['pickedOutcome'], match: Match): string {
  if (outcome === 'team_a') return match.teamA;
  if (outcome === 'team_b') return match.teamB;
  return 'Draw';
}

function getBetActionErrorMessage(err: unknown): string {
  if ((err as { code?: string })?.code === 'permission-denied') {
    return 'Firestore rules are blocking bet placement. Publish the latest Firestore rules and try again.';
  }
  return err instanceof Error ? err.message : 'Failed to place bet';
}

// OutcomeButton: 3-way blue/slate/red dynamic colors — left as local component
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
        if (!cancelled) setLoadingData(false);
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

  // ── loading ──────────────────────────────────────────────────────────────
  if (loadingData || match === undefined || existingBet === undefined || member === undefined) {
    return <Spinner size="lg" fullPage />;
  }

  // ── load error ───────────────────────────────────────────────────────────
  if (loadError) {
    return (
      <CenteredCard maxWidth="max-w-sm">
        <Card variant="modal" padding="p-8" className="text-center space-y-4">
          <p className="text-red-400 font-semibold">{loadError}</p>
          <Button variant="primary" size="md" href={`/groups/${groupId}`}>
            Back to Group
          </Button>
        </Card>
      </CenteredCard>
    );
  }

  // ── not a member ─────────────────────────────────────────────────────────
  if (member === null) {
    return (
      <CenteredCard maxWidth="max-w-sm">
        <Card variant="modal" padding="p-8" className="text-center space-y-4">
          <p className="text-red-400 font-semibold">Access denied</p>
          <p className="text-sm text-[var(--text-secondary)]">You are not a member of this group.</p>
          <Button variant="primary" size="md" href="/groups">
            My Groups
          </Button>
        </Card>
      </CenteredCard>
    );
  }

  // ── match not found ──────────────────────────────────────────────────────
  if (match === null) {
    return (
      <CenteredCard maxWidth="max-w-sm">
        <Card variant="modal" padding="p-8" className="text-center space-y-4">
          <p className="text-[var(--text-secondary)]">Match not found.</p>
          <Button variant="primary" size="md" href={`/groups/${groupId}`}>
            Back to Group
          </Button>
        </Card>
      </CenteredCard>
    );
  }

  const bettingLocked = match.status !== 'upcoming' && match.status !== 'live';
  const bettingClosed = !match.bettingOpen;

  // ── shared header ─────────────────────────────────────────────────────────
  const sharedHeader = (
    <AppNavbar
      backHref={`/groups/${groupId}`}
      subtitle="Place Bet"
      maxWidth="lg"
    />
  );

  // ── locked / closed view ─────────────────────────────────────────────────
  if (bettingLocked || bettingClosed) {
    return (
      <div className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)]">
      {sharedHeader}
        <main className="max-w-lg mx-auto px-6 py-8 space-y-4">
          {/* Match info */}
          <Card variant="default" className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h1 className="text-xl font-bold text-[var(--text-primary)]">
                {match.teamA} <span className="text-[var(--text-muted)]">vs</span> {match.teamB}
              </h1>
              <div className="flex items-center gap-2">
                <Badge variant="format">{match.format}</Badge>
                <Badge variant={matchStatusVariant(match.status)}>
                  {match.status.charAt(0).toUpperCase() + match.status.slice(1)}
                </Badge>
              </div>
            </div>
            <p className="text-xs text-[var(--text-muted)]">{formatMatchDate(match.matchDate)}</p>
          </Card>

          {/* Existing bet (read-only) */}
          {existingBet ? (
            <Card variant="default" className="space-y-2">
              <p className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wide">Your bet</p>
              <div className="flex items-center justify-between">
                <span className="text-sm text-[var(--text-secondary)]">
                  Picked: <span className="font-medium text-[var(--text-primary)]">{outcomeLabel(existingBet.pickedOutcome, match)}</span>
                </span>
                <Badge variant={betStatusVariant(existingBet.status)}>
                  {existingBet.status.charAt(0).toUpperCase() + existingBet.status.slice(1)}
                </Badge>
              </div>
              <p className="text-sm text-[var(--text-secondary)]">
                Stake: <span className="font-medium text-[var(--text-primary)]">{existingBet.stake} pts</span>
              </p>
            </Card>
          ) : (
            <Card variant="default" className="text-center text-sm text-[var(--text-muted)] py-2">
              You did not place a bet on this match.
            </Card>
          )}

          {/* Locked notice */}
          <p className="text-center text-sm text-[var(--text-muted)]">
            {bettingLocked ? 'Betting is closed — this match has already started or finished.' : 'Betting is currently closed for this match.'}
          </p>

          <Button variant="secondary" size="md" href={`/groups/${groupId}`} className="w-full">
            Back to Group
          </Button>
        </main>
      </div>
    );
  }

  // ── main betting UI ──────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)]">
      {sharedHeader}

      <main className="max-w-lg mx-auto px-6 py-8 space-y-6">

        {/* Match info */}
        <Card variant="default" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h1 className="text-xl font-bold text-[var(--text-primary)]">
              {match.teamA} <span className="text-[var(--text-muted)]">vs</span> {match.teamB}
            </h1>
            <div className="flex items-center gap-2">
              <Badge variant="format">{match.format}</Badge>
              <Badge variant={matchStatusVariant(match.status)}>
                {match.status.charAt(0).toUpperCase() + match.status.slice(1)}
              </Badge>
            </div>
          </div>
          <p className="text-xs text-[var(--text-muted)]">{formatMatchDate(match.matchDate)}</p>
          <div className="pt-1 border-t border-[var(--border)]">
            <p className="text-sm text-[var(--text-secondary)]">
              Stake: <span className="text-green-400 font-semibold">{STAKE} pts</span>
            </p>
          </div>
        </Card>

        {/* Existing bet */}
        {existingBet && (
          <Card variant="default" className="space-y-2">
            <p className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wide">Current bet</p>
            <div className="flex items-center justify-between">
              <span className="text-sm text-[var(--text-secondary)]">
                Picked: <span className="font-medium text-[var(--text-primary)]">{outcomeLabel(existingBet.pickedOutcome, match)}</span>
              </span>
              <Badge variant={betStatusVariant(existingBet.status)}>
                {existingBet.status.charAt(0).toUpperCase() + existingBet.status.slice(1)}
              </Badge>
            </div>
            <p className="text-sm text-[var(--text-secondary)]">
              Stake: <span className="font-medium text-[var(--text-primary)]">{existingBet.stake} pts</span>
            </p>
          </Card>
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
          <Button
            variant="primary"
            size="lg"
            loading={confirming}
            onClick={handleConfirm}
            className="w-full"
          >
            {existingBet ? 'Update Bet' : 'Confirm Bet'}
          </Button>
        )}
      </main>
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
