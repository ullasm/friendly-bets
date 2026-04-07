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
import { getGroupById, getUserGroupMember } from '@/lib/groups';
import type { Group } from '@/lib/groups';
import { getMatches, createMatch, settleMatch } from '@/lib/matches';
import type { Match } from '@/lib/matches';

type ResultOption = 'team_a' | 'team_b' | 'draw' | 'abandoned';

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

  // form state
  const [teamA, setTeamA] = useState('');
  const [teamB, setTeamB] = useState('');
  const [format, setFormat] = useState<Match['format']>('T20');
  const [matchDate, setMatchDate] = useState('');
  const [drawAllowed, setDrawAllowed] = useState(false);
  const [noDrawPolicy, setNoDrawPolicy] = useState<Match['noDrawPolicy']>('refund');
  const [bettingOpen, setBettingOpen] = useState(true);
  const [creating, setCreating] = useState(false);

  // matches state
  const [matches, setMatches] = useState<Match[]>([]);
  const [selectedResult, setSelectedResult] = useState<Record<string, ResultOption>>({});
  const [declaring, setDeclaring] = useState<Record<string, boolean>>({});
  const [togglingBet, setTogglingBet] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!user) return;
    Promise.all([
      getUserGroupMember(groupId, user.uid),
      getGroupById(groupId),
      getMatches(groupId),
    ]).then(([member, g, mats]) => {
      setIsAdmin(member?.role === 'admin');
      setGroup(g);
      setMatches(mats);
    }).catch(() => {
      toast.error('Failed to load admin data');
      setIsAdmin(false);
    });
  }, [user, groupId]);

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

  async function handleCreateMatch(e: React.FormEvent) {
    e.preventDefault();
    if (!matchDate) { toast.error('Please set a match date'); return; }
    setCreating(true);
    try {
      await createMatch(groupId, {
        teamA: teamA.trim(),
        teamB: teamB.trim(),
        format,
        drawAllowed,
        noDrawPolicy: drawAllowed ? noDrawPolicy : 'refund',
        matchDate: Timestamp.fromDate(new Date(matchDate)),
        status: 'upcoming',
        result: 'pending',
        bettingOpen,
        bettingClosedAt: null,
        cricApiMatchId: null,
      });
      toast.success('Match created!');
      setTeamA(''); setTeamB(''); setFormat('T20');
      setMatchDate(''); setDrawAllowed(false); setBettingOpen(true);
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

  async function handleDeclareResult(match: Match) {
    const result = selectedResult[match.id];
    if (!result) return;
    setDeclaring((p) => ({ ...p, [match.id]: true }));
    try {
      await settleMatch(match.id, groupId, result, match.noDrawPolicy);
      toast.success('Result declared and points settled!');
      await refreshMatches();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to declare result');
    } finally {
      setDeclaring((p) => ({ ...p, [match.id]: false }));
    }
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
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={bettingOpen}
                    onChange={(e) => setBettingOpen(e.target.checked)}
                    className="w-4 h-4 accent-green-500"
                  />
                  <span className="text-sm text-[var(--text-secondary)]">Betting Open</span>
                </label>
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
                const canDeclare = match.status === 'upcoming' || match.status === 'live';
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
                      </div>
                      <StatusBadge status={match.status} />
                    </div>

                    <p className="text-xs text-[var(--text-muted)]">{formatMatchDate(match.matchDate)}</p>

                    <div className="flex flex-wrap items-center gap-3 pt-1">
                      {canDeclare && (
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

                      {canDeclare && (
                        <div className="flex items-center gap-2 flex-wrap">
                          <select
                            value={selectedResult[match.id] ?? ''}
                            onChange={(e) =>
                              setSelectedResult((p) => ({ ...p, [match.id]: e.target.value as ResultOption }))
                            }
                            className="rounded-lg bg-[var(--bg-input)] border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                          >
                            <option value="" disabled>Declare result…</option>
                            <option value="team_a">{match.teamA} wins</option>
                            <option value="team_b">{match.teamB} wins</option>
                            {match.drawAllowed && <option value="draw">Draw</option>}
                            <option value="abandoned">Abandoned</option>
                          </select>
                          <button
                            onClick={() => handleDeclareResult(match)}
                            disabled={!selectedResult[match.id] || declaring[match.id]}
                            className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-green-500 hover:bg-green-600 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
                          >
                            {declaring[match.id] ? 'Settling…' : 'Confirm'}
                          </button>
                        </div>
                      )}

                      {!canDeclare && (
                        <span className="text-xs text-[var(--text-muted)] italic">Result: {match.result}</span>
                      )}
                    </div>
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
