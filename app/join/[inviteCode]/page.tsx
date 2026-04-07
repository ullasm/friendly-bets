'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { useAuth } from '@/lib/AuthContext';
import { getGroupByInviteCode, isGroupMember, joinGroup } from '@/lib/groups';
import type { Group } from '@/lib/groups';

type PageState = 'loading' | 'invalid' | 'unauthenticated' | 'already-member' | 'join';

export default function JoinPage() {
  const params = useParams<{ inviteCode: string }>();
  const inviteCode = params.inviteCode.toUpperCase();
  const router = useRouter();
  const { user, userProfile, loading: authLoading } = useAuth();

  const [group, setGroup] = useState<Group | null>(null);
  const [pageState, setPageState] = useState<PageState>('loading');
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    if (authLoading) return;

    async function resolve() {
      const found = await getGroupByInviteCode(inviteCode);
      if (!found) {
        setPageState('invalid');
        return;
      }
      setGroup(found);

      if (!user) {
        setPageState('unauthenticated');
        return;
      }

      const member = await isGroupMember(found.groupId, user.uid);
      setPageState(member ? 'already-member' : 'join');
    }

    resolve().catch(() => setPageState('invalid'));
  }, [authLoading, user, inviteCode]);

  async function handleJoin() {
    if (!group || !user || !userProfile) return;
    setJoining(true);
    try {
      await joinGroup(group.groupId, user.uid, userProfile.displayName, userProfile.avatarColor);
      toast.success(`Welcome to ${group.name}!`);
      router.replace(`/groups/${group.groupId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to join group');
    } finally {
      setJoining(false);
    }
  }

  // ── Full screen spinner (auth + initial load) ─────────────────────────────
  if (pageState === 'loading') {
    return (
      <div className="min-h-screen bg-[var(--bg-primary)] flex items-center justify-center">
        <svg className="animate-spin h-10 w-10 text-green-500" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
        </svg>
      </div>
    );
  }

  // ── Invalid invite ────────────────────────────────────────────────────────
  if (pageState === 'invalid') {
    return (
      <div className="min-h-screen bg-[var(--bg-primary)] flex items-center justify-center px-4">
        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-8 max-w-sm w-full text-center space-y-4">
          <div className="text-4xl">🔗</div>
          <h2 className="text-lg font-bold text-[var(--text-primary)]">Invalid invite link</h2>
          <p className="text-sm text-[var(--text-secondary)]">
            This invite link is invalid or has expired.
          </p>
          <Link
            href="/groups"
            className="inline-block bg-green-500 hover:bg-green-600 text-white font-semibold px-5 py-2 rounded-lg transition-colors text-sm"
          >
            Go to My Groups
          </Link>
        </div>
      </div>
    );
  }

  // ── Not logged in ─────────────────────────────────────────────────────────
  if (pageState === 'unauthenticated') {
    const redirectPath = `/join/${inviteCode}`;
    return (
      <div className="min-h-screen bg-[var(--bg-primary)] flex items-center justify-center px-4">
        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-8 max-w-sm w-full text-center space-y-5">
          <div className="text-4xl">🏆</div>
          <div>
            <h2 className="text-xl font-bold text-[var(--text-primary)]">{group?.name}</h2>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              You&apos;ve been invited to join <span className="font-medium text-[var(--text-primary)]">{group?.name}</span>
            </p>
          </div>
          <div className="flex flex-col gap-3">
            <Link
              href={`/login?redirect=${encodeURIComponent(redirectPath)}`}
              className="w-full inline-flex items-center justify-center bg-green-500 hover:bg-green-600 text-white font-semibold px-5 py-2.5 rounded-lg transition-colors text-sm"
            >
              Sign in to join
            </Link>
            <Link
              href={`/register?redirect=${encodeURIComponent(redirectPath)}`}
              className="w-full inline-flex items-center justify-center bg-[var(--bg-input)] hover:bg-[var(--bg-hover)] text-[var(--text-primary)] font-semibold px-5 py-2.5 rounded-lg transition-colors text-sm border border-[var(--border)]"
            >
              Create account
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // ── Already a member ──────────────────────────────────────────────────────
  if (pageState === 'already-member') {
    return (
      <div className="min-h-screen bg-[var(--bg-primary)] flex items-center justify-center px-4">
        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-8 max-w-sm w-full text-center space-y-4">
          <div className="text-green-400 text-4xl">✓</div>
          <h2 className="text-lg font-bold text-[var(--text-primary)]">You&apos;re already in this group!</h2>
          <p className="text-sm text-[var(--text-secondary)]">{group?.name}</p>
          <Link
            href={`/groups/${group?.groupId}`}
            className="inline-block bg-green-500 hover:bg-green-600 text-white font-semibold px-5 py-2 rounded-lg transition-colors text-sm"
          >
            Go to Group
          </Link>
        </div>
      </div>
    );
  }

  // ── Join confirmation ─────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[var(--bg-primary)] flex items-center justify-center px-4">
      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-8 max-w-sm w-full text-center space-y-5">
        <div className="text-4xl">🏆</div>
        <div>
          <h2 className="text-2xl font-bold text-[var(--text-primary)]">{group?.name}</h2>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            You&apos;ve been invited to join this group
          </p>
        </div>
        <button
          onClick={handleJoin}
          disabled={joining}
          className="w-full flex items-center justify-center gap-2 bg-green-500 hover:bg-green-600 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold px-5 py-2.5 rounded-lg transition-colors text-sm"
        >
          {joining ? (
            <>
              <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              Joining…
            </>
          ) : (
            'Join Group'
          )}
        </button>
      </div>
    </div>
  );
}
