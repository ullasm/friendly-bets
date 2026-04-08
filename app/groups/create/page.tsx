'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import toast from 'react-hot-toast';
import ProtectedRoute from '@/components/ProtectedRoute';
import ThemeSwitcher from '@/components/ThemeSwitcher';
import { useAuth } from '@/lib/AuthContext';
import { logoutUser } from '@/lib/auth';
import { createGroup } from '@/lib/groups';

function CreateGroupContent() {
  const router = useRouter();
  const { user, userProfile } = useAuth();
  const [groupName, setGroupName] = useState('');
  const [creating, setCreating] = useState(false);

  async function handleLogout() {
    try {
      await logoutUser();
      router.replace('/login');
    } catch {
      toast.error('Failed to sign out');
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const name = groupName.trim();
    if (name.length < 3) {
      toast.error('Group name must be at least 3 characters');
      return;
    }
    if (!user || !userProfile) return;

    setCreating(true);
    try {
      const groupId = await createGroup(
        name,
        user.uid,
        userProfile.displayName,
        userProfile.avatarColor
      );
      toast.success('Group created!');
      router.replace(`/groups/${groupId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create group');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)]">
      {/* Navbar */}
      <header className="bg-[var(--bg-card)] border-b border-[var(--border)] px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <Link href="/" className="text-xl font-bold text-green-500 hover:text-green-400 transition-colors">🏆 WhoWins</Link>
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
      <main className="max-w-lg mx-auto px-6 py-12">
        <Link
          href="/groups"
          className="inline-flex items-center gap-1.5 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors mb-6"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back to Groups
        </Link>

        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-8 shadow-xl">
          <div className="mb-6">
            <h2 className="text-2xl font-bold text-[var(--text-primary)]">Create a Group</h2>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              Create a group and invite your friends to join
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="groupName" className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
                Group Name
              </label>
              <input
                id="groupName"
                type="text"
                required
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="e.g. IPL 2026 Betting"
                className="w-full rounded-lg bg-[var(--bg-input)] border border-[var(--border)] px-4 py-2.5 text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
              />
            </div>

            <button
              type="submit"
              disabled={creating}
              className="w-full flex items-center justify-center gap-2 rounded-lg bg-green-500 hover:bg-green-600 disabled:opacity-60 disabled:cursor-not-allowed px-4 py-2.5 font-semibold text-white transition-colors"
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
                'Create Group'
              )}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}

export default function CreateGroupPage() {
  return (
    <ProtectedRoute>
      <CreateGroupContent />
    </ProtectedRoute>
  );
}

