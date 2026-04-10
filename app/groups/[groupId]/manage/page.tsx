'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { Pencil, RefreshCw } from 'lucide-react';
import AppNavbar from '@/components/AppNavbar';
import ProtectedRoute from '@/components/ProtectedRoute';
import { useAuth } from '@/lib/AuthContext';
import {
  getGroupById,
  getGroupMembers,
  getUserGroupMember,
  updateGroupName,
  regenerateInviteCode,
  promoteMember,
  demoteMember,
  removeMember,
  updateMemberDisplayName,
  deleteGroupCascade,
} from '@/lib/groups';
import type { Group, GroupMember } from '@/lib/groups';
import { copyText, getInviteLink } from '@/lib/share';
import { Spinner, Button, Badge, Card, FormInput, Modal, SectionHeader, Avatar, CenteredCard } from '@/components/ui';

function ManageContent() {
  const params = useParams<{ groupId: string }>();
  const groupId = params.groupId;
  const router = useRouter();
  const { user } = useAuth();

  const [isAdmin, setIsAdmin] = useState<boolean | undefined>(undefined);
  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  // group name edit
  const [editing, setEditing] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [savingName, setSavingName] = useState(false);

  // invite
  const [inviteCode, setInviteCode] = useState('');
  const [regenerating, setRegenerating] = useState(false);

  // member actions
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [memberNameInput, setMemberNameInput] = useState('');
  const [confirmRemove, setConfirmRemove] = useState<GroupMember | null>(null);
  const [confirmDeleteGroup, setConfirmDeleteGroup] = useState(false);
  const [deleteGroupInput, setDeleteGroupInput] = useState('');
  const [deletingGroup, setDeletingGroup] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    Promise.all([
      getUserGroupMember(groupId, user.uid),
      getGroupById(groupId),
      getGroupMembers(groupId),
    ])
      .then(([member, g, mems]) => {
        if (cancelled) return;
        setIsAdmin(member?.role === 'admin');
        setGroup(g);
        setInviteCode(g?.inviteCode ?? '');
        setNameInput(g?.name ?? '');
        setMembers(mems);
      })
      .catch((err) => {
        if (cancelled) return;
        if ((err as { code?: string })?.code === 'permission-denied') {
          setIsAdmin(false);
        } else {
          setLoadError('Failed to load page. Please try again.');
        }
      });
    return () => { cancelled = true; };
  }, [user, groupId, retryKey]);



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
    } catch (err) {
      console.error('[manage] updateGroupName failed:', err);
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
    } catch (err) {
      console.error('[manage] regenerateInviteCode failed:', err);
      toast.error('Failed to regenerate link');
    } finally {
      setRegenerating(false);
    }
  }

  async function copyInviteLink() {
    try {
      await copyText(getInviteLink(inviteCode));
      toast.success('Copied!');
    } catch (err) {
      console.error('[manage] copyInviteLink failed:', err);
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
    } catch (err) {
      console.error('[manage] promoteMember failed:', err);
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
    } catch (err) {
      console.error('[manage] demoteMember failed:', err);
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
    } catch (err) {
      console.error('[manage] removeMember failed:', err);
      toast.error('Failed to remove member');
    } finally {
      setMemberLoading(m.userId, false);
    }
  }

  async function handleDeleteGroup() {
    if (!user || !group) return;

    const expectedName = group.name.trim();
    if (deleteGroupInput.trim() !== expectedName) {
      toast.error('Type the exact group name to confirm deletion');
      return;
    }

    setDeletingGroup(true);
    try {
      await deleteGroupCascade(groupId, user.uid);
      toast.success('Group deleted');
      router.replace('/groups');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete group');
    } finally {
      setDeletingGroup(false);
    }
  }

  function startEditingMemberName(member: GroupMember) {
    setEditingMemberId(member.userId);
    setMemberNameInput(member.displayName);
  }

  async function handleSaveMemberName(member: GroupMember) {
    const displayName = memberNameInput.trim();
    if (displayName.length < 2) {
      toast.error('Member name must be at least 2 characters');
      return;
    }

    setMemberLoading(member.userId, true);
    try {
      await updateMemberDisplayName(groupId, member.userId, displayName);
      toast.success('Member name updated');
      setEditingMemberId(null);
      setMemberNameInput('');
      await refreshMembers();
    } catch (err) {
      console.error('[manage] updateMemberDisplayName failed:', err);
      toast.error('Failed to update member name');
    } finally {
      setMemberLoading(member.userId, false);
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
          <p className="text-sm text-[var(--text-secondary)]">Admin privileges required.</p>
          <Button variant="primary" size="md" href={`/groups/${groupId}`}>
            Back to Group
          </Button>
        </Card>
      </CenteredCard>
    );
  }

  const inviteLink = getInviteLink(inviteCode);

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)]">

      {/* Delete group confirmation modal */}
      <Modal
        open={confirmDeleteGroup && !!group}
        onClose={() => { setConfirmDeleteGroup(false); setDeleteGroupInput(''); }}
        maxWidth="md"
        title="Delete group?"
      >
        <div className="space-y-4">
          <p className="text-sm text-[var(--text-secondary)]">
            This will permanently delete the group, all matches, all bets, and all member links. This action cannot be undone.
          </p>
          <div className="space-y-2">
            <label className="block text-xs text-[var(--text-muted)]">
              Type <span className="font-semibold text-[var(--text-primary)]">{group?.name}</span> to confirm
            </label>
            <FormInput
              type="text"
              value={deleteGroupInput}
              onChange={(e) => setDeleteGroupInput(e.target.value)}
              danger
              autoFocus
            />
          </div>
          <div className="flex gap-3">
            <Button
              variant="secondary"
              size="md"
              className="flex-1"
              onClick={() => { setConfirmDeleteGroup(false); setDeleteGroupInput(''); }}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              size="md"
              className="flex-1"
              loading={deletingGroup}
              disabled={deleteGroupInput.trim() !== group?.name.trim()}
              onClick={handleDeleteGroup}
            >
              Delete Group
            </Button>
          </div>
        </div>
      </Modal>

      {/* Remove member confirmation modal */}
      <Modal
        open={!!confirmRemove}
        onClose={() => setConfirmRemove(null)}
        maxWidth="sm"
        title="Remove member?"
      >
        <div className="space-y-4">
          <p className="text-sm text-[var(--text-secondary)]">
            Are you sure you want to remove{' '}
            <span className="font-medium text-[var(--text-primary)]">{confirmRemove?.displayName}</span>{' '}
            from the group?
          </p>
          <div className="flex gap-3">
            <Button
              variant="secondary"
              size="md"
              className="flex-1"
              onClick={() => setConfirmRemove(null)}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              size="md"
              className="flex-1"
              onClick={handleRemoveConfirmed}
            >
              Remove
            </Button>
          </div>
        </div>
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
          { label: 'Dashboard', href: `/groups/${groupId}` },
          { label: 'Matches',   href: `/groups/${groupId}/admin` },
          { label: 'Group',     href: `/groups/${groupId}/manage` },
        ]}
      />

      <main className="max-w-5xl mx-auto px-6 py-8 space-y-6">

        {/* ── Section 1: Group ── */}
        <Card variant="default" className="space-y-4">
          {editing ? (
            <div className="flex gap-2">
              <FormInput
                type="text"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                wrapperClassName="flex-1"
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') handleSaveName(); if (e.key === 'Escape') setEditing(false); }}
              />
              <Button variant="primary" size="md" loading={savingName} onClick={handleSaveName}>
                Save
              </Button>
              <Button
                variant="secondary"
                size="md"
                onClick={() => { setEditing(false); setNameInput(group?.name ?? ''); }}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold text-[var(--text-primary)]">{group?.name}</span>
              {/* Pencil icon button: icon-only, no padding needed — left as raw button with lucide icon */}
              <button
                onClick={() => { setEditing(true); setNameInput(group?.name ?? ''); }}
                className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                title="Edit group name"
              >
                <Pencil className="h-4 w-4" />
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
        </Card>

        {/* ── Section 2: Invite Link ── */}
        <Card variant="default" className="space-y-4">
          <SectionHeader title="Invite Link" mb="mb-0" />

          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs bg-[var(--bg-input)] border border-[var(--border)] rounded-lg px-3 py-2 text-[var(--text-secondary)] truncate">
              {inviteLink}
            </code>
            <Button variant="secondary" size="sm" onClick={copyInviteLink} className="shrink-0">
              Copy
            </Button>
          </div>

          <div className="flex flex-wrap gap-3">
            {/* WhatsApp link: brand color #25D366, no matching Button variant — left as raw <a> */}
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

            <Button
              variant="secondary"
              size="md"
              loading={regenerating}
              onClick={handleRegenerate}
            >
              {!regenerating && <RefreshCw className="h-3.5 w-3.5" />}
              Regenerate Link
            </Button>
          </div>
        </Card>

        {/* ── Section 3: Members ── */}
        <Card variant="default" className="space-y-4">
          <SectionHeader title={`Members (${members.length})`} mb="mb-0" />

          <ul className="space-y-3">
            {members.map((m) => {
              const isMe = m.userId === user?.uid;
              const loading = actionLoading[m.userId];
              return (
                <li
                  key={m.userId}
                  className={`flex flex-wrap items-center gap-3 py-2.5 px-3 rounded-lg ${
                    // Member row isMe highlight: dynamic per-row background — left as raw class
                    isMe ? 'bg-green-500/10 border border-green-500/20' : 'bg-[var(--bg-input)]'
                  }`}
                >
                  {/* Avatar */}
                  <Avatar name={m.displayName} color={m.avatarColor} size="md" />

                  {/* Name + badges */}
                  <div className="flex items-center gap-2 flex-1 min-w-0 flex-wrap">
                    {editingMemberId === m.userId ? (
                      <>
                        {/* Member name inline edit: uses bg-[var(--bg-card)] (not bg-[var(--bg-input)]),
                            visually different from FormInput default — left as raw input */}
                        <input
                          type="text"
                          value={memberNameInput}
                          onChange={(e) => setMemberNameInput(e.target.value)}
                          className="min-w-[180px] flex-1 rounded-lg bg-[var(--bg-card)] border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveMemberName(m);
                            if (e.key === 'Escape') {
                              setEditingMemberId(null);
                              setMemberNameInput('');
                            }
                          }}
                        />
                        <Button
                          variant="primary"
                          size="sm"
                          loading={loading}
                          onClick={() => handleSaveMemberName(m)}
                        >
                          Save
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => { setEditingMemberId(null); setMemberNameInput(''); }}
                        >
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <>
                        <span className="text-sm text-[var(--text-primary)] font-medium truncate">
                          {m.displayName}
                        </span>
                        {/* Pencil icon: icon-only button, no padding variant — left as raw button with lucide icon */}
                        <button
                          onClick={() => startEditingMemberName(m)}
                          disabled={loading}
                          className="text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-50 transition-colors"
                          title="Edit member name"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                      </>
                    )}
                    {isMe && <span className="text-xs text-green-500">(you)</span>}
                    <Badge
                      variant={m.role === 'admin' ? 'role-admin' : 'role-member'}
                      shape="tag"
                    >
                      {m.role === 'admin' ? 'Admin' : 'Member'}
                    </Badge>
                  </div>

                  {/* Points */}
                  <span className="text-sm font-semibold text-green-400 shrink-0">
                    {m.totalPoints} pts
                  </span>

                  {/* Actions (not shown for self) */}
                  {!isMe && (
                    <div className="flex items-center gap-2 shrink-0">
                      {/* Make Admin / Remove Admin: dynamic hover colors (yellow/slate), no Button variant — left as raw buttons */}
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
                      <Button
                        variant="ghost-danger"
                        size="sm"
                        disabled={loading}
                        onClick={() => setConfirmRemove(m)}
                      >
                        Remove
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>

        {/* ── Section 4: Danger Zone ── */}
        <Card variant="danger-zone" className="space-y-3">
          <h2 className="text-lg font-semibold text-red-400">Danger Zone</h2>
          <p className="text-sm text-[var(--text-secondary)]">
            Deleting a group removes all matches, bets, and member records permanently.
          </p>
          <Button
            variant="ghost-danger"
            size="lg"
            onClick={() => { setDeleteGroupInput(''); setConfirmDeleteGroup(true); }}
          >
            Delete Group
          </Button>
        </Card>

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
