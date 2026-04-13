'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { doc, updateDoc, Timestamp } from 'firebase/firestore';
import { RefreshCw } from 'lucide-react';
import { db } from '@/lib/firebase';
import AppNavbar from '@/components/AppNavbar';
import ProtectedRoute from '@/components/ProtectedRoute';
import { useAuth } from '@/lib/AuthContext';
import { logoutUser } from '@/lib/auth';
import { getGroupById, getUserGroupMember, getGroupMembers } from '@/lib/groups';
import type { Group, GroupMember } from '@/lib/groups';
import { getMatches, createMatch, declareMatchResult, updateMatch, deleteMatch, getGroupBetsForMatch, adminUpsertBetForMatch, adminClearBetForMatch, getBetsForGroup } from '@/lib/matches';
import type { Match, Bet } from '@/lib/matches';
import { WhoBettedSection, PotentialOutcomesSection, PointsSummarySection, getMatchResultLabel } from '@/components/MatchBettingDetails';
import { getActiveMatches } from '@/lib/masterMatches';
import type { MasterMatch } from '@/lib/masterMatches';
import { Spinner, Button, Badge, Card, FormInput, FormSelect, FormCheckbox, Modal, SectionHeader, PageHeader, Avatar, CenteredCard, matchStatusVariant } from '@/components/ui';

type ResultOption = 'team_a' | 'team_b' | 'draw' | 'abandoned';
type BetPickOption = 'team_a' | 'team_b' | 'draw';
type MemberBetDraft = { pickedOutcome: '' | BetPickOption; stake: string };

// INPUT_CLASS kept for manage-bets modal inputs only — those use text-xs labels
// which differ from FormInput/FormSelect's text-sm labels (would be a visual change)
const INPUT_CLASS =
  'w-full rounded-lg bg-[var(--bg-input)] border border-[var(--border)] px-4 py-2.5 text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent';

function formatMatchDate(ts: Match['matchDate']) {
  return ts.toDate().toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatCricDate(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;

  // CricAPI sometimes returns date-only strings (e.g. "2026-04-07") with no
  // real time. JS parses these as UTC midnight, which in IST shows as 5:30 AM
  // for every match. Detect this by checking if the string lacks a time part.
  const hasTime = /T\d|^\d{4}-\d{2}-\d{2} \d/.test(dateStr);

  if (!hasTime) {
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function abbreviateTeam(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length <= 1) return name;
  return words.map((w) => w[0].toUpperCase()).join('');
}

function parseTeams(matchName: string, abbreviate = false): { teamA: string; teamB: string } {
  const parts = matchName.split(/ vs | v /i);
  if (parts.length >= 2) {
    const teamA = parts[0].trim();
    const teamB = parts[1].split(',')[0].trim();
    return {
      teamA: abbreviate ? abbreviateTeam(teamA) : teamA,
      teamB: abbreviate ? abbreviateTeam(teamB) : teamB,
    };
  }
  return { teamA: matchName.trim(), teamB: 'TBD' };
}

function extractLeague(matchName: string): string {
  const parts = matchName.split(', ');
  return parts.length >= 3 ? parts.slice(2).join(', ') : '';
}

// Parses "Match starts at Apr 12, 10:00 GMT" → Date object in UTC.
// Falls back to dateTimeLocal / date if status doesn't contain a parseable time.
function parseDateFromStatus(status: string, fallback: string): Date {
  const m = status.match(/Match starts at (\w+)\s+(\d{1,2}),?\s*(\d{1,2}:\d{2})\s*(GMT|UTC)?/i);
  if (m) {
    const [, month, day, time] = m;
    const fallbackDate = new Date(fallback);
    const year = isNaN(fallbackDate.getTime()) ? new Date().getFullYear() : fallbackDate.getFullYear();
    const parsed = new Date(`${month} ${day} ${year} ${time}:00 GMT`);
    if (!isNaN(parsed.getTime())) return parsed;
  }
  return new Date(fallback);
}

function inferFormat(seriesName: string): Match['format'] {
  const s = seriesName.toLowerCase();
  if (s.includes('test')) return 'Test';
  if (s.includes('odi') || s.includes('one day')) return 'ODI';
  return 'T20';
}

function getResultLabel(match: Match): string {
  if (match.result === 'team_a') return `${match.teamA} won`;
  if (match.result === 'team_b') return `${match.teamB} won`;
  if (match.result === 'draw') return 'Match drawn';
  if (match.result === 'abandoned') return 'Match abandoned';
  if (match.result === 'pending') return 'Pending';
  return match.result;
}

function getBetLabel(match: Match, pickedOutcome: Bet['pickedOutcome']): string {
  if (pickedOutcome === 'team_a') return match.teamA;
  if (pickedOutcome === 'team_b') return match.teamB;
  return 'Draw';
}

function getActionErrorMessage(err: unknown, fallback: string): string {
  if ((err as { code?: string })?.code === 'permission-denied') {
    return 'Firestore rules need to be published to allow admin-managed bets for past matches.';
  }
  return err instanceof Error ? err.message : fallback;
}

// ── main content ──────────────────────────────────────────────────────────────

function GroupAdminContent() {
  const params = useParams<{ groupId: string }>();
  const groupId = params.groupId;
  const router = useRouter();
  const { user, userProfile } = useAuth();

  // access state
  const [isAdmin, setIsAdmin] = useState<boolean | undefined>(undefined);
  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  // form state
  const [teamA, setTeamA] = useState('');
  const [teamB, setTeamB] = useState('');
  const [format, setFormat] = useState<Match['format']>('T20');
  const [matchDate, setMatchDate] = useState('');
  const [drawAllowed, setDrawAllowed] = useState(false);
  const [noDrawPolicy, setNoDrawPolicy] = useState<Match['noDrawPolicy']>('refund');
  const [bettingOpen, setBettingOpen] = useState(true);
  const [creationStatus, setCreationStatus] = useState<Match['status']>('upcoming');
  const [creationResult, setCreationResult] = useState<Match['result']>('pending');
  const [creating, setCreating] = useState(false);

  // matches state
  const [matches, setMatches] = useState<Match[]>([]);
  const [allGroupBets, setAllGroupBets] = useState<Record<string, Bet[]>>({});
  const [matchFilter, setMatchFilter] = useState<'all' | 'ongoing' | 'past' | 'upcoming'>('all');
  const [selectedResult, setSelectedResult] = useState<Record<string, ResultOption>>({});
  const [declaring, setDeclaring] = useState<Record<string, boolean>>({});
  const [togglingBet, setTogglingBet] = useState<Record<string, boolean>>({});
  const [managingBetsFor, setManagingBetsFor] = useState<Match | null>(null);
  const [matchBets, setMatchBets] = useState<Record<string, Bet | null>>({});
  const [betDrafts, setBetDrafts] = useState<Record<string, MemberBetDraft>>({});
  const [savingMemberBets, setSavingMemberBets] = useState<Record<string, boolean>>({});
  const [loadingManageBets, setLoadingManageBets] = useState(false);

  // edit state
  const [editingMatch, setEditingMatch] = useState<Match | null>(null);
  const [editTeamA, setEditTeamA] = useState('');
  const [editTeamB, setEditTeamB] = useState('');
  const [editFormat, setEditFormat] = useState<Match['format']>('T20');
  const [editMatchDate, setEditMatchDate] = useState('');
  const [editDrawAllowed, setEditDrawAllowed] = useState(false);
  const [editNoDrawPolicy, setEditNoDrawPolicy] = useState<Match['noDrawPolicy']>('refund');
  const [editBettingOpen, setEditBettingOpen] = useState(true);
  const [saving, setSaving] = useState(false);

  // delete state
  const [confirmDelete, setConfirmDelete] = useState<Match | null>(null);
  const [deleting, setDeleting] = useState(false);

  // master matches state
  const [masterMatches, setMasterMatches] = useState<MasterMatch[]>([]);
  const [cricLoading, setCricLoading] = useState(false);
  const [cricFetched, setCricFetched] = useState(false);
  const [addedIds, setAddedIds] = useState<Record<string, 'adding' | 'added'>>({});
  const [selectedLeagues, setSelectedLeagues] = useState<Set<string>>(new Set());

  const leagues = useMemo(() => {
    const set = new Set<string>();
    masterMatches.forEach((mm) => { if (mm.seriesName) set.add(mm.seriesName); });
    return Array.from(set).sort();
  }, [masterMatches]);

  const filteredMasterMatches = useMemo(() =>
    selectedLeagues.size === 0
      ? masterMatches
      : masterMatches.filter((mm) => selectedLeagues.has(mm.seriesName)),
    [masterMatches, selectedLeagues]
  );

  // Set of cricApiMatchIds already in the group
  const addedCricIds = useMemo(() => {
    const set = new Set<string>();
    matches.forEach((m) => { if (m.cricApiMatchId) set.add(m.cricApiMatchId); });
    return set;
  }, [matches]);

  // Fallback keys for manually-added matches: "ABBR_A|ABBR_B|YYYY-MM-DD"
  const addedTeamDateKeys = useMemo(() => {
    const set = new Set<string>();
    matches.forEach((m) => {
      if (!m.cricApiMatchId) {
        const d = m.matchDate.toDate();
        const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const a = abbreviateTeam(m.teamA);
        const b = abbreviateTeam(m.teamB);
        set.add(`${a}|${b}|${ds}`);
        set.add(`${b}|${a}|${ds}`);
      }
    });
    return set;
  }, [matches]);

  function isMasterMatchAlreadyAdded(mm: MasterMatch): boolean {
    if (addedCricIds.has(mm.sourceMatchId)) return true;
    const d = mm.startsAt.toDate();
    const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return addedTeamDateKeys.has(`${mm.teamAShort}|${mm.teamBShort}|${ds}`) ||
      addedTeamDateKeys.has(`${abbreviateTeam(mm.teamA)}|${abbreviateTeam(mm.teamB)}|${ds}`);
  }

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    Promise.all([
      getUserGroupMember(groupId, user.uid),
      getGroupById(groupId),
      getMatches(groupId),
      getGroupMembers(groupId),
      getBetsForGroup(groupId),
    ]).then(([member, g, mats, loadedMembers, groupBets]) => {
      if (cancelled) return;
      setIsAdmin(member?.role === 'admin');
      setGroup(g);
      setMatches(mats);
      setMembers(loadedMembers);
      const betsByMatch: Record<string, Bet[]> = {};
      for (const bet of groupBets) {
        betsByMatch[bet.matchId] ??= [];
        betsByMatch[bet.matchId].push(bet);
      }
      setAllGroupBets(betsByMatch);
    }).catch((err) => {
      if (cancelled) return;
      if ((err as { code?: string })?.code === 'permission-denied') {
        setIsAdmin(false);
      } else {
        setLoadError('Failed to load page. Please try again.');
      }
    });
    return () => { cancelled = true; };
  }, [user, groupId, retryKey]);

  useEffect(() => {
    if (format === 'Test') setDrawAllowed(true);
    else setDrawAllowed(false);
  }, [format]);



  async function refreshMatches() {
    const [mats, groupBets] = await Promise.all([getMatches(groupId), getBetsForGroup(groupId)]);
    setMatches(mats);
    const betsByMatch: Record<string, Bet[]> = {};
    for (const bet of groupBets) {
      betsByMatch[bet.matchId] ??= [];
      betsByMatch[bet.matchId].push(bet);
    }
    setAllGroupBets(betsByMatch);
  }

  async function refreshMembers() {
    const loadedMembers = await getGroupMembers(groupId);
    setMembers(loadedMembers);
  }

  async function loadManageBets(match: Match) {
    setLoadingManageBets(true);
    try {
      const [loadedMembers, bets] = await Promise.all([
        getGroupMembers(groupId),
        getGroupBetsForMatch(match.id, groupId),
      ]);

      const betsByUser: Record<string, Bet | null> = {};
      const draftsByUser: Record<string, MemberBetDraft> = {};

      for (const member of loadedMembers) {
        const existingBet = bets.find((bet) => bet.userId === member.userId) ?? null;
        betsByUser[member.userId] = existingBet;
        draftsByUser[member.userId] = {
          pickedOutcome: existingBet?.pickedOutcome ?? '',
          stake: existingBet ? String(existingBet.stake) : '1000',
        };
      }

      setMembers(loadedMembers);
      setMatchBets(betsByUser);
      setBetDrafts(draftsByUser);
      setManagingBetsFor(match);
    } finally {
      setLoadingManageBets(false);
    }
  }

  async function openManageBets(match: Match) {
    try {
      await loadManageBets(match);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load match bets');
    }
  }

  function updateBetDraft(userId: string, field: keyof MemberBetDraft, value: string) {
    setBetDrafts((prev) => ({
      ...prev,
      [userId]: {
        pickedOutcome: prev[userId]?.pickedOutcome ?? '',
        stake: prev[userId]?.stake ?? '',
        [field]: value,
      },
    }));
  }

  async function handleSaveMemberBet(userId: string) {
    if (!managingBetsFor) return;

    const draft = betDrafts[userId];
    if (!draft?.pickedOutcome) {
      toast.error('Select a bet option');
      return;
    }

    const stake = Number(draft.stake);
    if (!Number.isFinite(stake) || stake <= 0) {
      toast.error('Enter a valid stake greater than 0');
      return;
    }

    setSavingMemberBets((prev) => ({ ...prev, [userId]: true }));
    try {
      await adminUpsertBetForMatch(managingBetsFor.id, groupId, userId, {
        pickedOutcome: draft.pickedOutcome,
        stake,
      });
      await refreshMembers();
      await loadManageBets(managingBetsFor);
      await refreshMatches();
      toast.success('Bet saved');
    } catch (err) {
      toast.error(getActionErrorMessage(err, 'Failed to save bet'));
    } finally {
      setSavingMemberBets((prev) => ({ ...prev, [userId]: false }));
    }
  }

  async function handleClearMemberBet(userId: string) {
    if (!managingBetsFor) return;

    setSavingMemberBets((prev) => ({ ...prev, [userId]: true }));
    try {
      await adminClearBetForMatch(managingBetsFor.id, groupId, userId);
      await refreshMembers();
      await loadManageBets(managingBetsFor);
      await refreshMatches();
      toast.success('Bet cleared');
    } catch (err) {
      toast.error(getActionErrorMessage(err, 'Failed to clear bet'));
    } finally {
      setSavingMemberBets((prev) => ({ ...prev, [userId]: false }));
    }
  }

  async function handleSearchMasterMatches() {
    setCricLoading(true);
    setCricFetched(true);
    setSelectedLeagues(new Set());
    try {
      const mats = await getActiveMatches();
      // Live first, then upcoming sorted by startsAt ascending
      mats.sort((a, b) => {
        const aLive = a.status === 'live';
        const bLive = b.status === 'live';
        if (aLive !== bLive) return aLive ? -1 : 1;
        return a.startsAt.toMillis() - b.startsAt.toMillis();
      });
      setMasterMatches(mats);
    } catch (err) {
      console.error('[admin] loadMasterMatches failed:', err);
      setMasterMatches([]);
    } finally {
      setCricLoading(false);
    }
  }

  async function handleAddMasterMatch(mm: MasterMatch) {
    const format = inferFormat(mm.seriesName);
    const drawAllowed = format === 'Test';
    const status: Match['status'] = mm.status === 'live' ? 'live' : 'upcoming';

    setAddedIds((prev) => ({ ...prev, [mm.sourceMatchId]: 'adding' }));
    try {
      await createMatch(groupId, {
        teamA: mm.teamAShort,
        teamB: mm.teamBShort,
        format,
        drawAllowed,
        noDrawPolicy: 'refund',
        matchDate: mm.startsAt,
        status,
        result: 'pending',
        bettingOpen: true,
        bettingClosedAt: null,
        cricApiMatchId: mm.sourceMatchId,
      });
      toast.success('Match added!');
      setAddedIds((prev) => ({ ...prev, [mm.sourceMatchId]: 'added' }));
      await refreshMatches();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add match');
      setAddedIds((prev) => { const next = { ...prev }; delete next[mm.sourceMatchId]; return next; });
    }
  }

  async function handleCreateMatch(e: React.FormEvent) {
    e.preventDefault();
    if (!matchDate) { toast.error('Please set a match date'); return; }

    const trimmedTeamA = teamA.trim();
    const trimmedTeamB = teamB.trim();
    if (!trimmedTeamA || !trimmedTeamB) {
      toast.error('Both team names are required');
      return;
    }

    const resolvedDrawAllowed = format === 'Test' ? true : drawAllowed;
    const resolvedStatus = creationStatus;
    let resolvedResult: Match['result'] = 'pending';

    if (resolvedStatus === 'completed') {
      if (creationResult === 'pending' || creationResult === 'abandoned') {
        toast.error('Choose a completed match result');
        return;
      }
      resolvedResult = creationResult;
    } else if (resolvedStatus === 'abandoned') {
      resolvedResult = 'abandoned';
    }

    const resolvedBettingOpen = resolvedStatus === 'upcoming' || resolvedStatus === 'live'
      ? bettingOpen
      : false;

    setCreating(true);
    try {
      await createMatch(groupId, {
        teamA: trimmedTeamA,
        teamB: trimmedTeamB,
        format,
        drawAllowed: resolvedDrawAllowed,
        noDrawPolicy: resolvedDrawAllowed ? noDrawPolicy : 'refund',
        matchDate: Timestamp.fromDate(new Date(matchDate)),
        status: resolvedStatus,
        result: resolvedResult,
        bettingOpen: resolvedBettingOpen,
        bettingClosedAt: resolvedBettingOpen ? null : Timestamp.fromDate(new Date(matchDate)),
        cricApiMatchId: null,
      });
      toast.success('Match created!');
      setTeamA(''); setTeamB(''); setFormat('T20');
      setMatchDate(''); setDrawAllowed(false); setBettingOpen(true);
      setCreationStatus('upcoming'); setCreationResult('pending');
      await refreshMatches();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create match');
    } finally {
      setCreating(false);
    }
  }

  async function handleToggleBetting(match: Match) {
    setTogglingBet((p) => ({ ...p, [match.id]: true }));
    try {
      await updateDoc(doc(db, 'matches', match.id), {
        bettingOpen: !match.bettingOpen,
        bettingClosedAt: match.bettingOpen ? Timestamp.now() : null,
      });
      setMatches((prev) =>
        prev.map((m) =>
          m.id === match.id
            ? { ...m, bettingOpen: !m.bettingOpen, bettingClosedAt: match.bettingOpen ? Timestamp.now() : null }
            : m
        )
      );
      toast.success(match.bettingOpen ? 'Betting closed' : 'Betting opened');
    } catch (err) {
      console.error('[admin] handleToggleBetting failed:', err);
      toast.error('Failed to update betting');
    } finally {
      setTogglingBet((p) => ({ ...p, [match.id]: false }));
    }
  }

  function openEdit(match: Match) {
    setEditingMatch(match);
    setEditTeamA(match.teamA);
    setEditTeamB(match.teamB);
    setEditFormat(match.format);
    setEditDrawAllowed(match.drawAllowed);
    setEditNoDrawPolicy(match.noDrawPolicy);
    setEditBettingOpen(match.bettingOpen);
    // Convert Firestore Timestamp to datetime-local string (local time)
    const d = match.matchDate.toDate();
    const pad = (n: number) => String(n).padStart(2, '0');
    setEditMatchDate(
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
    );
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingMatch || !editMatchDate) return;
    setSaving(true);
    try {
      const drawAllowed = editFormat === 'Test' ? true : editDrawAllowed;
      await updateMatch(editingMatch.id, {
        teamA: editTeamA.trim(),
        teamB: editTeamB.trim(),
        format: editFormat,
        drawAllowed,
        noDrawPolicy: drawAllowed ? editNoDrawPolicy : 'refund',
        matchDate: Timestamp.fromDate(new Date(editMatchDate)),
        bettingOpen: editBettingOpen,
      });
      toast.success('Match updated!');
      setEditingMatch(null);
      await refreshMatches();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update match');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteConfirmed() {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      await deleteMatch(confirmDelete.id);
      toast.success('Match deleted');
      setConfirmDelete(null);
      await refreshMatches();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete match');
    } finally {
      setDeleting(false);
    }
  }

  async function handleDeclareResult(match: Match) {
    const result = selectedResult[match.id] ?? (match.result !== 'pending' ? match.result : undefined);
    if (!result) return;
    setDeclaring((p) => ({ ...p, [match.id]: true }));
    try {
      await declareMatchResult(match.id, groupId, result, match.noDrawPolicy);
      toast.success(match.status === 'completed' || match.status === 'abandoned'
        ? 'Result updated and points re-settled!'
        : 'Result declared and points settled!');
      await refreshMembers();
      await refreshMatches();
      if (managingBetsFor?.id === match.id) {
        await loadManageBets(match);
      }
    } catch (err) {
      toast.error(getActionErrorMessage(err, 'Failed to declare result'));
    } finally {
      setDeclaring((p) => ({ ...p, [match.id]: false }));
    }
  }

  // ── load error ───────────────────────────────────────────────────────────
  if (loadError) {
    return (
      <CenteredCard maxWidth="max-w-sm">
        <Card variant="modal" padding="p-8" className="text-center space-y-4">
          <p className="text-red-400 font-semibold">{loadError}</p>
          <Button
            variant="primary"
            size="md"
            onClick={() => { setLoadError(null); setRetryKey((k) => k + 1); }}
          >
            Retry
          </Button>
        </Card>
      </CenteredCard>
    );
  }

  // ── loading ──────────────────────────────────────────────────────────────
  if (isAdmin === undefined) {
    return <Spinner size="lg" fullPage />;
  }

  // ── access denied ────────────────────────────────────────────────────────
  if (!isAdmin) {
    return (
      <CenteredCard maxWidth="max-w-sm">
        <Card variant="modal" padding="p-8" className="text-center space-y-4">
          <p className="text-red-400 font-semibold">Access denied</p>
          <p className="text-sm text-[var(--text-secondary)]">You need admin privileges to view this page.</p>
          <Button variant="primary" size="md" href={`/groups/${groupId}`}>
            Back to Group
          </Button>
        </Card>
      </CenteredCard>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)]">

      {/* ── Manage Member Bets modal ── */}
      <Modal
        open={!!managingBetsFor}
        onClose={() => setManagingBetsFor(null)}
        maxWidth="4xl"
        scrollable
      >
        {managingBetsFor && (
          <>
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <h3 className="font-semibold text-[var(--text-primary)]">Manage Member Bets</h3>
                <p className="text-sm text-[var(--text-secondary)] mt-1">
                  {managingBetsFor.teamA} vs {managingBetsFor.teamB} · {formatMatchDate(managingBetsFor.matchDate)}
                </p>
                <p className="text-xs text-[var(--text-muted)] mt-1">
                  Add, update, or clear any member bet. Finished matches will automatically re-settle points after each change.
                </p>
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="shrink-0"
                onClick={() => setManagingBetsFor(null)}
              >
                Close
              </Button>
            </div>

            {loadingManageBets ? (
              <div className="py-10 text-center text-sm text-[var(--text-muted)]">Loading member bets…</div>
            ) : members.length === 0 ? (
              <div className="py-10 text-center text-sm text-[var(--text-muted)]">No group members found.</div>
            ) : (
              <div className="space-y-3">
                {members.map((member) => {
                  const currentBet = matchBets[member.userId];
                  const draft = betDrafts[member.userId] ?? { pickedOutcome: '', stake: '1000' };
                  const isSaving = savingMemberBets[member.userId];
                  return (
                    <div key={member.userId} className="rounded-xl border border-[var(--border)] bg-[var(--bg-input)] p-4 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <Avatar name={member.displayName} color={member.avatarColor} size="lg" />
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium text-[var(--text-primary)] truncate">{member.displayName}</span>
                              {/* Role badge in bets modal: uses bg-[var(--bg-card)] + border, different
                                  from role-admin/role-member Badge which has no border — left as raw span */}
                              <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-secondary)]">
                                {member.role}
                              </span>
                            </div>
                            <p className="text-xs text-[var(--text-muted)]">Total points: {member.totalPoints}</p>
                          </div>
                        </div>
                        <div className="text-right text-xs text-[var(--text-secondary)]">
                          {currentBet ? (
                            <>
                              <div>Current bet: {getBetLabel(managingBetsFor, currentBet.pickedOutcome)} · {currentBet.stake} pts</div>
                              <div>Status: {currentBet.status}</div>
                            </>
                          ) : (
                            <div>No bet recorded yet</div>
                          )}
                        </div>
                      </div>

                      {/* Manage bets inputs: labels are text-xs (not text-sm), use INPUT_CLASS directly
                          to avoid visual change from FormInput/FormSelect's text-sm label sizing */}
                      <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_160px_auto_auto] gap-3 items-end">
                        <div>
                          <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Pick</label>
                          <select
                            value={draft.pickedOutcome}
                            onChange={(e) => updateBetDraft(member.userId, 'pickedOutcome', e.target.value)}
                            className={INPUT_CLASS}
                          >
                            <option value="">Select outcome...</option>
                            <option value="team_a">{managingBetsFor.teamA}</option>
                            <option value="team_b">{managingBetsFor.teamB}</option>
                            {managingBetsFor.drawAllowed && <option value="draw">Draw</option>}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Stake</label>
                          <input
                            type="number"
                            min="1"
                            step="1"
                            value={draft.stake}
                            onChange={(e) => updateBetDraft(member.userId, 'stake', e.target.value)}
                            className={INPUT_CLASS}
                            placeholder="Points"
                          />
                        </div>
                        <Button
                          type="button"
                          variant="primary"
                          size="md"
                          loading={isSaving}
                          onClick={() => handleSaveMemberBet(member.userId)}
                        >
                          {currentBet ? 'Update Bet' : 'Add Bet'}
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          size="md"
                          disabled={isSaving || !currentBet}
                          onClick={() => handleClearMemberBet(member.userId)}
                        >
                          Clear Bet
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </Modal>

      {/* ── Edit match modal ── */}
      <Modal
        open={!!editingMatch}
        onClose={() => setEditingMatch(null)}
        maxWidth="lg"
        title="Edit Match"
      >
        {editingMatch && (
          <form onSubmit={handleSaveEdit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <FormInput label="Team A" type="text" required value={editTeamA} onChange={(e) => setEditTeamA(e.target.value)} />
              <FormInput label="Team B" type="text" required value={editTeamB} onChange={(e) => setEditTeamB(e.target.value)} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <FormSelect
                label="Format"
                value={editFormat}
                onChange={(e) => {
                  const f = e.target.value as Match['format'];
                  setEditFormat(f);
                  if (f === 'Test') setEditDrawAllowed(true);
                  else setEditDrawAllowed(false);
                }}
              >
                <option value="T20">T20</option>
                <option value="ODI">ODI</option>
                <option value="Test">Test</option>
              </FormSelect>
              <FormInput
                label="Match Date &amp; Time"
                type="datetime-local"
                required
                value={editMatchDate}
                onChange={(e) => setEditMatchDate(e.target.value)}
              />
            </div>
            <div className="flex flex-wrap items-center gap-6">
              <FormCheckbox
                label="Allow Draw"
                checked={editDrawAllowed}
                disabled={editFormat === 'Test'}
                onChange={(e) => setEditDrawAllowed(e.target.checked)}
                hint={editFormat === 'Test' ? '(auto for Test)' : undefined}
              />
              <FormCheckbox
                label="Betting Open"
                checked={editBettingOpen}
                onChange={(e) => setEditBettingOpen(e.target.checked)}
              />
            </div>
            {editDrawAllowed && (
              <FormSelect
                label="No Draw Policy"
                value={editNoDrawPolicy}
                onChange={(e) => setEditNoDrawPolicy(e.target.value as Match['noDrawPolicy'])}
                wrapperClassName="max-w-xs"
              >
                <option value="refund">Refund all</option>
                <option value="rollover">Rollover</option>
              </FormSelect>
            )}
            <div className="flex gap-3 pt-1">
              <Button type="submit" variant="primary" size="lg" loading={saving} className="flex-1">
                Save Changes
              </Button>
              <Button type="button" variant="secondary" size="lg" className="flex-1" onClick={() => setEditingMatch(null)}>
                Cancel
              </Button>
            </div>
          </form>
        )}
      </Modal>

      {/* ── Delete confirmation modal ── */}
      <Modal
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        maxWidth="sm"
        title="Delete match?"
      >
        {confirmDelete && (
          <div className="space-y-4">
            <p className="text-sm text-[var(--text-secondary)]">
              Are you sure you want to delete{' '}
              <span className="font-medium text-[var(--text-primary)]">{confirmDelete.teamA} vs {confirmDelete.teamB}</span>?
              This cannot be undone.
            </p>
            <div className="flex gap-3">
              <Button variant="secondary" size="md" className="flex-1" onClick={() => setConfirmDelete(null)}>
                Cancel
              </Button>
              <Button variant="danger" size="md" className="flex-1" loading={deleting} onClick={handleDeleteConfirmed}>
                Delete
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Navbar */}
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
          { label: 'Dashboard',   href: `/groups/${groupId}` },
          { label: 'Points',   href: `/groups/${groupId}/points` },
          { label: 'Matches',  href: `/groups/${groupId}/matches` },
          { label: 'Group',       href: `/groups/${groupId}/group` },
        ]}
      />

      <main className="max-w-5xl mx-auto px-2 py-8 space-y-10">

        {/* ── Master Matches Import ── */}
        <section>
          <SectionHeader title="Add Matches" mb="mb-4" />
          <Card variant="default" className="space-y-4">
            <Button
              variant="secondary"
              size="md"
              loading={cricLoading}
              onClick={handleSearchMasterMatches}
            >
              {!cricLoading && <RefreshCw className="h-4 w-4" />}
              Search Matches
            </Button>

            {cricFetched && !cricLoading && (
              masterMatches.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)] text-center py-2">
                  No upcoming matches found
                </p>
              ) : (
                <div className="space-y-3">
                  {leagues.length > 1 && (
                    <div className="flex flex-wrap gap-2">
                      {leagues.map((league) => {
                        const active = selectedLeagues.has(league);
                        return (
                          <button
                            key={league}
                            onClick={() => setSelectedLeagues((prev) => {
                              const next = new Set(prev);
                              if (next.has(league)) next.delete(league); else next.add(league);
                              return next;
                            })}
                            className={`text-xs font-medium px-3 py-1 rounded-full border transition-colors ${
                              active
                                ? 'bg-[var(--accent)] border-[var(--accent)] text-white'
                                : 'bg-[var(--bg-input)] border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent)]'
                            }`}
                          >
                            {league}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {filteredMasterMatches.map((mm) => {
                    const alreadyAdded = isMasterMatchAlreadyAdded(mm) || addedIds[mm.sourceMatchId] === 'added';
                    const adding = addedIds[mm.sourceMatchId] === 'adding';
                    const typeLabel = inferFormat(mm.seriesName);
                    return (
                      <div
                        key={mm.sourceMatchId}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-[var(--bg-input)] border border-[var(--border)] px-4 py-3"
                      >
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium text-sm text-[var(--text-primary)]">
                              {mm.teamA} vs {mm.teamB}
                            </span>
                            {mm.status === 'live' && (
                              <span className="flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-red-500/20 text-red-400">
                                <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
                                Live
                              </span>
                            )}
                            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-secondary)]">
                              {typeLabel}
                            </span>
                          </div>
                          <p className="text-xs text-[var(--text-muted)]">
                            {mm.seriesName} · {mm.startsAt.toDate().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
                          </p>
                        </div>
                        <button
                          onClick={() => handleAddMasterMatch(mm)}
                          disabled={alreadyAdded || adding}
                          className={`shrink-0 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors disabled:cursor-not-allowed ${alreadyAdded
                              ? 'bg-green-500/20 text-green-400 disabled:opacity-100'
                              : adding
                                ? 'bg-green-500/20 text-green-400 opacity-60'
                                : 'bg-green-500 hover:bg-green-600 text-white'
                            }`}
                        >
                          {alreadyAdded ? 'Added ✓' : adding ? 'Adding…' : 'Add to Group'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )
            )}
          </Card>
        </section>

        {/* ── Create Match ── */}
        <section>
          <SectionHeader title="Create Match" mb="mb-4" />
          <Card variant="default">
            <form onSubmit={handleCreateMatch} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormInput label="Team A" type="text" required value={teamA} onChange={(e) => setTeamA(e.target.value)} placeholder="e.g. India" />
                <FormInput label="Team B" type="text" required value={teamB} onChange={(e) => setTeamB(e.target.value)} placeholder="e.g. Australia" />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormSelect label="Format" value={format} onChange={(e) => setFormat(e.target.value as Match['format'])}>
                  <option value="T20">T20</option>
                  <option value="ODI">ODI</option>
                  <option value="Test">Test</option>
                </FormSelect>
                <FormInput
                  label="Match Date &amp; Time"
                  type="datetime-local"
                  required
                  value={matchDate}
                  onChange={(e) => setMatchDate(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormSelect label="Initial Status" value={creationStatus} onChange={(e) => setCreationStatus(e.target.value as Match['status'])}>
                  <option value="upcoming">Upcoming</option>
                  <option value="live">Live</option>
                  <option value="completed">Completed</option>
                  <option value="abandoned">Abandoned</option>
                </FormSelect>
                {creationStatus === 'completed' && (
                  <FormSelect label="Declared Result" value={creationResult} onChange={(e) => setCreationResult(e.target.value as Match['result'])}>
                    <option value="pending" disabled>Select result...</option>
                    <option value="team_a">{teamA.trim() || 'Team A'} wins</option>
                    <option value="team_b">{teamB.trim() || 'Team B'} wins</option>
                    {drawAllowed && <option value="draw">Draw</option>}
                  </FormSelect>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-6">
                <FormCheckbox
                  label="Allow Draw"
                  checked={drawAllowed}
                  disabled={format === 'Test'}
                  onChange={(e) => setDrawAllowed(e.target.checked)}
                  hint={format === 'Test' ? '(auto for Test)' : undefined}
                />
                {(creationStatus === 'upcoming' || creationStatus === 'live') && (
                  <FormCheckbox
                    label="Betting Open"
                    checked={bettingOpen}
                    onChange={(e) => setBettingOpen(e.target.checked)}
                  />
                )}
              </div>

              {drawAllowed && (
                <FormSelect
                  label="No Draw Policy"
                  value={noDrawPolicy}
                  onChange={(e) => setNoDrawPolicy(e.target.value as Match['noDrawPolicy'])}
                  wrapperClassName="max-w-xs"
                >
                  <option value="refund">Refund all</option>
                  <option value="rollover">Rollover</option>
                </FormSelect>
              )}

              <p className="text-xs text-[var(--text-muted)]">
                Use Completed or Abandoned to add historical matches that are already declared.
              </p>

              <Button type="submit" variant="primary" size="lg" loading={creating}>
                Create Match
              </Button>
            </form>
          </Card>
        </section>

        {/* ── Match list ── */}
        <section>
          <SectionHeader title="All Matches" mb="mb-3" />

          {/* Filter chips */}
          {matches.length > 0 && (
            <div className="flex gap-2 mb-4 flex-wrap">
              {([['all', 'All'], ['ongoing', 'Ongoing'], ['upcoming', 'Upcoming'], ['past', 'Past']] as const).map(([val, label]) => (
                <button
                  key={val}
                  onClick={() => setMatchFilter(val)}
                  className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
                    matchFilter === val
                      ? 'bg-green-500 border-green-500 text-white'
                      : 'bg-transparent border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {(() => {
            const filtered = matches
              .filter((m) => {
                if (matchFilter === 'ongoing') return m.status === 'live';
                if (matchFilter === 'upcoming') return m.status === 'upcoming';
                if (matchFilter === 'past') return m.status === 'completed' || m.status === 'abandoned';
                return true;
              })
              .sort((a, b) => {
                if (matchFilter === 'upcoming') return a.matchDate.toMillis() - b.matchDate.toMillis();
                return 0;
              });

            if (matches.length === 0) return (
              <Card variant="default" className="text-[var(--text-muted)] text-sm text-center">
                No matches yet — create one above
              </Card>
            );

            if (filtered.length === 0) return (
              <Card variant="default" className="text-[var(--text-muted)] text-sm text-center">
                No {matchFilter} matches
              </Card>
            );

            return (
            <div className="space-y-4">
              {filtered.map((match) => {
                const canToggleBetting = match.status === 'upcoming' || match.status === 'live';
                const displayedResult = selectedResult[match.id] ?? (match.result === 'pending' ? '' : match.result);
                return (
                  <Card key={match.id} variant="default" className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className="font-semibold text-[var(--text-primary)]">
                          {match.teamA} <span className="text-[var(--text-muted)]">vs</span> {match.teamB}
                        </span>
                        <Badge variant="format" className="ml-2">{match.format}</Badge>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap justify-end">
                        <Badge variant={matchStatusVariant(match.status)}>
                          {match.status.charAt(0).toUpperCase() + match.status.slice(1)}
                        </Badge>
                        <Button variant="secondary" size="sm" onClick={() => openManageBets(match)}>
                          Manage Bets
                        </Button>
                        <Button variant="secondary" size="sm" onClick={() => openEdit(match)}>
                          Edit
                        </Button>
                        <Button variant="ghost-danger" size="sm" onClick={() => setConfirmDelete(match)}>
                          Delete
                        </Button>
                      </div>
                    </div>

                    <p className="text-xs text-[var(--text-muted)]">{formatMatchDate(match.matchDate)}</p>

                    <div className="flex flex-wrap items-center gap-3 pt-1">
                      {/* Betting toggle: dynamic color (yellow=open, muted=closed), no Button variant — left as raw button */}
                      {canToggleBetting && (
                        <button
                          onClick={() => handleToggleBetting(match)}
                          disabled={togglingBet[match.id]}
                          className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 ${match.bettingOpen
                              ? 'bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30'
                              : 'bg-[var(--bg-input)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
                            }`}
                        >
                          {match.bettingOpen ? 'Close Betting' : 'Open Betting'}
                        </button>
                      )}

                      <span className="text-xs text-[var(--text-muted)] italic">Current result: {getResultLabel(match)}</span>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      {/* Inline result select: px-3 py-1.5 sizing, no label, used in flex row — left as raw select */}
                      <select
                        value={displayedResult}
                        onChange={(e) =>
                          setSelectedResult((p) => ({ ...p, [match.id]: e.target.value as ResultOption }))
                        }
                        className="rounded-lg bg-[var(--bg-input)] border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                      >
                        <option value="" disabled>{match.result === 'pending' ? 'Declare result...' : 'Update result...'}</option>
                        <option value="team_a">{match.teamA} wins</option>
                        <option value="team_b">{match.teamB} wins</option>
                        {match.drawAllowed && <option value="draw">Draw</option>}
                        <option value="abandoned">Abandoned</option>
                      </select>
                      <Button
                        variant="primary"
                        size="sm"
                        disabled={!displayedResult}
                        loading={declaring[match.id]}
                        onClick={() => handleDeclareResult(match)}
                      >
                        {match.status === 'completed' || match.status === 'abandoned'
                          ? 'Update Result'
                          : 'Confirm'}
                      </Button>
                    </div>

                    {(match.status === 'completed' || match.status === 'abandoned') && (
                      <p className="text-xs text-[var(--text-muted)]">
                        Updating a declared match or member bet will roll back old points and settle again using the latest data.
                      </p>
                    )}

                    {/* Betting details */}
                    {(() => {
                      const bets = allGroupBets[match.id] ?? [];
                      const memberNames = members.reduce<Record<string, string>>((acc, m) => {
                        acc[m.userId] = m.displayName; return acc;
                      }, {});
                      const isSettled = match.status === 'completed' || match.status === 'abandoned';
                      if (bets.length === 0) return null;
                      return (
                        <div className="border-t border-[var(--border)] pt-3 space-y-3">
                          <WhoBettedSection match={match} bets={bets} memberNames={memberNames} hasBorder={false} />
                          {!isSettled && <PotentialOutcomesSection match={match} bets={bets} memberNames={memberNames} />}
                          {isSettled && (
                            <PointsSummarySection bets={bets} memberNames={memberNames} resultLabel={getMatchResultLabel(match)} />
                          )}
                        </div>
                      );
                    })()}
                  </Card>
                );
              })}
            </div>
            );
          })()}
        </section>
      </main>
    </div>
  );
}

export default function GroupAdminPage() {
  return (
    <ProtectedRoute>
      <GroupAdminContent />
    </ProtectedRoute>
  );
}
