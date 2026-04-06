'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import toast from 'react-hot-toast';
import ProtectedRoute from '@/components/ProtectedRoute';
import ThemeSwitcher from '@/components/ThemeSwitcher';
import { useAuth } from '@/lib/AuthContext';
import { logoutUser } from '@/lib/auth';
import { getMatches, getAllUsers } from '@/lib/matches';
import type { Match, LeaderboardUser } from '@/lib/matches';

// ── helpers ───────────────────────────────────────────────────────────────────

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
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

function FormatBadge({ format }: { format: Match['format'] }) {
  return (
    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-[var(--bg-input)] text-[var(--text-secondary)]">
      {format}
    </span>
  );
}

function MatchCard({ match }: { match: Match }) {
  const canBet =
    (match.status === 'live' || match.status === 'upcoming') && match.bettingOpen;

  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-[var(--card-padding)] flex flex-col gap-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <span className="font-semibold text-[var(--text-primary)]">
          {match.teamA} <span className="text-[var(--text-muted)]">vs</span> {match.teamB}
        </span>
        <div className="flex items-center gap-2">
          <FormatBadge format={match.format} />
          <StatusBadge status={match.status} />
        </div>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-xs text-[var(--text-muted)]">{formatMatchDate(match.matchDate)}</span>
        {canBet && (
          <Link
            href={`/bet/${match.id}`}
            className="text-xs font-semibold bg-green-500 hover:bg-green-600 text-white px-3 py-1.5 rounded-lg transition-colors"
          >
            Place Bet
          </Link>
        )}
      </div>
    </div>
  );
}

function EmptyCard({ message }: { message: string }) {
  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-[var(--card-padding)] text-[var(--text-muted)] text-sm text-center">
      {message}
    </div>
  );
}

// ── main content ──────────────────────────────────────────────────────────────

function DashboardContent() {
  const router = useRouter();
  const { userProfile } = useAuth();

  const [matches, setMatches] = useState<Match[]>([]);
  const [users, setUsers] = useState<LeaderboardUser[]>([]);

  useEffect(() => {
    getMatches().then(setMatches).catch(() => toast.error('Failed to load matches'));
    getAllUsers().then(setUsers).catch(() => toast.error('Failed to load leaderboard'));
  }, []);

  const today = new Date();

  const todayMatches = matches.filter(
    (m) =>
      m.status === 'live' ||
      (m.status === 'upcoming' && isSameDay(m.matchDate.toDate(), today))
  );

  const upcomingMatches = matches.filter(
    (m) =>
      m.status === 'upcoming' &&
      m.matchDate.toDate() > today &&
      !isSameDay(m.matchDate.toDate(), today)
  );

  const pastMatches = matches.filter(
    (m) => m.status === 'completed' || m.status === 'abandoned'
  );

  async function handleLogout() {
    try {
      await logoutUser();
      router.replace('/login');
    } catch {
      toast.error('Failed to sign out');
    }
  }

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)]">
      {/* Navbar */}
      <header className="bg-[var(--bg-card)] border-b border-[var(--border)] px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
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

      {/* Content */}
      <main className="max-w-5xl mx-auto px-6 py-8 space-y-8">
        {/* Live & Today */}
        <section>
          <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-3">
            Live &amp; Today&apos;s Matches
          </h2>
          {todayMatches.length === 0 ? (
            <EmptyCard message="No matches today" />
          ) : (
            <div className="space-y-3">
              {todayMatches.map((m) => <MatchCard key={m.id} match={m} />)}
            </div>
          )}
        </section>

        {/* Upcoming */}
        <section>
          <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-3">Upcoming Matches</h2>
          {upcomingMatches.length === 0 ? (
            <EmptyCard message="No upcoming matches" />
          ) : (
            <div className="space-y-3">
              {upcomingMatches.map((m) => <MatchCard key={m.id} match={m} />)}
            </div>
          )}
        </section>

        {/* Past */}
        <section>
          <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-3">Past Matches</h2>
          {pastMatches.length === 0 ? (
            <EmptyCard message="No past matches" />
          ) : (
            <div className="space-y-3">
              {pastMatches.map((m) => <MatchCard key={m.id} match={m} />)}
            </div>
          )}
        </section>

        {/* Leaderboard */}
        <section>
          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-[var(--card-padding)]">
            <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-4">Leaderboard</h2>
            {users.length === 0 ? (
              <p className="text-[var(--text-muted)] text-sm text-center">No data</p>
            ) : (
              <ol className="space-y-2">
                {users.map((u, i) => {
                  const isMe = u.uid === userProfile?.uid;
                  return (
                    <li
                      key={u.uid}
                      className={`flex items-center justify-between py-2 px-3 rounded-lg ${
                        isMe
                          ? 'bg-green-500/10 border border-green-500/30'
                          : 'bg-[var(--bg-input)]'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-[var(--text-muted)] text-sm w-5 text-right">{i + 1}</span>
                        <div
                          className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-semibold shrink-0"
                          style={{ backgroundColor: u.avatarColor }}
                        >
                          {u.displayName.charAt(0).toUpperCase()}
                        </div>
                        <span className="text-sm text-[var(--text-primary)]">{u.displayName}</span>
                        {isMe && (
                          <span className="text-xs text-green-500 font-medium">(you)</span>
                        )}
                      </div>
                      <span className="text-sm font-semibold text-green-400">
                        {u.totalPoints} pts
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <ProtectedRoute>
      <DashboardContent />
    </ProtectedRoute>
  );
}
