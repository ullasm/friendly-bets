'use client';

import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, ChevronRight } from 'lucide-react';
import AppNavbar from '@/components/AppNavbar';
import ProtectedRoute from '@/components/ProtectedRoute';
import { useAuth } from '@/lib/AuthContext';
import { getUserGroups } from '@/lib/groups';
import type { Group } from '@/lib/groups';
import { Spinner, Button, Card, EmptyState } from '@/components/ui';

function formatDate(ts: Group['createdAt']) {
  return ts.toDate().toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function GroupsContent() {
  const { user } = useAuth();
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    getUserGroups(user.uid)
      .then(setGroups)
      .catch(() => toast.error('Failed to load groups'))
      .finally(() => setLoading(false));
  }, [user]);

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <AppNavbar
        maxWidth="5xl"
        center={
          <span className="font-light text-[var(--text-primary)] text-sm sm:text-base">
            My Groups
          </span>
        }
        tabs={[]}
      />

      <main className="max-w-5xl mx-auto px-6 py-8">
        {/* Header row */}
        <div className="flex items-center justify-end mb-6">
          {process.env.NEXT_PUBLIC_ALLOW_CREATE_GROUP === 'true' && (
            <Button variant="primary" size="md" href="/groups/create">
              <Plus className="h-4 w-4" />
              Create Group
            </Button>
          )}
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <Spinner size="xl" />
          </div>
        )}

        {/* Empty state */}
        {!loading && groups.length === 0 && (
          <EmptyState
            icon="🏏"
            heading="You're not in any groups yet"
            subtext={
              process.env.NEXT_PUBLIC_ALLOW_CREATE_GROUP !== 'true'
                ? 'Ask a group admin to share an invite link with you.'
                : undefined
            }
            action={
              process.env.NEXT_PUBLIC_ALLOW_CREATE_GROUP === 'true'
                ? { label: 'Create your first group', href: '/groups/create' }
                : undefined
            }
          />
        )}

        {/* Group grid */}
        {!loading && groups.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {groups.map((group) => (
              <Card key={group.groupId} variant="default" className="flex flex-col gap-4">
                <div>
                  <h3 className="text-lg font-bold text-[var(--text-primary)] leading-snug">
                    {group.name}
                  </h3>
                  <p className="text-xs text-[var(--text-muted)] mt-1">
                    Created {formatDate(group.createdAt)}
                  </p>
                </div>
                <Button
                  variant="primary"
                  size="md"
                  href={`/groups/${group.groupId}`}
                  className="mt-auto"
                >
                  Enter Group
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

export default function GroupsPage() {
  return (
    <ProtectedRoute>
      <GroupsContent />
    </ProtectedRoute>
  );
}
