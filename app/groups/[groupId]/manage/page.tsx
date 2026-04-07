'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import toast from 'react-hot-toast';
import ProtectedRoute from '@/components/ProtectedRoute';
import ThemeSwitcher from '@/components/ThemeSwitcher';
import { useAuth } from '@/lib/AuthContext';
import { logoutUser } from '@/lib/auth';
import {
  getGroupById,
  getGroupMembers,
  getUserGroupMember,
  updateGroupName,
  regenerateInviteCode,
  promoteMember,
  demoteMember,
  removeMember,
} from '@/lib/groups';
import type { Group, GroupMember } from '@/lib/groups';
import { copyText, getInviteLink } from '@/lib/share';

function ManageContent() {
  const params = useParams<{ groupId: string }>();
  const groupId = params.groupId;
  const router = useRouter();
  const { user, userProfile } = useAuth();

  const [isAdmin, setIsAdmin] = useState<boolean | undefined>(undefined);
  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);

  // group name edit
  const [editing, setEditing] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [savingName, setSavingName] = useState(false);

  // invite
  const [inviteCode, setInviteCode] = useState('');
  const [regenerating, setRegenerating] = useState(false);

  // member actions
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const [confirmRemove, setConfirmRemove] = useState<GroupMember | null>(null);

  useEffect(() => {
    if (!user) return;
    Promise.all([
      getUserGroupMember(groupId, user.uid),
      getGroupById(groupId),
      getGroupMembers(groupId),
    ])
      .then(([member, g, mems]) => {
        setIsAdmin(member?.role === 'admin');
        setGroup(g);
        setInviteCode(g?.inviteCode ?? '');
        setNameInput(g?.name ?? '');
        setMembers(mems);
      })
      .catch(() => {
        toast.error('Failed to load group');
        setIsAdmin(false);
      });
  }, [user, groupId]);

  async function handleLogout() {
    try {
      await logoutUser();
      router.replace('/login');
    } catch {
      toast.error('Failed to sign out');
    }
  }

  async function handleSaveName() {
    const name = nameInput.trim();
    if (name.length < 3) {
      toast.error('Group name must be at least 3 characters');
      return;
    }
    setSavingName(true);
    try {
      await updateGroupName(groupId, name);
      setGroup((g) => (g ? { ...g, name } : g));
      setEditing(false);
      toast.success('Group name updated');
    } catch {
      toast.error('Failed to update name');
    } finally {
      setSavingName(false);
    }
  }

  async function handleRegenerate() {
    setRegenerating(true);
    try {
      const newCode = await regenerateInviteCode(groupId);
      setInviteCode(newCode);
      toast.success('New invite link generated. Old link is now invalid.');
    } catch {
      toast.error('Failed to regenerate link');
    } finally {
      setRegenerating(false);
    }
  }

  async function copyInviteLink() {
    try {
      await copyText(getInviteLink(inviteCode));
      toast.success('Copied!');
    } catch {
      toast.error('Could not copy the invite link');
    }
  }

  async function refreshMembers() {
    const mems = await getGroupMembers(groupId);
    setMembers(mems);
  }

  function setMemberLoading(userId: string, val: boolean) {
    setActionLoading((p) => ({ ...p, [userId]: val }));
  }

  async function handlePromote(m: GroupMember) {
    setMemberLoading(m.userId, true);
    try {
      await promoteMember(groupId, m.userId);
      toast.success(`${m.displayName} is now an admin`);
      await refreshMembers();
    } catch {
      toast.error('Failed to promote member');
    } finally {
      setMemberLoading(m.userId, false);
    }
  }

  async function handleDemote(m: GroupMember) {
    setMemberLoading(m.userId, true);
    try {
      await demoteMember(groupId, m.userId);
      toast.success(`${m.displayName} is now a member`);
      await refreshMembers();
    } catch {
      toast.error('Failed to demote member');
    } finally {
      setMemberLoading(m.userId, false);
    }
  }

  async function handleRemoveConfirmed() {
    if (!confirmRemove) return;
    const m = confirmRemove;
    setConfirmRemove(null);
    setMemberLoading(m.userId, true);
    try {
      await removeMember(groupId, m.userId);
      toast.success(`${m.displayName} removed from group`);
      await refreshMembers();
    } catch {
      toast.error('Failed to remove member');
    } finally {
      setMemberLoading(m.userId, false);
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
          <p className="text-sm text-[var(--text-secondary)]">Admin privileges required.</p>
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

  const inviteLink = getInviteLink(inviteCode);

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)]">
      {/* Confirm remove modal */}
      {confirmRemove && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-6 max-w-sm w-full space-y-4">
            <h3 className="font-semibold text-[var(--text-primary)]">Remove member?</h3>
            <p className="text-sm text-[var(--text-secondary)]">
              Are you sure you want to remove{' '}
              <span className="font-medium text-[var(--text-primary)]">{confirmRemove.displayName}</span>{' '}
              from the group?
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmRemove(null)}
                className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg-input)] hover:bg-[var(--bg-hover)] text-[var(--text-primary)] text-sm font-medium py-2 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleRemoveConfirmed}
                className="flex-1 rounded-lg bg-red-500 hover:bg-red-600 text-white text-sm font-semibold py-2 transition-colors"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Navbar */}
      <header className="bg-[var(--bg-card)] border-b border-[var(--border)] px-6 py-4">
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-4">
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
                <span className="text-xs text-[var(--text-secondary)] truncate block">
                  {group.name} · Settings
                </span>
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

      <main className="max-w-3xl mx-auto px-6 py-8 space-y-6">
        {/* ── Section 1: Group Info ── */}
        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-[var(--card-padding)] space-y-4">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">Group Info</h2>

          {editing ? (
            <div className="flex gap-2">
              <input
                type="text"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                className="flex-1 rounded-lg bg-[var(--bg-input)] border border-[var(--border)] px-4 py-2.5 text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') handleSaveName(); if (e.key === 'Escape') setEditing(false); }}
              />
              <button
                onClick={handleSaveName}
                disabled={savingName}
                className="px-4 py-2 rounded-lg bg-green-500 hover:bg-green-600 disabled:opacity-60 text-white text-sm font-semibold transition-colors"
              >
                {savingName ? 'Saving…' : 'Save'}
              </button>
              <button
                onClick={() => { setEditing(false); setNameInput(group?.name ?? ''); }}
                className="px-3 py-2 rounded-lg bg-[var(--bg-input)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] text-sm transition-colors"
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold text-[var(--text-primary)]">{group?.name}</span>
              <button
                onClick={() => { setEditing(true); setNameInput(group?.name ?? ''); }}
                className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                title="Edit group name"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
              </button>
            </div>
          )}

          {group && (
            <p className="text-xs text-[var(--text-muted)]">
              Created on{' '}
              {group.createdAt.toDate().toLocaleDateString('en-US', {
                month: 'long',
                day: 'numeric',
                year: 'numeric',
              })}
            </p>
          )}
        </div>

        {/* ── Section 2: Invite Link ── */}
        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-[var(--card-padding)] space-y-4">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">Invite Link</h2>

          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs bg-[var(--bg-input)] border border-[var(--border)] rounded-lg px-3 py-2 text-[var(--text-secondary)] truncate">
              {inviteLink}
            </code>
            <button
              onClick={copyInviteLink}
              className="shrink-0 text-xs font-semibold bg-[var(--bg-input)] hover:bg-[var(--bg-hover)] border border-[var(--border)] text-[var(--text-primary)] px-3 py-2 rounded-lg transition-colors"
            >
              Copy
            </button>
          </div>

          <div className="flex flex-wrap gap-3">
            <a
              href={`https://wa.me/?text=${encodeURIComponent(`Join my WhoWins group! Click here: ${inviteLink}`)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 rounded-lg bg-[#25D366] hover:bg-[#1ebe5d] text-white font-semibold text-sm px-4 py-2 transition-colors"
            >
              <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
              </svg>
              Share on WhatsApp
            </a>

            <button
              onClick={handleRegenerate}
              disabled={regenerating}
              className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-input)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] text-sm font-medium px-4 py-2 disabled:opacity-50 transition-colors"
            >
              {regenerating ? (
                <svg className="animate-spin h-3.5 w-3.5" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
              ) : (
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              )}
              Regenerate Link
            </button>
          </div>
        </div>

        {/* ── Section 3: Members ── */}
        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-[var(--card-padding)] space-y-4">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">
            Members ({members.length})
          </h2>

          <ul className="space-y-3">
            {members.map((m) => {
              const isMe = m.userId === user?.uid;
              const loading = actionLoading[m.userId];
              return (
                <li
                  key={m.userId}
                  className={`flex flex-wrap items-center gap-3 py-2.5 px-3 rounded-lg ${
                    isMe ? 'bg-green-500/10 border border-green-500/20' : 'bg-[var(--bg-input)]'
                  }`}
                >
                  {/* Avatar */}
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-semibold shrink-0"
                    style={{ backgroundColor: m.avatarColor }}
                  >
                    {m.displayName.charAt(0).toUpperCase()}
                  </div>

                  {/* Name + badges */}
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span className="text-sm text-[var(--text-primary)] font-medium truncate">
                      {m.displayName}
                    </span>
                    {isMe && <span className="text-xs text-green-500">(you)</span>}
                    <span
                      className={`text-xs font-medium px-1.5 py-0.5 rounded ${
                        m.role === 'admin'
                          ? 'bg-yellow-500/20 text-yellow-400'
                          : 'bg-[var(--bg-hover)] text-[var(--text-muted)]'
                      }`}
                    >
                      {m.role === 'admin' ? 'Admin' : 'Member'}
                    </span>
                  </div>

                  {/* Points */}
                  <span className="text-sm font-semibold text-green-400 shrink-0">
                    {m.totalPoints} pts
                  </span>

                  {/* Actions (not shown for self) */}
                  {!isMe && (
                    <div className="flex items-center gap-2 shrink-0">
                      {m.role === 'member' ? (
                        <button
                          onClick={() => handlePromote(m)}
                          disabled={loading}
                          className="text-xs font-medium px-2.5 py-1 rounded-lg bg-[var(--bg-hover)] hover:bg-yellow-500/20 text-[var(--text-secondary)] hover:text-yellow-400 disabled:opacity-50 transition-colors"
                        >
                          Make Admin
                        </button>
                      ) : (
                        <button
                          onClick={() => handleDemote(m)}
                          disabled={loading}
                          className="text-xs font-medium px-2.5 py-1 rounded-lg bg-[var(--bg-hover)] hover:bg-slate-600/40 text-[var(--text-secondary)] disabled:opacity-50 transition-colors"
                        >
                          Remove Admin
                        </button>
                      )}
                      <button
                        onClick={() => setConfirmRemove(m)}
                        disabled={loading}
                        className="text-xs font-medium px-2.5 py-1 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 disabled:opacity-50 transition-colors"
                      >
                        Remove
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </main>
    </div>
  );
}

export default function ManagePage() {
  return (
    <ProtectedRoute>
      <ManageContent />
    </ProtectedRoute>
  );
}
