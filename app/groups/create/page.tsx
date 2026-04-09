'use client';

import { useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import AppNavbar from '@/components/AppNavbar';
import ProtectedRoute from '@/components/ProtectedRoute';
import { useAuth } from '@/lib/AuthContext';
import { createGroup } from '@/lib/groups';
import { Button, Card, FormInput } from '@/components/ui';

function CreateGroupContent() {
  const { user, userProfile } = useAuth();
  const [groupName, setGroupName] = useState('');
  const [creating, setCreating] = useState(false);

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
      <AppNavbar maxWidth="lg" />

      <main className="max-w-lg mx-auto px-6 py-12">
        {/* Back link: inline icon+text nav, not a Button — left as raw Link with lucide icon */}
        <Link
          href="/groups"
          className="inline-flex items-center gap-1.5 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors mb-6"
        >
          <ChevronLeft className="h-4 w-4" />
          Back to Groups
        </Link>

        <Card variant="modal" padding="p-8">
          <div className="mb-6">
            <h2 className="text-2xl font-bold text-[var(--text-primary)]">Create a Group</h2>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              Create a group and invite your friends to join
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <FormInput
              id="groupName"
              label="Group Name"
              type="text"
              required
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="e.g. IPL 2026 Betting"
            />

            <Button
              type="submit"
              variant="primary"
              size="lg"
              loading={creating}
              className="w-full"
            >
              Create Group
            </Button>
          </form>
        </Card>
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
