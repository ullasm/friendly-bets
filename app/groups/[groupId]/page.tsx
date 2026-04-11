'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { X } from 'lucide-react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { collection, query, where, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import AppNavbar, { type NavTab } from '@/components/AppNavbar';
import ProtectedRoute from '@/components/ProtectedRoute';
import { useAuth } from '@/lib/AuthContext';
import { logoutUser } from '@/lib/auth';
import { getGroupById, getUserGroupMember } from '@/lib/groups';
import type { Group, GroupMember } from '@/lib/groups';
import { upsertUserBetForMatch, removeUserBetForMatch } from '@/lib/matches';
import type { Match, Bet } from '@/lib/matches';
import { copyText, getInviteLink } from '@/lib/share';
import { Spinner, Button, Badge, Card, Modal, SectionHeader, PageHeader, Avatar, matchStatusVariant, betStatusVariant } from '@/components/ui';

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

const STAKE_PRESETS = [100, 200, 500, 1000];

type Outcome = 'team_a' | 'team_b' | 'draw';

function getBetActionErrorMessage(err: unknown): string {
  if ((err as { code?: string })?.code === 'permission-denied') {
    return 'Could not update bet due to Firestore permissions. Publish latest rules and try again.';
  }
  return err instanceof Error ? err.message : 'Failed to update bet';
}
function getPickedLabel(match: Match, pickedOutcome: Bet['pickedOutcome']) {
  if (pickedOutcome === 'team_a') return match.teamA;
  if (pickedOutcome === 'team_b') return match.teamB;
  return 'Draw';
}

function getMatchResultLabel(match: Match) {
  if (match.result === 'team_a') return `${match.teamA} won`;
  if (match.result === 'team_b') return `${match.teamB} won`;
  if (match.result === 'draw') return 'Match drawn';
  if (match.result === 'abandoned') return 'Match abandoned';
  return 'Result not declared';
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

  const betsByOutcome = bets.reduce<Record<string, Bet[]>>((acc, bet) => {
    const label = getPickedLabel(match, bet.pickedOutcome);
    acc[label] ??= [];
    acc[label].push(bet);
    return acc;
  }, {});

  const pointSummary = getMatchPointSummary(bets, memberNames);
  const hasSettledSummary = match.status === 'completed' || match.status === 'abandoned';
  const resultLabel = hasSettledSummary ? getMatchResultLabel(match) : null;
  const winningEntries = pointSummary.filter((entry) => entry.pointsDelta > 0);
  const losingEntries = pointSummary.filter((entry) => entry.pointsDelta < 0);
  const refundedEntries = pointSummary.filter((entry) => entry.pointsDelta === 0);

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
        id: myBet?.id ?? betId,
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
                type="number"
                min={1}
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
          <Button
            type="button"
            variant="primary"
            size="lg"
            loading={updatingBet}
            disabled={!selectedOutcome || stake < 1}
            onClick={handleChangeBet}
            className="w-full"
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
                    Won by: {winningEntries.map((entry) => entry.displayName).join(', ')}
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
                    Lost by: {losingEntries.map((entry) => entry.displayName).join(', ')}
                  </span>
                )}
              </div>
            </div>
          )}
          {bets.length > 0 && (
            <div className={hasSettledSummary ? 'border-t border-[var(--border)] pt-3' : ''}>
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
                          // Participant chips: color is dynamic (isMe check), not a fixed Badge variant — left as raw spans
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
          )}
          {hasSettledSummary && (
            <div className="border-t border-[var(--border)] pt-3">
              <p className="text-xs font-semibold text-[var(--text-secondary)]">Points summary</p>
              {pointSummary.length === 0 ? (
                <p className="mt-2 text-xs text-[var(--text-muted)]">No point changes recorded for this match.</p>
              ) : (
                <div className="mt-2 flex flex-wrap gap-2">
                  {pointSummary.map((entry) => (
                    // Points chips: color is dynamic (pointsDelta sign), not a fixed Badge variant — left as raw spans
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
              )}
            </div>
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
        <div className="flex flex-wrap gap-2">
          {sortedBets.map((bet) => {
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
      )}
    </Card>
  );
}

// ── main content ──────────────────────────────────────────────────────────────

function GroupDashboardContent() {
  const params = useParams<{ groupId: string }>();
  const groupId = params.groupId;
  const router = useRouter();
  const { user, userProfile } = useAuth();

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

  async function copyInviteLink() {
    if (!group) return;
    const link = getInviteLink(group.inviteCode);
    try {
      await copyText(link);
      toast.success('Link copied!');
    } catch {
      toast.error('Could not copy the invite link');
    }
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
  const inviteLink = group ? getInviteLink(group.inviteCode) : '';
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
          ...(isAdmin ? [
            { label: 'Matches', href: `/groups/${groupId}/admin` },
            { label: 'Group',   href: `/groups/${groupId}/manage` },
          ] as NavTab[] : []),
        ]}
      />

      {/* Content */}
      <main className="max-w-5xl mx-auto px-6 py-8 space-y-8">

        {/* Recent bets */}
        {recentBetMatches.length > 0 && (
          <section>
            <SectionHeader title="Your Recent Bet" mb="mb-3" />
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
          <SectionHeader title="Live &amp; Today's Matches" mb="mb-3" />
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
          <SectionHeader title="Upcoming Matches" mb="mb-3" />
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
          <SectionHeader title={`Past Matches (${filteredPastMatches.length})`} mb="mb-3" />
          {pastMatches.length > 0 && (
            <div className="flex gap-2 mb-3">
              {([['betted', 'Only Betted'], ['mine', 'Betted By Me'], ['all', 'All']] as const).map(([val, label]) => (
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

        {/* Leaderboard */}
        <section>
          <Card variant="default">
            <SectionHeader title="Leaderboard" mb="mb-4" />
            {members.length === 0 ? (
              <p className="text-[var(--text-muted)] text-sm text-center">No members yet</p>
            ) : (
              <ol className="space-y-2">
                {members.map((m, i) => {
                  const isMe = m.userId === user?.uid;
                  return (
                    <li
                      key={m.userId}
                      className={`flex items-center justify-between py-2 px-3 rounded-lg ${
                        isMe
                          ? 'bg-green-500/10 border border-green-500/30'
                          : 'bg-[var(--bg-input)]'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-[var(--text-muted)] text-sm w-5 text-right">{i + 1}</span>
                        <Avatar name={m.displayName} color={m.avatarColor} size="sm" />
                        <span className="text-sm text-[var(--text-primary)]">{m.displayName}</span>
                        {isMe && (
                          <span className="text-xs text-green-500 font-medium">(you)</span>
                        )}
                        {m.role === 'admin' && (
                          <Badge variant="role-admin" shape="tag">Admin</Badge>
                        )}
                      </div>
                      <span className="text-sm font-semibold text-green-400">
                        {m.totalPoints} pts
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}
          </Card>
        </section>

        {/* Invite */}
        <section>
          <Card variant="default" className="space-y-4">
            <SectionHeader title="Invite Friends" mb="mb-0" />
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs bg-[var(--bg-input)] border border-[var(--border)] rounded-lg px-3 py-2 text-[var(--text-secondary)] truncate">
                {inviteLink}
              </code>
              <Button variant="secondary" size="md" onClick={copyInviteLink} className="shrink-0">
                Copy Link
              </Button>
            </div>
            {/* WhatsApp link: uses brand color #25D366, no matching Button variant — left as raw <a> */}
            <a
              href={`https://wa.me/?text=${encodeURIComponent(`Join my WhoWins group! Click here: ${inviteLink}`)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full rounded-lg bg-[#25D366] hover:bg-[#1ebe5d] text-white font-semibold text-sm px-4 py-2.5 transition-colors"
            >
              <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
              </svg>
              Share on WhatsApp
            </a>
          </Card>
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
