'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { collection, query, where, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import AppNavbar, { type NavTab } from '@/components/AppNavbar';
import ProtectedRoute from '@/components/ProtectedRoute';
import { useAuth } from '@/lib/AuthContext';
import { getGroupById, getUserGroupMember } from '@/lib/groups';
import type { Group, GroupMember } from '@/lib/groups';
import { computeSettlements, acknowledgeSettlement } from '@/lib/settlements';
import type { ComputedSettlement, Settlement } from '@/lib/settlements';
import { Spinner, Card, SectionHeader } from '@/components/ui';

function SettlementsContent() {
  const params = useParams<{ groupId: string }>();
  const groupId = params.groupId;
  const { user } = useAuth();

  const [group, setGroup] = useState<Group | null>(null);
  const [myMember, setMyMember] = useState<GroupMember | null | undefined>(undefined);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [groupSettlements, setGroupSettlements] = useState<Settlement[]>([]);
  const [acknowledgingSettlements, setAcknowledgingSettlements] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    let membersUnsub: (() => void) | null = null;
    let settlementsUnsub: (() => void) | null = null;

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
        settlementsUnsub?.();
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

    settlementsUnsub = onSnapshot(
      query(collection(db, 'settlements'), where('groupId', '==', groupId)),
      (snap) => {
        if (cancelled) return;
        setGroupSettlements(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Settlement)));
      },
      (err) => {
        if (err.code === 'permission-denied') return;
      }
    );

    return () => {
      cancelled = true;
      membersUnsub?.();
      settlementsUnsub?.();
    };
  }, [user, groupId]);

  async function handleAcknowledgeSettlement(s: ComputedSettlement) {
    const key = `${s.fromUserId}-${s.toUserId}`;
    setAcknowledgingSettlements((prev) => new Set(prev).add(key));
    try {
      await acknowledgeSettlement(groupId, s.fromUserId, s.toUserId, s.points);
      toast.success('Settlement acknowledged!');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to acknowledge settlement');
    } finally {
      setAcknowledgingSettlements((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }

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
  const memberNames = members.reduce<Record<string, string>>((acc, m) => {
    acc[m.userId] = m.displayName;
    return acc;
  }, {});

  // Aggregate acknowledged points per (from→to) pair
  const settledByPair: Record<string, number> = {};
  for (const s of groupSettlements) {
    const key = `${s.fromUserId}-${s.toUserId}`;
    settledByPair[key] = (settledByPair[key] ?? 0) + s.points;
  }

  const outstanding = computeSettlements(members);
  const outstandingKeys = new Set(outstanding.map((s) => `${s.fromUserId}-${s.toUserId}`));

  const acknowledgedRows: ComputedSettlement[] = [];
  const seenAckedKeys = new Set<string>();
  for (const s of groupSettlements) {
    const key = `${s.fromUserId}-${s.toUserId}`;
    if (!outstandingKeys.has(key) && !seenAckedKeys.has(key)) {
      seenAckedKeys.add(key);
      acknowledgedRows.push({ fromUserId: s.fromUserId, toUserId: s.toUserId, points: settledByPair[key] });
    }
  }

  const allRows = [...outstanding, ...acknowledgedRows];

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
          <SectionHeader title="Settlements" mb="mb-4" />
          {allRows.length === 0 ? (
            <p className="text-[var(--text-muted)] text-sm text-center">All settled up!</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-[var(--text-muted)] border-b border-[var(--border)]">
                    <th className="pb-2 pr-4 font-medium">From</th>
                    <th className="pb-2 pr-4 font-medium">To</th>
                    <th className="pb-2 pr-4 font-medium text-right">Points</th>
                    <th className="pb-2 font-medium text-right">Acknowledgement</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {allRows.map((s) => {
                    const key = `${s.fromUserId}-${s.toUserId}`;
                    const isAcknowledged = !outstandingKeys.has(key) && key in settledByPair;
                    const isRecipient = user?.uid === s.toUserId;
                    const isAcking = acknowledgingSettlements.has(key);
                    return (
                      <tr key={key}>
                        <td className="py-3 pr-4 text-[var(--text-primary)]">
                          {memberNames[s.fromUserId] ?? s.fromUserId}
                        </td>
                        <td className="py-3 pr-4 text-[var(--text-primary)]">
                          {memberNames[s.toUserId] ?? s.toUserId}
                        </td>
                        <td className="py-3 pr-4 text-right font-semibold text-[var(--text-primary)]">
                          {s.points} pts
                        </td>
                        <td className="py-3 text-right">
                          {isRecipient ? (
                            <button
                              disabled={isAcknowledged || isAcking}
                              onClick={() => handleAcknowledgeSettlement(s)}
                              className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors disabled:cursor-not-allowed ${
                                isAcknowledged
                                  ? 'bg-green-500/20 text-green-400 disabled:opacity-100'
                                  : isAcking
                                    ? 'bg-[var(--bg-input)] text-[var(--text-muted)] border border-[var(--border)]'
                                    : 'bg-green-500 hover:bg-green-600 text-white'
                              }`}
                            >
                              {isAcknowledged ? 'Received ✓' : isAcking ? 'Saving…' : 'Received'}
                            </button>
                          ) : (
                            <span className="text-[var(--text-muted)]">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </main>
    </div>
  );
}

export default function SettlementsPage() {
  return (
    <ProtectedRoute>
      <SettlementsContent />
    </ProtectedRoute>
  );
}
