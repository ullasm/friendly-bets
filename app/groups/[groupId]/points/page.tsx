
'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { collection, query, where, orderBy, onSnapshot, getDoc, doc, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import AppNavbar, { type NavTab } from '@/components/AppNavbar';
import ProtectedRoute from '@/components/ProtectedRoute';
import { useAuth } from '@/lib/AuthContext';
import { getGroupById, getUserGroupMember } from '@/lib/groups';
import type { Group, GroupMember } from '@/lib/groups';
import { computeSettlements, acknowledgeSettlement } from '@/lib/settlements';
import type { ComputedSettlement, Settlement } from '@/lib/settlements';
import { getLastNBetsForUser, getBetsForGroup, type Match, type Bet } from '@/lib/matches';
import { Spinner, Badge, Card, Avatar, SectionHeader } from '@/components/ui';

// Type for bet trend result
interface BetTrend {
  status: 'won' | 'lost' | 'refunded' | 'locked' | 'pending';
  pointsDelta: number | null;
  matchName: string;
}


const showSettlements = process.env.NEXT_PUBLIC_SHOW_SETTLEMENTS === 'true';

function PointsContent() {
  const params = useParams<{ groupId: string }>();
  const groupId = params.groupId;
  const { user } = useAuth();

  const [group, setGroup] = useState<Group | null>(null);
  const [myMember, setMyMember] = useState<GroupMember | null | undefined>(undefined);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [groupSettlements, setGroupSettlements] = useState<Settlement[]>([]);
  const [acknowledgingSettlements, setAcknowledgingSettlements] = useState<Set<string>>(new Set());
  const [confirmInputs, setConfirmInputs] = useState<Record<string, string>>({});
  const [memberBetTrends, setMemberBetTrends] = useState<Record<string, BetTrend[]>>({});
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
      async (snap) => {
        if (cancelled) return;
        const updated = snap.docs.map((d) => d.data() as GroupMember);
        setMembers(updated);
        const mine = updated.find((m) => m.userId === user.uid);
        if (mine) setMyMember(mine);
        
        // Fetch last 5 bets for each member with match details
        const trendsWithMatches: Record<string, BetTrend[]> = {};
        try {
          await Promise.all(
            updated.map(async (member) => {
              try {
                const bets = await getLastNBetsForUser(groupId, member.userId, 5);
                const betsWithMatchNames = await Promise.all(
                  bets.map(async (bet) => {
                    try {
                      const matchSnap = await getDoc(doc(db, 'matches', bet.matchId));
                      const matchData = matchSnap.exists() ? matchSnap.data() : null;
                      const matchName = matchData
                        ? `${matchData.teamA} vs ${matchData.teamB}`
                        : 'Unknown Match';
                      return {
                        status: bet.status,
                        pointsDelta: bet.pointsDelta,
                        matchName,
                      };
                    } catch (matchErr) {
                      console.error(`Error fetching match ${bet.matchId}:`, matchErr);
                      return {
                        status: bet.status,
                        pointsDelta: bet.pointsDelta,
                        matchName: 'Unknown Match',
                      };
                    }
                  })
                );
                trendsWithMatches[member.userId] = betsWithMatchNames;
              } catch (betsErr) {
                console.error(`[BetTrends] Error fetching bets for member ${member.displayName}:`, betsErr);
                trendsWithMatches[member.userId] = [];
              }
            })
          );
          
          if (!cancelled) {
            setMemberBetTrends(trendsWithMatches);
          }
        } catch (err) {
          console.error('Error fetching bet trends:', err);
        }
        
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

  // ── Settlements computation ───────────────────────────────────────────────
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

  const allSettlementRows = [...outstanding, ...acknowledgedRows];

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
          { label: 'Dashboard', href: `/groups/${groupId}` },
          { label: 'Points',    href: `/groups/${groupId}/points` },
          { label: 'Report',    href: `/groups/${groupId}/report` },
          ...(isAdmin ? [{ label: 'Matches', href: `/groups/${groupId}/matches` }] as NavTab[] : []),
          { label: 'Group',     href: `/groups/${groupId}/group` },
        ]}
      />

      <main className="max-w-5xl mx-auto px-2 py-8 space-y-6">

        {/* Points leaderboard */}
        <Card variant="default">
          <SectionHeader title="Standings" mb="mb-4" />
          {members.length === 0 ? (
            <p className="text-[var(--text-muted)] text-sm text-center">No members yet</p>
          ) : (
            <div className="space-y-0">
              {members.map((m, i) => {
                const isMe = m.userId === user?.uid;
                const trends = memberBetTrends[m.userId] || [];
                return (
                  <div
                    key={m.userId}
                    className={`flex items-start py-3 px-3 ${
                      i < members.length - 1
                        ? 'border-b border-[var(--border)]'
                        : ''
                    }`}
                  >
                    {/* Left column: Rank + Avatar (vertically centered) */}
                    <div className="flex items-center gap-3 shrink-0 pt-[6px]" style={{ minWidth: '72px' }}>
                      <span className="text-[var(--text-muted)] text-sm w-5 text-right shrink-0">{i + 1}.</span>
                      <Avatar name={m.displayName} color={m.avatarColor} size="sm" />
                    </div>
                    {/* Right column: Name + Badges + Points + Trending dots */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-sm text-[var(--text-primary)] truncate">{m.displayName}</span>
                          {isMe && (
                            <span className="text-[10px] text-green-500 font-medium shrink-0">(you)</span>
                          )}
                          {m.role === 'admin' && (
                            <Badge variant="role-admin" shape="tag" className="text-[10px] leading-none px-1.5 py-0.5 shrink-0">Admin</Badge>
                          )}
                        </div>
                        <span className="text-sm font-medium text-green-400 shrink-0 ml-2">
                          {m.totalPoints} pts
                        </span>
                      </div>
                      {/* Trending dots */}
                      <div className="flex items-center gap-[6px] mt-2">
                        {trends.length === 0 ? (
                          <span className="text-[10px] text-[var(--text-muted)]">No bets yet</span>
                        ) : (
                          <>
                            {trends.map((trend, idx) => {
                              const tooltipText = `${trend.matchName}: ${trend.pointsDelta && trend.pointsDelta > 0 ? '+' : ''}${trend.pointsDelta ?? 0} pts`;
                              let bgColor = 'rgba(100, 116, 139, 0.6)';
                              if (trend.status === 'won') bgColor = 'var(--accent-text, #5DADE2)';
                              else if (trend.status === 'lost') bgColor = 'rgba(248, 113, 113, 0.8)';
                              else if (trend.status === 'locked') bgColor = 'rgba(245, 158, 11, 0.8)';
                              return (
                                <div
                                  key={idx}
                                  className="bet-trend-dot"
                                  data-status={trend.status}
                                  title={tooltipText}
                                  style={{
                                    width: '12px',
                                    height: '12px',
                                    borderRadius: '50%',
                                    backgroundColor: bgColor,
                                    flexShrink: 0,
                                    opacity: 0.85,
                                    transition: 'opacity 0.15s ease, transform 0.15s ease',
                                    cursor: 'help',
                                  }}
                                  onMouseEnter={(e) => {
                                    e.currentTarget.style.opacity = '1';
                                    e.currentTarget.style.transform = 'scale(1.3)';
                                  }}
                                  onMouseLeave={(e) => {
                                    e.currentTarget.style.opacity = '0.85';
                                    e.currentTarget.style.transform = 'scale(1)';
                                  }}
                                />
                              );
                            })}
                            {/* Ghost dots for remaining slots */}
                            {Array.from({ length: 5 - trends.length }).map((_, idx) => (
                              <div
                                key={`ghost-${idx}`}
                                style={{
                                  width: '12px',
                                  height: '12px',
                                  borderRadius: '50%',
                                  border: '1px solid rgba(255, 255, 255, 0.1)',
                                  backgroundColor: 'transparent',
                                  flexShrink: 0,
                                }}
                              />
                            ))}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {/* Settlements */}
        {showSettlements && <Card variant="default">
          <SectionHeader title="Settlements" mb="mb-4" />
          {allSettlementRows.length === 0 ? (
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
                  {allSettlementRows.map((s) => {
                    const key = `${s.fromUserId}-${s.toUserId}`;
                    const isAcknowledged = !outstandingKeys.has(key) && key in settledByPair;
                    const isRecipient = user?.uid === s.toUserId;
                    const isAcking = acknowledgingSettlements.has(key);
                    const expectedPhrase = `Received ${s.points}`;
                    const inputVal = confirmInputs[key] ?? '';
                    const isConfirmed = inputVal === expectedPhrase;
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
                          {isRecipient && !isAcknowledged ? (
                            <div className="flex flex-col items-end gap-1.5">
                              <span className="text-[10px] text-[var(--text-muted)]">
                                Type "{expectedPhrase}" then click Received
                              </span>
                              <div className="flex items-center gap-2">
                                <input
                                  type="text"
                                  value={inputVal}
                                  onChange={(e) => setConfirmInputs((prev) => ({ ...prev, [key]: e.target.value }))}
                                  placeholder={expectedPhrase}
                                  className="w-36 rounded-lg bg-[var(--bg-input)] border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-green-500"
                                />
                                <button
                                  disabled={!isConfirmed || isAcking}
                                  onClick={() => handleAcknowledgeSettlement(s)}
                                  className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors disabled:cursor-not-allowed ${
                                    isConfirmed && !isAcking
                                      ? 'bg-green-500 hover:bg-green-600 text-white'
                                      : 'bg-[var(--bg-input)] text-[var(--text-muted)] border border-[var(--border)] opacity-50'
                                  }`}
                                >
                                  {isAcking ? 'Saving…' : 'Received'}
                                </button>
                              </div>
                            </div>
                          ) : isRecipient && isAcknowledged ? (
                            <button
                              disabled
                              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-green-500/20 text-green-400 disabled:cursor-not-allowed disabled:opacity-100"
                            >
                              Received ✓
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
        </Card>}

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
