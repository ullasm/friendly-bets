'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { X } from 'lucide-react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { collection, query, where, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import AppNavbar, { type NavTab } from '@/components/AppNavbar';
import ProtectedRoute from '@/components/ProtectedRoute';
import { useAuth } from '@/lib/AuthContext';
import { getGroupById, getUserGroupMember } from '@/lib/groups';
import type { Group, GroupMember } from '@/lib/groups';
import { upsertUserBetForMatch, removeUserBetForMatch, closeBettingForMatch } from '@/lib/matches';
import type { Match, Bet } from '@/lib/matches';
import { Spinner, Button, Badge, Card, Modal, SectionHeader, matchStatusVariant, betStatusVariant } from '@/components/ui';
import { WhoBettedSection, PotentialOutcomesSection, PointsSummarySection, getMatchResultLabel, getPickedLabel } from '@/components/MatchBettingDetails';

// ── helpers ───────────────────────────────────────────────────────────────────

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function isPastMatch(match: Match, now: Date) {
  return (
    match.status === 'completed' ||
    match.status === 'abandoned' ||
    (match.status === 'upcoming' && match.matchDate.toDate() < now && !isSameDay(match.matchDate.toDate(), now))
  );
}

function formatMatchDate(ts: Match['matchDate']) {
  return ts.toDate().toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// ── sub-components ────────────────────────────────────────────────────────────

const STAKE_PRESETS = [100, 500, 1000];

type Outcome = 'team_a' | 'team_b' | 'draw';

function getBetActionErrorMessage(err: unknown): string {
  if ((err as { code?: string })?.code === 'permission-denied') {
    return 'Could not update bet due to Firestore permissions. Publish latest rules and try again.';
  }
  return err instanceof Error ? err.message : 'Failed to update bet';
}

interface MatchCardProps {
  match: Match;
  groupId: string;
  myBet?: Bet;
  bets: Bet[];
  memberNames: Record<string, string>;
  currentUserId?: string;
  onBetUpdated: (updatedBet: Bet) => void;
  onBetRemoved: (matchId: string) => void;
}

function MatchCard({ match, groupId, myBet, bets, memberNames, currentUserId, onBetUpdated, onBetRemoved }: MatchCardProps) {
  const canBet =
    (match.status === 'live' || match.status === 'upcoming') && match.bettingOpen;

  const pickedLabel = myBet
    ? getPickedLabel(match, myBet.pickedOutcome)
    : null;

  const hasSettledSummary = match.status === 'completed' || match.status === 'abandoned';
  const resultLabel = hasSettledSummary ? getMatchResultLabel(match) : null;
  const winningEntries = bets.filter((b) => b.pointsDelta !== null && (b.pointsDelta ?? 0) > 0);
  const losingEntries  = bets.filter((b) => b.pointsDelta !== null && (b.pointsDelta ?? 0) < 0);
  const refundedEntries = bets.filter((b) => b.pointsDelta !== null && (b.pointsDelta ?? 0) === 0);

  const [editingBet, setEditingBet] = useState(false);
  const [selectedOutcome, setSelectedOutcome] = useState<Outcome | null>((myBet?.pickedOutcome as Outcome | undefined) ?? null);
  const [stakeInput, setStakeInput] = useState<string>(String(myBet?.stake ?? 1000));
  const stake = Math.max(0, parseInt(stakeInput) || 0);
  const [updatingBet, setUpdatingBet] = useState(false);
  const [removingBet, setRemovingBet] = useState(false);
  const [confirmRemoveBet, setConfirmRemoveBet] = useState(false);

  useEffect(() => {
    setSelectedOutcome((myBet?.pickedOutcome as Outcome | undefined) ?? null);
    setStakeInput(String(myBet?.stake ?? 1000));
    setEditingBet(false);
  }, [myBet?.id, myBet?.pickedOutcome, myBet?.stake]);

  const canChangeBet = Boolean(myBet && myBet.status === 'pending') && canBet && Boolean(currentUserId);
  const canPlaceInlineBet = !myBet && canBet && Boolean(currentUserId);

  async function handleChangeBet() {
    if (!currentUserId || !selectedOutcome) return;
    setUpdatingBet(true);
    try {
      const betId = await upsertUserBetForMatch(match.id, groupId, currentUserId, selectedOutcome, stake);
      const updatedBet: Bet = {
        id: myBet?.id ?? (betId as string),
        matchId: match.id,
        groupId,
        userId: currentUserId,
        pickedOutcome: selectedOutcome,
        stake,
        pointsDelta: null,
        status: 'pending',
        placedAt: myBet?.placedAt ?? match.matchDate,
      };
      onBetUpdated(updatedBet);
      setEditingBet(false);
      toast.success(myBet ? 'Bet updated successfully!' : 'Bet placed successfully!');
    } catch (err) {
      toast.error(getBetActionErrorMessage(err));
    } finally {
      setUpdatingBet(false);
    }
  }

  async function handleRemoveBet() {
    if (!currentUserId || !myBet) return;
    setRemovingBet(true);
    try {
      await removeUserBetForMatch(match.id, currentUserId);
      setConfirmRemoveBet(false);
      onBetRemoved(match.id);
      toast.success('Bet removed');
    } catch (err) {
      toast.error(getBetActionErrorMessage(err));
    } finally {
      setRemovingBet(false);
    }
  }

  return (
    <Card variant="default" className="flex flex-col gap-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <span className="font-semibold text-[var(--text-primary)]">
          {match.teamA} <span className="text-[var(--text-muted)]">vs</span> {match.teamB}
        </span>
        <div className="flex items-center gap-2">
          <Badge variant="format">{match.format}</Badge>
          <Badge variant={matchStatusVariant(match.status)}>
            {match.status.charAt(0).toUpperCase() + match.status.slice(1)}
          </Badge>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-[var(--text-muted)]">{formatMatchDate(match.matchDate)}</span>
          {myBet && (
            <>
              <span className="text-xs text-[var(--text-secondary)]">
                · Picked: <span className="font-medium text-[var(--text-primary)]">{pickedLabel}</span>
              </span>
              <Badge variant={betStatusVariant(myBet.status)}>
                {myBet.status.charAt(0).toUpperCase() + myBet.status.slice(1)}
              </Badge>
              {myBet.pointsDelta !== null && myBet.status === 'won' && (
                <span className="text-xs font-semibold text-green-400">+{myBet.pointsDelta} pts</span>
              )}
              {myBet.pointsDelta !== null && myBet.status === 'lost' && (
                <span className="text-xs font-semibold text-red-400">{myBet.pointsDelta} pts</span>
              )}
            </>
          )}
        </div>
        {canPlaceInlineBet ? (
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={() => {
              setSelectedOutcome(null);
              setEditingBet(true);
            }}
          >
            Place Bet
          </Button>
        ) : canChangeBet ? (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setEditingBet(true)}
            >
              Change Bet
            </Button>
            <Button
              type="button"
              variant="danger"
              size="sm"
              onClick={() => setConfirmRemoveBet(true)}
            >
              Remove Bet
            </Button>
          </div>
        ) : null}
      </div>
      {editingBet && (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-input)] px-3 py-3 space-y-3">
          <p className="text-xs font-semibold text-[var(--text-secondary)]">{myBet ? 'Change your bet' : 'Place your bet'}</p>
          <div className={`grid gap-2 ${match.drawAllowed ? 'grid-cols-3' : 'grid-cols-2'}`}>
            {/* Outcome toggles: unique 3-way colored selection (blue/slate/red per team), no Button variant — left as raw buttons */}
            <button
              type="button"
              onClick={() => setSelectedOutcome('team_a')}
              className={`rounded-lg px-3 py-2 text-sm font-semibold border transition-colors ${
                selectedOutcome === 'team_a'
                  ? 'bg-blue-500/20 text-blue-400 border-blue-400/50'
                  : 'bg-[var(--bg-card)] text-[var(--text-secondary)] border-[var(--border)] hover:bg-[var(--bg-hover)]'
              }`}
            >
              {match.teamA}
            </button>
            {match.drawAllowed && (
              <button
                type="button"
                onClick={() => setSelectedOutcome('draw')}
                className={`rounded-lg px-3 py-2 text-sm font-semibold border transition-colors ${
                  selectedOutcome === 'draw'
                    ? 'bg-slate-500/30 text-[var(--text-primary)] border-slate-300/40'
                    : 'bg-[var(--bg-card)] text-[var(--text-secondary)] border-[var(--border)] hover:bg-[var(--bg-hover)]'
                }`}
              >
                Draw
              </button>
            )}
            <button
              type="button"
              onClick={() => setSelectedOutcome('team_b')}
              className={`rounded-lg px-3 py-2 text-sm font-semibold border transition-colors ${
                selectedOutcome === 'team_b'
                  ? 'bg-red-500/20 text-red-400 border-red-400/50'
                  : 'bg-[var(--bg-card)] text-[var(--text-secondary)] border-[var(--border)] hover:bg-[var(--bg-hover)]'
              }`}
            >
              {match.teamB}
            </button>
          </div>
          <div className="space-y-2">
            <p className="text-xs font-semibold text-[var(--text-secondary)]">Points</p>
            <div className="flex gap-2">
              {STAKE_PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setStakeInput(String(stake + p))}
                  className="flex-1 rounded-lg px-2 py-1.5 text-xs font-semibold border transition-colors bg-[var(--bg-card)] text-[var(--text-secondary)] border-[var(--border)] hover:bg-[var(--bg-hover)]"
                >
                  +{p}
                </button>
              ))}
            </div>
            <div className="relative">
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={stakeInput}
                onChange={(e) => {
                  const raw = e.target.value;
                  if (raw === '' || /^\d+$/.test(raw)) setStakeInput(raw);
                }}
                className="w-full rounded-lg bg-[var(--bg-card)] border border-[var(--border)] px-3 py-2 pr-8 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
                placeholder="Custom amount"
              />
              {stake > 0 && (
                <button
                  type="button"
                  onClick={() => setStakeInput('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
          {!selectedOutcome && (
            <p className="text-center text-xs text-[var(--text-muted)]">Pick a team above to continue</p>
          )}
          <Button
            type="button"
            variant="primary"
            size="lg"
            loading={updatingBet}
            disabled={!selectedOutcome || stake < 1}
            onPointerDown={(e) => e.preventDefault()}
            onClick={handleChangeBet}
            className={`w-full transition-opacity ${!selectedOutcome || stake < 1 ? 'opacity-30' : 'opacity-100'}`}
          >
            {updatingBet ? 'Saving…' : myBet ? 'Confirm change' : 'Confirm bet'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="md"
            onClick={() => {
              setEditingBet(false);
              setSelectedOutcome((myBet?.pickedOutcome as Outcome | undefined) ?? null);
            }}
            className="w-full"
          >
            Cancel
          </Button>
        </div>
      )}
      {(bets.length > 0 || hasSettledSummary) && (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-input)] px-3 py-3 space-y-3">
          {hasSettledSummary && (
            <div>
              <p className="text-xs font-semibold text-[var(--text-secondary)]">Match summary</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {/* Result/summary chips: dynamic color based on outcome, not fixed Badge variants — left as raw spans */}
                <span className="rounded-full bg-[var(--bg-card)] px-2.5 py-1 text-xs font-medium text-[var(--text-primary)]">
                  Result: {resultLabel}
                </span>
                {winningEntries.length > 0 ? (
                  <span className="rounded-full bg-green-500/15 px-2.5 py-1 text-xs font-medium text-green-400">
                    Won by: {winningEntries.map((entry) => memberNames[entry.userId] ?? 'Unknown').join(', ')}
                  </span>
                ) : refundedEntries.length > 0 ? (
                  <span className="rounded-full bg-[var(--bg-card)] px-2.5 py-1 text-xs font-medium text-[var(--text-muted)]">
                    Bets refunded for this match
                  </span>
                ) : bets.length > 0 ? (
                  <span className="rounded-full bg-[var(--bg-card)] px-2.5 py-1 text-xs font-medium text-[var(--text-muted)]">
                    No winning bets in this group
                  </span>
                ) : (
                  <span className="rounded-full bg-[var(--bg-card)] px-2.5 py-1 text-xs font-medium text-[var(--text-muted)]">
                    No bets were placed for this match
                  </span>
                )}
                {losingEntries.length > 0 && (
                  <span className="rounded-full bg-red-500/15 px-2.5 py-1 text-xs font-medium text-red-400">
                    Lost by: {losingEntries.map((entry) => memberNames[entry.userId] ?? 'Unknown').join(', ')}
                  </span>
                )}
              </div>
            </div>
          )}
          <WhoBettedSection
            match={match}
            bets={bets}
            memberNames={memberNames}
            currentUserId={currentUserId}
            hasBorder={hasSettledSummary}
          />
          {!hasSettledSummary && (
            <PotentialOutcomesSection match={match} bets={bets} memberNames={memberNames} />
          )}
          {hasSettledSummary && resultLabel && (
            <PointsSummarySection bets={bets} memberNames={memberNames} resultLabel={resultLabel} />
          )}
        </div>
      )}
      <Modal
        open={confirmRemoveBet}
        onClose={() => setConfirmRemoveBet(false)}
        maxWidth="sm"
        title="Remove bet?"
      >
        <div className="space-y-4">
          <p className="text-sm text-[var(--text-secondary)]">
            Are you sure you want to remove your bet?
          </p>
          <div className="flex gap-3">
            <Button variant="secondary" size="md" className="flex-1" onClick={() => setConfirmRemoveBet(false)}>
              No
            </Button>
            <Button variant="danger" size="md" className="flex-1" loading={removingBet} onClick={handleRemoveBet}>
              Yes, Remove
            </Button>
          </div>
        </div>
      </Modal>
    </Card>
  );
}

interface PastMatchCardProps {
  match: Match;
  bets: Bet[];
  memberNames: Record<string, string>;
}

function getBetChipLabel(bet: Bet) {
  if (bet.status === 'won') {
    return `+${bet.pointsDelta ?? 0} pts`;
  }
  if (bet.status === 'lost') {
    return `−${Math.abs(bet.pointsDelta ?? 0)} pts`;
  }
  if (bet.status === 'refunded') {
    return 'refunded';
  }
  return 'pending';
}

function getBetChipClasses(status: Bet['status']) {
  // These chips include a border which Badge doesn't support — left as raw class strings
  if (status === 'won') {
    return 'bg-green-500/15 text-green-400 border border-green-500/25';
  }
  if (status === 'lost') {
    return 'bg-red-500/15 text-red-400 border border-red-500/25';
  }
  return 'bg-[var(--bg-input)] text-[var(--text-muted)] border border-[var(--border)]';
}

function getBetSortRank(status: Bet['status']) {
  if (status === 'won') return 0;
  if (status === 'lost') return 1;
  return 2;
}

function PastMatchCard({ match, bets, memberNames }: PastMatchCardProps) {
  const resultLabel = getMatchResultLabel(match);
  const sortedBets = [...bets].sort((a, b) => {
    const rankDiff = getBetSortRank(a.status) - getBetSortRank(b.status);
    if (rankDiff !== 0) return rankDiff;

    const nameA = memberNames[a.userId] ?? 'Unknown';
    const nameB = memberNames[b.userId] ?? 'Unknown';
    return nameA.localeCompare(nameB);
  });

  return (
    <Card variant="default" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="font-semibold text-[var(--text-primary)]">
          {match.teamA} <span className="text-[var(--text-muted)]">vs</span> {match.teamB}
        </span>
        <div className="flex items-center gap-2">
          <Badge variant="format">{match.format}</Badge>
          <Badge variant={matchStatusVariant(match.status)}>
            {match.status.charAt(0).toUpperCase() + match.status.slice(1)}
          </Badge>
        </div>
      </div>

      <p className="text-xs text-[var(--text-muted)]">{formatMatchDate(match.matchDate)}</p>

      <div className="flex items-center gap-2 text-xs font-medium text-[var(--text-primary)]">
        <span aria-hidden>🏆</span>
        <span>{resultLabel}</span>
      </div>

      {sortedBets.length === 0 ? (
        <p className="text-xs text-[var(--text-muted)]">No bets placed</p>
      ) : (
        <div className="space-y-2">
          {[
            sortedBets.filter((b) => b.status === 'won'),
            sortedBets.filter((b) => b.status !== 'won'),
          ].map((group, gi) =>
            group.length === 0 ? null : (
              <div key={gi} className="flex flex-wrap gap-2">
                {group.map((bet) => {
                  const displayName = memberNames[bet.userId] ?? 'Unknown';
                  return (
                    <span
                      key={bet.id}
                      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${getBetChipClasses(bet.status)}`}
                    >
                      {displayName}: {getBetChipLabel(bet)}
                    </span>
                  );
                })}
              </div>
            )
          )}
        </div>
      )}
    </Card>
  );
}

// ── main content ──────────────────────────────────────────────────────────────

function GroupDashboardContent() {
  const params = useParams<{ groupId: string }>();
  const groupId = params.groupId;
  const { user } = useAuth();

  const [group, setGroup] = useState<Group | null>(null);
  const [myMember, setMyMember] = useState<GroupMember | null | undefined>(undefined);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [myBets, setMyBets] = useState<Record<string, Bet>>({});
  const [allBets, setAllBets] = useState<Record<string, Bet[]>>({});
  const [loading, setLoading] = useState(true);
  const [pastFilter, setPastFilter] = useState<'betted' | 'mine' | 'all'>('betted');

  // ── Single effect: start everything in parallel ───────────────────────────
  //
  // Previous approach had 3 chained effects:
  //   Effect 1: getGroupById + getUserGroupMember (one-shot, gates the rest)
  //   Effect 2: onSnapshot(matches)  ← waited for Effect 1 to resolve
  //   Effect 3: onSnapshot(members)  ← waited for Effect 1 to resolve
  //
  // That created a ~400ms sequential waterfall before any data could display.
  //
  // New approach: fire the membership check AND both onSnapshots simultaneously.
  // If the membership check fails (non-member), unsubscribe immediately.
  // This eliminates one full Firestore round-trip from the critical path.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    let matchesUnsub: (() => void) | null = null;
    let membersUnsub: (() => void) | null = null;
    let betsUnsub: (() => void) | null = null;

    // ── 1. Membership + group metadata (parallel, non-gating) ────────────────
    Promise.all([
      getGroupById(groupId),
      getUserGroupMember(groupId, user.uid),
    ])
      .then(([groupResult, memberResult]) => {
        if (cancelled) return;
        setGroup(groupResult);
        if (!memberResult) {
          // Non-member: tear down the listeners we already started.
          setMyMember(null);
          setLoading(false);
          matchesUnsub?.();
          membersUnsub?.();
          betsUnsub?.();

        } else {
          setMyMember(memberResult);
        }
      })
      .catch(() => {
        if (cancelled) return;
        toast.error('Failed to load group');
        setMyMember(null);
        setLoading(false);
      });

    // ── 2. Real-time matches listener (starts immediately) ───────────────────
    const matchesQuery = query(
      collection(db, 'matches'),
      where('groupId', '==', groupId),
      orderBy('matchDate', 'desc')
    );

    matchesUnsub = onSnapshot(
      matchesQuery,
      (snap) => {
        if (cancelled) return;
        const fetchedMatches = snap.docs.map(
          (d) => ({ id: d.id, ...d.data() } as Match)
        );
        setMatches(fetchedMatches);
        setLoading(false);

        // Auto-close betting for any match whose start time has passed
        const now = new Date();
        fetchedMatches.forEach((m) => {
          if (m.bettingOpen && m.matchDate.toDate() <= now) {
            closeBettingForMatch(m.id).catch(() => {/* another client may have already closed it */});
          }
        });
      },
      (err) => {
        if (err.code === 'permission-denied') return;
        console.error('[GroupDashboard] matches listener error:', err);
        toast.error('Failed to load matches');
        setLoading(false);
      }
    );

    // ── 3. Real-time bets listener — updates all members' dashboards live ────
    // Single-field query on groupId requires no composite index.
    const betsQuery = query(
      collection(db, 'bets'),
      where('groupId', '==', groupId)
    );

    betsUnsub = onSnapshot(
      betsQuery,
      (snap) => {
        if (cancelled) return;
        const allBetsMap: Record<string, Bet[]> = {};
        const myBetsMap: Record<string, Bet> = {};
        for (const d of snap.docs) {
          const bet = { id: d.id, ...d.data() } as Bet;
          if (!allBetsMap[bet.matchId]) allBetsMap[bet.matchId] = [];
          allBetsMap[bet.matchId].push(bet);
          if (bet.userId === user.uid) myBetsMap[bet.matchId] = bet;
        }
        setAllBets(allBetsMap);
        setMyBets(myBetsMap);
      },
      (err) => {
        if (err.code === 'permission-denied') return;
        console.error('[GroupDashboard] bets listener error:', err);
        toast.error('Failed to load bets');
      }
    );

    // ── 4. Real-time leaderboard (members) listener (starts immediately) ─────
    const membersQuery = query(
      collection(db, 'groups', groupId, 'members'),
      orderBy('totalPoints', 'desc')
    );

    membersUnsub = onSnapshot(
      membersQuery,
      (snap) => {
        if (cancelled) return;
        const updatedMembers = snap.docs.map((d) => d.data() as GroupMember);
        setMembers(updatedMembers);
        // Keep myMember in sync so admin badge / points reflect live changes.
        const mine = updatedMembers.find((m) => m.userId === user.uid);
        if (mine) setMyMember(mine);
      },
      (err) => {
        if (err.code === 'permission-denied') return;
        console.error('[GroupDashboard] members listener error:', err);
        toast.error('Failed to keep leaderboard in sync');
      }
    );

    return () => {
      cancelled = true;
      matchesUnsub?.();
      membersUnsub?.();
      betsUnsub?.();
    };
  }, [user, groupId]);



  // Optimistic local update — the real-time bets listener will also push the
  // change within milliseconds, so this just removes any visible flicker.
  function handleMyBetUpdated(updatedBet: Bet) {
    setMyBets((prev) => ({ ...prev, [updatedBet.matchId]: updatedBet }));
    setAllBets((prev) => {
      const existing = prev[updatedBet.matchId] ?? [];
      const others = existing.filter((bet: Bet) => bet.id !== updatedBet.id);
      return { ...prev, [updatedBet.matchId]: [...others, updatedBet] };
    });
  }

  function handleMyBetRemoved(matchId: string) {
    setMyBets((prev) => { const next = { ...prev }; delete next[matchId]; return next; });
    setAllBets((prev) => ({
      ...prev,
      [matchId]: (prev[matchId] ?? []).filter((b: Bet) => b.userId !== user?.uid),
    }));
  }

  // ── loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return <Spinner size="lg" fullPage />;
  }

  // ── access denied ──────────────────────────────────────────────────────────
  if (myMember === null) {
    return (
      <div className="min-h-screen bg-[var(--bg-primary)] flex flex-col items-center justify-center gap-4 px-4">
        <p className="text-red-400 font-semibold">Access denied — you are not a member of this group</p>
        <Link href="/groups" className="text-sm text-green-500 hover:text-green-400">
          Back to My Groups
        </Link>
      </div>
    );
  }

  const isAdmin = myMember?.role === 'admin';
  const today = new Date();
  const memberNames = members.reduce<Record<string, string>>((acc, member) => {
    acc[member.userId] = member.displayName;
    return acc;
  }, {});

  const todayMatches = matches
    .filter(
      (m) =>
        m.status === 'live' ||
        (m.status === 'upcoming' && isSameDay(m.matchDate.toDate(), today))
    )
    .sort((a, b) => a.matchDate.toMillis() - b.matchDate.toMillis());
  const upcomingMatches = matches
    .filter(
      (m) =>
        m.status === 'upcoming' &&
        m.matchDate.toDate() > today &&
        !isSameDay(m.matchDate.toDate(), today)
    )
    .sort((a, b) => a.matchDate.toMillis() - b.matchDate.toMillis());
  const pastMatches = matches.filter((m) => isPastMatch(m, today));
  const filteredPastMatches = pastMatches.filter((m) => {
    if (pastFilter === 'betted') return (allBets[m.id] ?? []).length > 0;
    if (pastFilter === 'mine') return !!myBets[m.id];
    return true;
  });

  // Last 2 past matches where the current user placed a bet
  const recentBetMatches = pastMatches
    .filter((m) => myBets[m.id])
    .sort((a, b) => b.matchDate.toMillis() - a.matchDate.toMillis())
    .slice(0, 1);

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <AppNavbar
        center={
          group?.name ? (
            <span className="font-light text-[var(--text-primary)] text-sm sm:text-base truncate">
              {group.name}
            </span>
          ) : undefined
        }
        maxWidth="5xl"
        tabs={[
          { label: 'Dashboard', href: `/groups/${groupId}` },
          { label: 'Points',    href: `/groups/${groupId}/points` },
          ...(isAdmin ? [{ label: 'Matches', href: `/groups/${groupId}/matches` }] as NavTab[] : []),
          { label: 'Group',     href: `/groups/${groupId}/group` },
        ]}
      />

      {/* Content */}
      <main className="max-w-5xl mx-auto px-2 py-8 space-y-8">

        {/* Recent bets */}
        {recentBetMatches.length > 0 && (
          <section>
            <SectionHeader title="Recent" mb="mb-3" />
            <div className="space-y-3">
              {recentBetMatches.map((m) => (
                <PastMatchCard
                  key={m.id}
                  match={m}
                  bets={allBets[m.id] ?? []}
                  memberNames={memberNames}
                />
              ))}
            </div>
          </section>
        )}

        {/* Live & Today */}
        <section>
          <SectionHeader title="Ongoing" mb="mb-3" />
          {todayMatches.length === 0 ? (
            <Card variant="default" className="text-[var(--text-muted)] text-sm text-center">
              No matches today
            </Card>
          ) : (
            <div className="space-y-3">
              {todayMatches.map((m) => (
                <MatchCard
                  key={m.id}
                  match={m}
                  groupId={groupId}
                  myBet={myBets[m.id]}
                  bets={allBets[m.id] ?? []}
                  memberNames={memberNames}
                  currentUserId={user?.uid}
                  onBetUpdated={handleMyBetUpdated}
                  onBetRemoved={handleMyBetRemoved}
                />
              ))}
            </div>
          )}
        </section>

        {/* Upcoming */}
        <section>
          <SectionHeader title="Upcoming" mb="mb-3" />
          {upcomingMatches.length === 0 ? (
            <Card variant="default" className="text-[var(--text-muted)] text-sm text-center">
              No upcoming matches
            </Card>
          ) : (
            <div className="space-y-3">
              {upcomingMatches.map((m) => (
                <MatchCard
                  key={m.id}
                  match={m}
                  groupId={groupId}
                  myBet={myBets[m.id]}
                  bets={allBets[m.id] ?? []}
                  memberNames={memberNames}
                  currentUserId={user?.uid}
                  onBetUpdated={handleMyBetUpdated}
                  onBetRemoved={handleMyBetRemoved}
                />
              ))}
            </div>
          )}
        </section>

        {/* Past */}
        <section>
          <SectionHeader title={`Previous (${filteredPastMatches.length})`} mb="mb-3" />
          {pastMatches.length > 0 && (
            <div className="flex gap-2 mb-3">
              {([['betted', 'Betted'], ['mine', 'Betted By Me'], ['all', 'All']] as const).map(([val, label]) => (
                <button
                  key={val}
                  onClick={() => setPastFilter(val)}
                  className={`text-xs font-medium px-3 py-1 rounded-full border transition-colors ${
                    pastFilter === val
                      ? 'bg-[var(--accent)] border-[var(--accent)] text-white'
                      : 'bg-[var(--bg-input)] border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent)]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          {filteredPastMatches.length === 0 ? (
            <Card variant="default" className="text-[var(--text-muted)] text-sm text-center">
              {pastMatches.length === 0 ? 'No past matches' : 'No matches for this filter'}
            </Card>
          ) : (
            <div className="space-y-3">
              {filteredPastMatches.map((m) => (
                <PastMatchCard
                  key={m.id}
                  match={m}
                  bets={allBets[m.id] ?? []}
                  memberNames={memberNames}
                />
              ))}
            </div>
          )}
        </section>

      </main>
    </div>
  );
}

export default function GroupDashboardPage() {
  return (
    <ProtectedRoute>
      <GroupDashboardContent />
    </ProtectedRoute>
  );
}
