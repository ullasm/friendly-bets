'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { doc, updateDoc, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import ProtectedRoute from '@/components/ProtectedRoute';
import ThemeSwitcher from '@/components/ThemeSwitcher';
import { useAuth } from '@/lib/AuthContext';
import { logoutUser } from '@/lib/auth';
import { getGroupById, getUserGroupMember, getGroupMembers } from '@/lib/groups';
import type { Group, GroupMember } from '@/lib/groups';
import { getMatches, createMatch, declareMatchResult, updateMatch, deleteMatch, getGroupBetsForMatch, adminUpsertBetForMatch, adminClearBetForMatch } from '@/lib/matches';
import type { Match, Bet } from '@/lib/matches';
import { getCricketMatches } from '@/lib/cricapi';
import type { CricMatch } from '@/lib/cricapi';

type ResultOption = 'team_a' | 'team_b' | 'draw' | 'abandoned';
type BetPickOption = 'team_a' | 'team_b' | 'draw';
type MemberBetDraft = { pickedOutcome: '' | BetPickOption; stake: string };

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

function parseTeams(matchName: string): { teamA: string; teamB: string } {
  const parts = matchName.split(/ vs | v /i);
  if (parts.length >= 2) {
    return { teamA: parts[0].trim(), teamB: parts[1].trim() };
  }
  return { teamA: matchName.trim(), teamB: 'TBD' };
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

function StatusBadge({ status }: { status: Match['status'] }) {
  const styles: Record<Match['status'], string> = {
    live: 'bg-green-500/20 text-green-400',
    upcoming: 'bg-yellow-500/20 text-yellow-400',
    completed: 'bg-slate-600/40 text-[var(--text-muted)]',
    abandoned: 'bg-red-500/20 text-red-400',
  };
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${styles[status]}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
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

  // cricapi state
  const [cricMatches, setCricMatches] = useState<CricMatch[]>([]);
  const [cricLoading, setCricLoading] = useState(false);
  const [cricFetched, setCricFetched] = useState(false);
  const [addedIds, setAddedIds] = useState<Record<string, 'adding' | 'added'>>({});

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    Promise.all([
      getUserGroupMember(groupId, user.uid),
      getGroupById(groupId),
      getMatches(groupId),
      getGroupMembers(groupId),
    ]).then(([member, g, mats, loadedMembers]) => {
      if (cancelled) return;
      setIsAdmin(member?.role === 'admin');
      setGroup(g);
      setMatches(mats);
      setMembers(loadedMembers);
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

  async function handleLogout() {
    try {
      await logoutUser();
      router.replace('/login');
    } catch {
      toast.error('Failed to sign out');
    }
  }

  async function refreshMatches() {
    const mats = await getMatches(groupId);
    setMatches(mats);
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
          stake: existingBet ? String(existingBet.stake) : '',
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

  async function handleFetchCricMatches() {
    setCricLoading(true);
    setCricFetched(true);
    try {
      const mats = await getCricketMatches();
      // Live matches first, then upcoming sorted by date ascending
      mats.sort((a, b) => {
        if (a.isLive !== b.isLive) return a.isLive ? -1 : 1;
        const da = new Date(a.dateTimeLocal || a.date).getTime();
        const db = new Date(b.dateTimeLocal || b.date).getTime();
        if (isNaN(da) && isNaN(db)) return 0;
        if (isNaN(da)) return 1;
        if (isNaN(db)) return -1;
        return da - db;
      });
      setCricMatches(mats);
    } catch {
      setCricMatches([]);
    } finally {
      setCricLoading(false);
    }
  }

  async function handleAddFromCricApi(cm: CricMatch) {
    const { teamA, teamB } = parseTeams(cm.name);
    const rawType = cm.matchType.toLowerCase();
    const format: Match['format'] =
      rawType === 'odi' ? 'ODI' : rawType === 'test' ? 'Test' : 'T20';
    const drawAllowed = format === 'Test';
    const matchDate = Timestamp.fromDate(new Date(cm.dateTimeLocal || cm.date));
    const status: Match['status'] = cm.isLive ? 'live' : 'upcoming';

    setAddedIds((prev) => ({ ...prev, [cm.id]: 'adding' }));
    try {
      await createMatch(groupId, {
        teamA,
        teamB,
        format,
        drawAllowed,
        noDrawPolicy: 'refund',
        matchDate,
        status,
        result: 'pending',
        bettingOpen: true,
        bettingClosedAt: null,
        cricApiMatchId: cm.id,
      });
      toast.success('Match added!');
      setAddedIds((prev) => ({ ...prev, [cm.id]: 'added' }));
      await refreshMatches();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add match');
      setAddedIds((prev) => { const next = { ...prev }; delete next[cm.id]; return next; });
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
    } catch {
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
      <div className="min-h-screen bg-[var(--bg-primary)] flex flex-col items-center justify-center gap-4 px-4">
        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-8 max-w-sm w-full text-center space-y-4">
          <p className="text-red-400 font-semibold">{loadError}</p>
          <button
            onClick={() => { setLoadError(null); setRetryKey((k) => k + 1); }}
            className="inline-block bg-green-500 hover:bg-green-600 text-white font-semibold px-5 py-2 rounded-lg transition-colors text-sm"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // ── loading ──────────────────────────────────────────────────────────────
  if (isAdmin === undefined) {
    return (
      <div className="min-h-screen bg-[var(--bg-primary)] flex items-center justify-center">
        <svg className="animate-spin h-10 w-10 text-green-500" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
        </svg>
      </div>
    );
  }

  // ── access denied ────────────────────────────────────────────────────────
  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-[var(--bg-primary)] flex flex-col items-center justify-center gap-4 px-4">
        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-8 max-w-sm w-full text-center space-y-4">
          <p className="text-red-400 font-semibold">Access denied</p>
          <p className="text-sm text-[var(--text-secondary)]">You need admin privileges to view this page.</p>
          <Link
            href={`/groups/${groupId}`}
            className="inline-block bg-green-500 hover:bg-green-600 text-white font-semibold px-5 py-2 rounded-lg transition-colors text-sm"
          >
            Back to Group
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)]">

      {managingBetsFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 py-6">
          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-6 max-w-4xl w-full max-h-[90vh] overflow-y-auto space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="font-semibold text-[var(--text-primary)]">Manage Member Bets</h3>
                <p className="text-sm text-[var(--text-secondary)] mt-1">
                  {managingBetsFor.teamA} vs {managingBetsFor.teamB} · {formatMatchDate(managingBetsFor.matchDate)}
                </p>
                <p className="text-xs text-[var(--text-muted)] mt-1">
                  Add, update, or clear any member bet. Finished matches will automatically re-settle points after each change.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setManagingBetsFor(null)}
                className="shrink-0 rounded-lg border border-[var(--border)] bg-[var(--bg-input)] hover:bg-[var(--bg-hover)] px-3 py-2 text-sm text-[var(--text-primary)] transition-colors"
              >
                Close
              </button>
            </div>

            {loadingManageBets ? (
              <div className="py-10 text-center text-sm text-[var(--text-muted)]">Loading member bets…</div>
            ) : members.length === 0 ? (
              <div className="py-10 text-center text-sm text-[var(--text-muted)]">No group members found.</div>
            ) : (
              <div className="space-y-3">
                {members.map((member) => {
                  const currentBet = matchBets[member.userId];
                  const draft = betDrafts[member.userId] ?? { pickedOutcome: '', stake: '' };
                  const isSaving = savingMemberBets[member.userId];
                  return (
                    <div key={member.userId} className="rounded-xl border border-[var(--border)] bg-[var(--bg-input)] p-4 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div
                            className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-semibold shrink-0"
                            style={{ backgroundColor: member.avatarColor }}
                          >
                            {member.displayName.charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium text-[var(--text-primary)] truncate">{member.displayName}</span>
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
                        <button
                          type="button"
                          onClick={() => handleSaveMemberBet(member.userId)}
                          disabled={isSaving}
                          className="rounded-lg bg-green-500 hover:bg-green-600 disabled:opacity-60 disabled:cursor-not-allowed px-4 py-2.5 text-sm font-semibold text-white transition-colors"
                        >
                          {isSaving ? 'Saving…' : currentBet ? 'Update Bet' : 'Add Bet'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleClearMemberBet(member.userId)}
                          disabled={isSaving || !currentBet}
                          className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2.5 text-sm font-medium text-[var(--text-primary)] transition-colors"
                        >
                          Clear Bet
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Edit modal ── */}
      {editingMatch && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-6 max-w-lg w-full space-y-4">
            <h3 className="font-semibold text-[var(--text-primary)]">Edit Match</h3>
            <form onSubmit={handleSaveEdit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">Team A</label>
                  <input type="text" required value={editTeamA} onChange={(e) => setEditTeamA(e.target.value)} className={INPUT_CLASS} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">Team B</label>
                  <input type="text" required value={editTeamB} onChange={(e) => setEditTeamB(e.target.value)} className={INPUT_CLASS} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">Format</label>
                  <select value={editFormat} onChange={(e) => { const f = e.target.value as Match['format']; setEditFormat(f); if (f === 'Test') setEditDrawAllowed(true); else setEditDrawAllowed(false); }} className={INPUT_CLASS}>
                    <option value="T20">T20</option>
                    <option value="ODI">ODI</option>
                    <option value="Test">Test</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">Match Date &amp; Time</label>
                  <input type="datetime-local" required value={editMatchDate} onChange={(e) => setEditMatchDate(e.target.value)} className={INPUT_CLASS} />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-6">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input type="checkbox" checked={editDrawAllowed} disabled={editFormat === 'Test'} onChange={(e) => setEditDrawAllowed(e.target.checked)} className="w-4 h-4 accent-green-500" />
                  <span className="text-sm text-[var(--text-secondary)]">Allow Draw{editFormat === 'Test' && <span className="ml-1 text-xs text-[var(--text-muted)]">(auto for Test)</span>}</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input type="checkbox" checked={editBettingOpen} onChange={(e) => setEditBettingOpen(e.target.checked)} className="w-4 h-4 accent-green-500" />
                  <span className="text-sm text-[var(--text-secondary)]">Betting Open</span>
                </label>
              </div>
              {editDrawAllowed && (
                <div className="max-w-xs">
                  <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">No Draw Policy</label>
                  <select value={editNoDrawPolicy} onChange={(e) => setEditNoDrawPolicy(e.target.value as Match['noDrawPolicy'])} className={INPUT_CLASS}>
                    <option value="refund">Refund all</option>
                    <option value="rollover">Rollover</option>
                  </select>
                </div>
              )}
              <div className="flex gap-3 pt-1">
                <button type="submit" disabled={saving} className="flex-1 rounded-lg bg-green-500 hover:bg-green-600 disabled:opacity-60 text-white text-sm font-semibold py-2.5 transition-colors">
                  {saving ? 'Saving…' : 'Save Changes'}
                </button>
                <button type="button" onClick={() => setEditingMatch(null)} className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg-input)] hover:bg-[var(--bg-hover)] text-[var(--text-primary)] text-sm font-medium py-2.5 transition-colors">
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Delete confirmation modal ── */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-6 max-w-sm w-full space-y-4">
            <h3 className="font-semibold text-[var(--text-primary)]">Delete match?</h3>
            <p className="text-sm text-[var(--text-secondary)]">
              Are you sure you want to delete{' '}
              <span className="font-medium text-[var(--text-primary)]">{confirmDelete.teamA} vs {confirmDelete.teamB}</span>?
              This cannot be undone.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmDelete(null)} className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg-input)] hover:bg-[var(--bg-hover)] text-[var(--text-primary)] text-sm font-medium py-2 transition-colors">
                Cancel
              </button>
              <button onClick={handleDeleteConfirmed} disabled={deleting} className="flex-1 rounded-lg bg-red-500 hover:bg-red-600 disabled:opacity-60 text-white text-sm font-semibold py-2 transition-colors">
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Navbar */}
      <header className="bg-[var(--bg-card)] border-b border-[var(--border)] px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Link
              href={`/groups/${groupId}`}
              className="shrink-0 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <div className="min-w-0">
              <span className="text-base font-bold text-green-500 block">🏆 WhoWins</span>
              {group && (
                <span className="text-xs text-[var(--text-secondary)] truncate block">{group.name} · Admin</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <ThemeSwitcher />
            {userProfile && (
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-semibold shrink-0"
                style={{ backgroundColor: userProfile.avatarColor }}
              >
                {userProfile.displayName.charAt(0).toUpperCase()}
              </div>
            )}
            <button
              onClick={handleLogout}
              className="text-sm text-[var(--text-secondary)] hover:text-red-400 transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8 space-y-10">
        {/* ── CricAPI Import ── */}
        <section>
          <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-4">Import Matches from CricAPI</h2>
          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-[var(--card-padding)] space-y-4">
            <button
              onClick={handleFetchCricMatches}
              disabled={cricLoading}
              className="flex items-center gap-2 rounded-lg bg-[var(--bg-input)] hover:bg-[var(--bg-hover)] border border-[var(--border)] text-[var(--text-primary)] font-semibold text-sm px-4 py-2.5 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {cricLoading ? (
                <>
                  <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  Fetching…
                </>
              ) : (
                <>
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Fetch Live &amp; Upcoming Matches
                </>
              )}
            </button>

            {cricFetched && !cricLoading && (
              cricMatches.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)] text-center py-2">
                  No matches available from CricAPI right now
                </p>
              ) : (
                <div className="space-y-3">
                  {cricMatches.map((cm) => {
                    const state = addedIds[cm.id];
                    const rawType = cm.matchType.toLowerCase();
                    const typeLabel = rawType === 'odi' ? 'ODI' : rawType === 'test' ? 'Test' : 'T20';
                    return (
                      <div
                        key={cm.id}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-[var(--bg-input)] border border-[var(--border)] px-4 py-3"
                      >
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium text-sm text-[var(--text-primary)]">
                              {cm.name}
                            </span>
                            {cm.isLive && (
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
                            {formatCricDate(cm.dateTimeLocal || cm.date)}
                          </p>
                        </div>
                        <button
                          onClick={() => handleAddFromCricApi(cm)}
                          disabled={!!state}
                          className={`shrink-0 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors disabled:cursor-not-allowed ${
                            state === 'added'
                              ? 'bg-green-500/20 text-green-400 disabled:opacity-100'
                              : state === 'adding'
                              ? 'bg-green-500/20 text-green-400 opacity-60'
                              : 'bg-green-500 hover:bg-green-600 text-white'
                          }`}
                        >
                          {state === 'added' ? 'Added ✓' : state === 'adding' ? 'Adding…' : 'Add to Group'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )
            )}
          </div>
        </section>

        {/* ── Create Match ── */}
        <section>
          <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-4">Create Match</h2>
          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-[var(--card-padding)]">
            <form onSubmit={handleCreateMatch} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">Team A</label>
                  <input type="text" required value={teamA} onChange={(e) => setTeamA(e.target.value)} placeholder="e.g. India" className={INPUT_CLASS} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">Team B</label>
                  <input type="text" required value={teamB} onChange={(e) => setTeamB(e.target.value)} placeholder="e.g. Australia" className={INPUT_CLASS} />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">Format</label>
                  <select value={format} onChange={(e) => setFormat(e.target.value as Match['format'])} className={INPUT_CLASS}>
                    <option value="T20">T20</option>
                    <option value="ODI">ODI</option>
                    <option value="Test">Test</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">Match Date &amp; Time</label>
                  <input type="datetime-local" required value={matchDate} onChange={(e) => setMatchDate(e.target.value)} className={INPUT_CLASS} />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">Initial Status</label>
                  <select value={creationStatus} onChange={(e) => setCreationStatus(e.target.value as Match['status'])} className={INPUT_CLASS}>
                    <option value="upcoming">Upcoming</option>
                    <option value="live">Live</option>
                    <option value="completed">Completed</option>
                    <option value="abandoned">Abandoned</option>
                  </select>
                </div>
                {creationStatus === 'completed' && (
                  <div>
                    <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">Declared Result</label>
                    <select value={creationResult} onChange={(e) => setCreationResult(e.target.value as Match['result'])} className={INPUT_CLASS}>
                      <option value="pending" disabled>Select result...</option>
                      <option value="team_a">{teamA.trim() || 'Team A'} wins</option>
                      <option value="team_b">{teamB.trim() || 'Team B'} wins</option>
                      {drawAllowed && <option value="draw">Draw</option>}
                    </select>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-6">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={drawAllowed}
                    disabled={format === 'Test'}
                    onChange={(e) => setDrawAllowed(e.target.checked)}
                    className="w-4 h-4 accent-green-500"
                  />
                  <span className="text-sm text-[var(--text-secondary)]">
                    Allow Draw
                    {format === 'Test' && <span className="ml-1 text-xs text-[var(--text-muted)]">(auto for Test)</span>}
                  </span>
                </label>
                {(creationStatus === 'upcoming' || creationStatus === 'live') && (
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={bettingOpen}
                      onChange={(e) => setBettingOpen(e.target.checked)}
                      className="w-4 h-4 accent-green-500"
                    />
                    <span className="text-sm text-[var(--text-secondary)]">Betting Open</span>
                  </label>
                )}
              </div>

              {drawAllowed && (
                <div className="max-w-xs">
                  <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">No Draw Policy</label>
                  <select value={noDrawPolicy} onChange={(e) => setNoDrawPolicy(e.target.value as Match['noDrawPolicy'])} className={INPUT_CLASS}>
                    <option value="refund">Refund all</option>
                    <option value="rollover">Rollover</option>
                  </select>
                </div>
              )}

              <p className="text-xs text-[var(--text-muted)]">
                Use Completed or Abandoned to add historical matches that are already declared.
              </p>

              <button
                type="submit"
                disabled={creating}
                className="flex items-center gap-2 rounded-lg bg-green-500 hover:bg-green-600 disabled:opacity-60 disabled:cursor-not-allowed px-5 py-2.5 font-semibold text-white transition-colors"
              >
                {creating ? (
                  <>
                    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                    Creating…
                  </>
                ) : (
                  'Create Match'
                )}
              </button>
            </form>
          </div>
        </section>

        {/* ── Match list ── */}
        <section>
          <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-4">All Matches</h2>
          {matches.length === 0 ? (
            <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-[var(--card-padding)] text-[var(--text-muted)] text-sm text-center">
              No matches yet — create one above
            </div>
          ) : (
            <div className="space-y-4">
              {matches.map((match) => {
                const canToggleBetting = match.status === 'upcoming' || match.status === 'live';
                const displayedResult = selectedResult[match.id] ?? (match.result === 'pending' ? '' : match.result);
                return (
                  <div key={match.id} className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-[var(--card-padding)] space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className="font-semibold text-[var(--text-primary)]">
                          {match.teamA} <span className="text-[var(--text-muted)]">vs</span> {match.teamB}
                        </span>
                        <span className="ml-2 text-xs font-medium px-2 py-0.5 rounded-full bg-[var(--bg-input)] text-[var(--text-secondary)]">
                          {match.format}
                        </span>
                      </div>                      <div className="flex items-center gap-2 flex-wrap justify-end">
                        <StatusBadge status={match.status} />
                        <button
                          onClick={() => openManageBets(match)}
                          className="text-xs font-medium px-2.5 py-1 rounded-lg bg-[var(--bg-input)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border)] transition-colors"
                        >
                          Manage Bets
                        </button>
                        <button
                          onClick={() => openEdit(match)}
                          className="text-xs font-medium px-2.5 py-1 rounded-lg bg-[var(--bg-input)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border)] transition-colors"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => setConfirmDelete(match)}
                          className="text-xs font-medium px-2.5 py-1 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 transition-colors"
                        >
                          Delete
                        </button>
                      </div>
                    </div>

                    <p className="text-xs text-[var(--text-muted)]">{formatMatchDate(match.matchDate)}</p>

                    <div className="flex flex-wrap items-center gap-3 pt-1">
                      {canToggleBetting && (
                        <button
                          onClick={() => handleToggleBetting(match)}
                          disabled={togglingBet[match.id]}
                          className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 ${
                            match.bettingOpen
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
                      <button
                        onClick={() => handleDeclareResult(match)}
                        disabled={!displayedResult || declaring[match.id]}
                        className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-green-500 hover:bg-green-600 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
                      >
                        {declaring[match.id]
                          ? 'Saving...'
                          : match.status === 'completed' || match.status === 'abandoned'
                          ? 'Update Result'
                          : 'Confirm'}
                      </button>
                    </div>

                    {(match.status === 'completed' || match.status === 'abandoned') && (
                      <p className="text-xs text-[var(--text-muted)]">
                        Updating a declared match or member bet will roll back old points and settle again using the latest data.
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
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

































