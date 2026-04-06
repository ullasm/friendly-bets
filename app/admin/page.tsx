'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import {
  collection,
  doc,
  addDoc,
  getDocs,
  updateDoc,
  query,
  where,
  increment,
  Timestamp,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/AuthContext';
import { logoutUser } from '@/lib/auth';
import { getMatches } from '@/lib/matches';
import type { Match, Bet } from '@/lib/matches';
import ProtectedRoute from '@/components/ProtectedRoute';
import ThemeSwitcher from '@/components/ThemeSwitcher';

// ── types ─────────────────────────────────────────────────────────────────────

type ResultOption = 'team_a' | 'team_b' | 'draw' | 'abandoned';

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
    abandoned: 'bg-red-500/20 text-red-400',
  };
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${styles[status]}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

const INPUT_CLASS =
  'w-full rounded-lg bg-[var(--bg-input)] border border-[var(--border)] px-4 py-2.5 text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent';

// ── points settlement ─────────────────────────────────────────────────────────

async function settleMatch(match: Match, result: ResultOption) {
  const betsSnap = await getDocs(
    query(collection(db, 'bets'), where('matchId', '==', match.id))
  );
  const bets = betsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Bet));

  const matchRef = doc(db, 'matches', match.id);

  if (result === 'abandoned') {
    await Promise.all(
      bets.map((b) =>
        updateDoc(doc(db, 'bets', b.id), { status: 'refunded', pointsDelta: 0 })
      )
    );
    await updateDoc(matchRef, {
      status: 'abandoned',
      result: 'abandoned',
      bettingOpen: false,
      bettingClosedAt: Timestamp.now(),
    });
    return;
  }

  if (result === 'draw' && match.drawAllowed) {
    const drawBets = bets.filter((b) => b.pickedOutcome === 'draw');
    const otherBets = bets.filter((b) => b.pickedOutcome !== 'draw');

    if (drawBets.length === 0) {
      if (match.noDrawPolicy === 'refund') {
        await Promise.all(
          bets.map((b) =>
            updateDoc(doc(db, 'bets', b.id), { status: 'refunded', pointsDelta: 0 })
          )
        );
      }
      await updateDoc(matchRef, {
        status: 'completed',
        result: 'draw',
        bettingOpen: false,
        bettingClosedAt: Timestamp.now(),
      });
      return;
    }

    const losersStake = otherBets.reduce((s, b) => s + b.stake, 0);
    const winnerShare = drawBets.length > 0 ? Math.floor(losersStake / drawBets.length) : 0;

    await Promise.all([
      ...drawBets.map((b) =>
        updateDoc(doc(db, 'bets', b.id), { status: 'won', pointsDelta: winnerShare }).then(() =>
          updateDoc(doc(db, 'users', b.userId), { totalPoints: increment(winnerShare) })
        )
      ),
      ...otherBets.map((b) =>
        updateDoc(doc(db, 'bets', b.id), { status: 'lost', pointsDelta: -b.stake }).then(() =>
          updateDoc(doc(db, 'users', b.userId), { totalPoints: increment(-b.stake) })
        )
      ),
    ]);

    await updateDoc(matchRef, {
      status: 'completed',
      result: 'draw',
      bettingOpen: false,
      bettingClosedAt: Timestamp.now(),
    });
    return;
  }

  const winnerBets = bets.filter((b) => b.pickedOutcome === result);
  const loserBets = bets.filter((b) => b.pickedOutcome !== result);
  const losersStake = loserBets.reduce((s, b) => s + b.stake, 0);
  const winnerShare = winnerBets.length > 0 ? Math.floor(losersStake / winnerBets.length) : 0;

  await Promise.all([
    ...winnerBets.map((b) =>
      updateDoc(doc(db, 'bets', b.id), { status: 'won', pointsDelta: winnerShare }).then(() =>
        updateDoc(doc(db, 'users', b.userId), { totalPoints: increment(winnerShare) })
      )
    ),
    ...loserBets.map((b) =>
      updateDoc(doc(db, 'bets', b.id), { status: 'lost', pointsDelta: -b.stake }).then(() =>
        updateDoc(doc(db, 'users', b.userId), { totalPoints: increment(-b.stake) })
      )
    ),
  ]);

  await updateDoc(matchRef, {
    status: 'completed',
    result,
    bettingOpen: false,
    bettingClosedAt: Timestamp.now(),
  });
}

// ── admin content ─────────────────────────────────────────────────────────────

function AdminContent() {
  const router = useRouter();
  const { userProfile } = useAuth();

  const [teamA, setTeamA] = useState('');
  const [teamB, setTeamB] = useState('');
  const [format, setFormat] = useState<Match['format']>('T20');
  const [matchDate, setMatchDate] = useState('');
  const [drawAllowed, setDrawAllowed] = useState(false);
  const [noDrawPolicy, setNoDrawPolicy] = useState<Match['noDrawPolicy']>('refund');
  const [bettingOpen, setBettingOpen] = useState(true);
  const [creating, setCreating] = useState(false);

  const [matches, setMatches] = useState<Match[]>([]);
  const [selectedResult, setSelectedResult] = useState<Record<string, ResultOption>>({});
  const [declaring, setDeclaring] = useState<Record<string, boolean>>({});
  const [togglingBet, setTogglingBet] = useState<Record<string, boolean>>({});

  useEffect(() => {
    getMatches().then(setMatches).catch(() => toast.error('Failed to load matches'));
  }, []);

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

  async function handleCreateMatch(e: React.FormEvent) {
    e.preventDefault();
    if (!matchDate) {
      toast.error('Please set a match date');
      return;
    }
    setCreating(true);
    try {
      const ts = Timestamp.fromDate(new Date(matchDate));
      await addDoc(collection(db, 'matches'), {
        teamA: teamA.trim(),
        teamB: teamB.trim(),
        format,
        drawAllowed,
        noDrawPolicy: drawAllowed ? noDrawPolicy : 'refund',
        matchDate: ts,
        status: 'upcoming',
        result: 'pending',
        bettingOpen,
        bettingClosedAt: null,
        cricApiMatchId: null,
      });
      toast.success('Match created!');
      setTeamA(''); setTeamB(''); setFormat('T20'); setMatchDate('');
      setDrawAllowed(false); setBettingOpen(true);
      const updated = await getMatches();
      setMatches(updated);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create match');
    } finally {
      setCreating(false);
    }
  }

  async function handleToggleBetting(match: Match) {
    setTogglingBet((prev) => ({ ...prev, [match.id]: true }));
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
      toast.error('Failed to update betting status');
    } finally {
      setTogglingBet((prev) => ({ ...prev, [match.id]: false }));
    }
  }

  async function handleDeclareResult(match: Match) {
    const result = selectedResult[match.id];
    if (!result) return;
    setDeclaring((prev) => ({ ...prev, [match.id]: true }));
    try {
      await settleMatch(match, result);
      toast.success('Result declared and points settled!');
      const updated = await getMatches();
      setMatches(updated);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to declare result');
    } finally {
      setDeclaring((prev) => ({ ...prev, [match.id]: false }));
    }
  }

  if (userProfile?.role !== 'admin') {
    return (
      <div className="min-h-screen bg-[var(--bg-primary)] flex items-center justify-center">
        <p className="text-red-400 text-lg font-semibold">Access denied</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)]">
      {/* Navbar */}
      <header className="bg-[var(--bg-card)] border-b border-[var(--border)] px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <h1 className="text-xl font-bold text-green-500">🏆 WhoWin</h1>
          <div className="flex items-center gap-3">
            <ThemeSwitcher />
            {userProfile && (
              <div className="flex items-center gap-2">
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-semibold shrink-0"
                  style={{ backgroundColor: userProfile.avatarColor }}
                >
                  {userProfile.displayName.charAt(0).toUpperCase()}
                </div>
                <span className="text-sm text-[var(--text-secondary)]">{userProfile.displayName}</span>
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
        {/* ── Create Match form ── */}
        <section>
          <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-4">Create Match</h2>
          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-[var(--card-padding)]">
            <form onSubmit={handleCreateMatch} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">Team A</label>
                  <input
                    type="text"
                    required
                    value={teamA}
                    onChange={(e) => setTeamA(e.target.value)}
                    placeholder="e.g. India"
                    className={INPUT_CLASS}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">Team B</label>
                  <input
                    type="text"
                    required
                    value={teamB}
                    onChange={(e) => setTeamB(e.target.value)}
                    placeholder="e.g. Australia"
                    className={INPUT_CLASS}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">Format</label>
                  <select
                    value={format}
                    onChange={(e) => setFormat(e.target.value as Match['format'])}
                    className={INPUT_CLASS}
                  >
                    <option value="T20">T20</option>
                    <option value="ODI">ODI</option>
                    <option value="Test">Test</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">Match Date &amp; Time</label>
                  <input
                    type="datetime-local"
                    required
                    value={matchDate}
                    onChange={(e) => setMatchDate(e.target.value)}
                    className={INPUT_CLASS}
                  />
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
                    {format === 'Test' && (
                      <span className="ml-1 text-xs text-[var(--text-muted)]">(auto for Test)</span>
                    )}
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
                  <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
                    No Draw Policy
                  </label>
                  <select
                    value={noDrawPolicy}
                    onChange={(e) => setNoDrawPolicy(e.target.value as Match['noDrawPolicy'])}
                    className={INPUT_CLASS}
                  >
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
              No matches yet
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
                              setSelectedResult((prev) => ({
                                ...prev,
                                [match.id]: e.target.value as ResultOption,
                              }))
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
                        <span className="text-xs text-[var(--text-muted)] italic">
                          Result: {match.result}
                        </span>
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

export default function AdminPage() {
  return (
    <ProtectedRoute>
      <AdminContent />
    </ProtectedRoute>
  );
}
