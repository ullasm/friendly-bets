'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import AppNavbar, { type NavTab } from '@/components/AppNavbar';
import ProtectedRoute from '@/components/ProtectedRoute';
import { useAuth } from '@/lib/AuthContext';
import { getGroupById, getUserGroupMember } from '@/lib/groups';
import type { Group, GroupMember } from '@/lib/groups';
import { Spinner, Badge, Card, Avatar, SectionHeader } from '@/components/ui';

function PointsContent() {
  const params = useParams<{ groupId: string }>();
  const groupId = params.groupId;
  const { user } = useAuth();

  const [group, setGroup] = useState<Group | null>(null);
  const [myMember, setMyMember] = useState<GroupMember | null | undefined>(undefined);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    let membersUnsub: (() => void) | null = null;

    Promise.all([
      getGroupById(groupId),
      getUserGroupMember(groupId, user.uid),
    ]).then(([groupResult, memberResult]) => {
      if (cancelled) return;
      setGroup(groupResult);
      if (!memberResult) {
        setMyMember(null);
        setLoading(false);
        membersUnsub?.();
      } else {
        setMyMember(memberResult);
      }
    }).catch(() => {
      if (cancelled) return;
      setMyMember(null);
      setLoading(false);
    });

    membersUnsub = onSnapshot(
      query(collection(db, 'groups', groupId, 'members'), orderBy('totalPoints', 'desc')),
      (snap) => {
        if (cancelled) return;
        const updated = snap.docs.map((d) => d.data() as GroupMember);
        setMembers(updated);
        const mine = updated.find((m) => m.userId === user.uid);
        if (mine) setMyMember(mine);
        setLoading(false);
      },
      (err) => {
        if (err.code === 'permission-denied') return;
        setLoading(false);
      }
    );

    return () => {
      cancelled = true;
      membersUnsub?.();
    };
  }, [user, groupId]);

  if (loading) return <Spinner size="lg" fullPage />;

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

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)]">
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
          { label: 'Bets',   href: `/groups/${groupId}` },
          { label: 'Points',      href: `/groups/${groupId}/points` },
          { label: 'Settlements', href: `/groups/${groupId}/settlements` },
          ...(isAdmin ? [
            { label: 'Matches',   href: `/groups/${groupId}/admin` },
            { label: 'Group',     href: `/groups/${groupId}/manage` },
          ] as NavTab[] : []),
        ]}
      />

      <main className="max-w-5xl mx-auto px-2 py-8">
        <Card variant="default">
          <SectionHeader title="Points" mb="mb-4" />
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
                      <Avatar name={m.displayName} color={m.avatarColor} size="sm" />
                      <span className="text-sm text-[var(--text-primary)]">{m.displayName}</span>
                      {isMe && (
                        <span className="text-xs text-green-500 font-medium">(you)</span>
                      )}
                      {m.role === 'admin' && (
                        <Badge variant="role-admin" shape="tag">Admin</Badge>
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
        </Card>
      </main>
    </div>
  );
}

export default function PointsPage() {
  return (
    <ProtectedRoute>
      <PointsContent />
    </ProtectedRoute>
  );
}
