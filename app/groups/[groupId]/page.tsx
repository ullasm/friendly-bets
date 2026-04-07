'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import toast from 'react-hot-toast';
import ProtectedRoute from '@/components/ProtectedRoute';
import ThemeSwitcher from '@/components/ThemeSwitcher';
import { useAuth } from '@/lib/AuthContext';
import { logoutUser } from '@/lib/auth';
import { getGroupById, getUserGroupMember, getGroupMembers } from '@/lib/groups';
import type { Group, GroupMember } from '@/lib/groups';
import { getMatches } from '@/lib/matches';
import type { Match } from '@/lib/matches';
import { copyText, getInviteLink } from '@/lib/share';

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

function MatchCard({ match, groupId }: { match: Match; groupId: string }) {
  const canBet =
    (match.status === 'live' || match.status === 'upcoming') && match.bettingOpen;
  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-[var(--card-padding)] flex flex-col gap-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <span className="font-semibold text-[var(--text-primary)]">
          {match.teamA} <span className="text-[var(--text-muted)]">vs</span> {match.teamB}
        </span>
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-[var(--bg-input)] text-[var(--text-secondary)]">
            {match.format}
          </span>
          <StatusBadge status={match.status} />
        </div>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-xs text-[var(--text-muted)]">{formatMatchDate(match.matchDate)}</span>
        {canBet && (
          <Link
            href={`/groups/${groupId}/bet/${match.id}`}
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

function GroupDashboardContent() {
  const params = useParams<{ groupId: string }>();
  const groupId = params.groupId;
  const router = useRouter();
  const { user, userProfile } = useAuth();

  const [group, setGroup] = useState<Group | null>(null);
  const [myMember, setMyMember] = useState<GroupMember | null | undefined>(undefined);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;

    Promise.all([
      getGroupById(groupId),
      getUserGroupMember(groupId, user.uid),
      getGroupMembers(groupId),
      getMatches(groupId),
    ])
      .then(([g, me, mems, mats]) => {
        setGroup(g);
        setMyMember(me);
        setMembers(mems);
        setMatches(mats);
      })
      .catch(() => toast.error('Failed to load group'))
      .finally(() => setLoading(false));
  }, [user, groupId]);

  async function handleLogout() {
    try {
      await logoutUser();
      router.replace('/login');
    } catch {
      toast.error('Failed to sign out');
    }
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
    return (
      <div className="min-h-screen bg-[var(--bg-primary)] flex items-center justify-center">
        <svg className="animate-spin h-10 w-10 text-green-500" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
        </svg>
      </div>
    );
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

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)]">
      {/* Navbar */}
      <header className="bg-[var(--bg-card)] border-b border-[var(--border)] px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-4">
          {/* Left: back + group name */}
          <div className="flex items-center gap-3 min-w-0">
            <Link
              href="/groups"
              className="shrink-0 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
              title="Back to My Groups"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <div className="min-w-0">
              <span className="text-base font-bold text-green-500 truncate block">🏆 WhoWins</span>
              {group && (
                <span className="text-xs text-[var(--text-secondary)] truncate block">{group.name}</span>
              )}
            </div>
          </div>

          {/* Right: admin actions + theme + avatar + sign out */}
          <div className="flex items-center gap-2 shrink-0">
            {isAdmin && (
              <>
                <Link
                  href={`/groups/${groupId}/admin`}
                  className="text-xs font-semibold bg-[var(--bg-input)] hover:bg-[var(--bg-hover)] text-[var(--text-primary)] px-3 py-1.5 rounded-lg border border-[var(--border)] transition-colors"
                >
                  Admin Panel
                </Link>
                <Link
                  href={`/groups/${groupId}/manage`}
                  title="Group Settings"
                  className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                >
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </Link>
              </>
            )}
            <ThemeSwitcher />
            {userProfile && (
              <div className="flex items-center gap-2">
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-semibold shrink-0"
                  style={{ backgroundColor: userProfile.avatarColor }}
                >
                  {userProfile.displayName.charAt(0).toUpperCase()}
                </div>
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
              {todayMatches.map((m) => <MatchCard key={m.id} match={m} groupId={groupId} />)}
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
              {upcomingMatches.map((m) => <MatchCard key={m.id} match={m} groupId={groupId} />)}
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
              {pastMatches.map((m) => <MatchCard key={m.id} match={m} groupId={groupId} />)}
            </div>
          )}
        </section>

        {/* Leaderboard */}
        <section>
          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-[var(--card-padding)]">
            <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-4">Leaderboard</h2>
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
                        <div
                          className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-semibold shrink-0"
                          style={{ backgroundColor: m.avatarColor }}
                        >
                          {m.displayName.charAt(0).toUpperCase()}
                        </div>
                        <span className="text-sm text-[var(--text-primary)]">{m.displayName}</span>
                        {isMe && (
                          <span className="text-xs text-green-500 font-medium">(you)</span>
                        )}
                        {m.role === 'admin' && (
                          <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-400">
                            Admin
                          </span>
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
          </div>
        </section>

        {/* Invite */}
        <section>
          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-[var(--card-padding)] space-y-4">
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">Invite Friends</h2>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs bg-[var(--bg-input)] border border-[var(--border)] rounded-lg px-3 py-2 text-[var(--text-secondary)] truncate">
                {inviteLink}
              </code>
              <button
                onClick={copyInviteLink}
                className="shrink-0 text-xs font-semibold bg-[var(--bg-input)] hover:bg-[var(--bg-hover)] border border-[var(--border)] text-[var(--text-primary)] px-3 py-2 rounded-lg transition-colors"
              >
                Copy Link
              </button>
            </div>
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
          </div>
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
