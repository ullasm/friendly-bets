'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Bet } from '@/lib/matches';
import type { GroupMember } from '@/lib/groups';

// ── Constants ────────────────────────────────────────────────────────────────

const MEMBER_COLUMN_WIDTH = 70;   // minWidth for each member column

// ── Types ───────────────────────────────────────────────────────────────────

interface MatchData {
  matchId: string;
  matchName: string;
  matchDate: Date;
  winner: string;
  teamA: string;
  teamB: string;
}

interface LedgerRow {
  type: 'match' | 'running-total';
  matchIndex: number;
  match?: MatchData;
  deltas?: Record<string, number | null>; // userId -> delta or null if no bet
  totals?: Record<string, number>; // userId -> running total
}

interface RunningTotalLedgerProps {
  members: GroupMember[];
  matches: MatchData[];
  bets: Bet[];
  currentUserId: string;
}

// ── Helper Functions ───────────────────────────────────────────────────────

/**
 * Format a date to display format (e.g., "2026-04-19")
 */
function formatDate(date: Date): string {
  return date.toLocaleDateString('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

/**
 * Format a number with sign (+ or -)
 */
function formatDelta(delta: number): string {
  return delta > 0 ? `+${delta}` : `${delta}`;
}

/**
 * Get winner display name from match result
 */
function getWinnerDisplay(match: MatchData): string {
  return match.winner;
}

// ── Member Filter Pill ───────────────────────────────────────────────────────

function MemberFilterPill({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
        active
          ? 'bg-[var(--accent-solid)] text-white'
          : 'bg-[var(--bg-input)] text-[var(--text-muted)] hover:text-[var(--text-primary)] border border-[var(--border)]'
      }`}
    >
      {label}
      <span className={active ? 'text-blue-200 ml-1' : 'text-[var(--text-muted)] ml-1'}>
        ({count})
      </span>
    </button>
  );
}

// ── Component ────────────────────────────────────────────────────────────────

export function RunningTotalLedger({
  members,
  matches,
  bets,
  currentUserId,
}: RunningTotalLedgerProps) {
  const tableRef = useRef<HTMLDivElement>(null);
  const topScrollRef = useRef<HTMLDivElement>(null);
  const [tableScrollWidth, setTableScrollWidth] = useState(0);

  // Sort matches by date (oldest first for chronological ledger)
  const sortedMatches = useMemo(() => {
    return [...matches].sort((a, b) => a.matchDate.getTime() - b.matchDate.getTime());
  }, [matches]);

  // Build a set of matchIds that have at least one settled bet
  const matchIdsWithBets = useMemo(() => {
    const settledStatuses = new Set(['won', 'lost', 'refunded', 'locked']);
    const matchIds = new Set<string>();
    bets.forEach((bet) => {
      if (settledStatuses.has(bet.status)) {
        matchIds.add(bet.matchId);
      }
    });
    return matchIds;
  }, [bets]);

  // Always filter to only show matches that have bets ("Betted" view)
  const filteredMatches = useMemo(() => {
    return sortedMatches.filter((m) => matchIdsWithBets.has(m.matchId));
  }, [sortedMatches, matchIdsWithBets]);

  // Count how many bets each member has in the filtered matches
  const memberBetCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    const filteredMatchIds = new Set(filteredMatches.map((m) => m.matchId));
    members.forEach((member) => {
      counts[member.userId] = bets.filter(
        (b) => b.userId === member.userId && filteredMatchIds.has(b.matchId) && b.pointsDelta !== null && b.status !== 'pending'
      ).length;
    });
    return counts;
  }, [members, filteredMatches, bets]);

  // Sort members: current user first, then by bet count descending
  const sortedMembers = useMemo(() => {
    return [...members].sort((a, b) => {
      // Current user always first
      if (a.userId === currentUserId) return -1;
      if (b.userId === currentUserId) return 1;
      // Then sort by bet count descending
      const countDiff = (memberBetCounts[b.userId] ?? 0) - (memberBetCounts[a.userId] ?? 0);
      if (countDiff !== 0) return countDiff;
      // Tie-break by display name
      return a.displayName.localeCompare(b.displayName);
    });
  }, [members, currentUserId, memberBetCounts]);

  // Default selection
  const [selectedMemberIds, setSelectedMemberIds] = useState<Set<string>>(() => {
    return new Set([currentUserId]);
  });

  // Set initial selection based on screen size
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const isDesktop = window.innerWidth >= 768;
      if (isDesktop) {
        // Select top 5 users (sortedMembers already has current user first, then by bet count)
        const top5Ids = sortedMembers.slice(0, 5).map(m => m.userId);
        setSelectedMemberIds(new Set(top5Ids));
      } else {
        setSelectedMemberIds(new Set([currentUserId]));
      }
    }
  }, [sortedMembers, currentUserId]);

  // Filter sortedMembers to only selected ones
  const visibleMembers = useMemo(() => {
    return sortedMembers.filter((m) => selectedMemberIds.has(m.userId));
  }, [sortedMembers, selectedMemberIds]);

  // Toggle a member's selection (always keep at least 1 selected)
  const toggleMember = useCallback((userId: string) => {
    setSelectedMemberIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) {
        if (next.size <= 1) return prev; // keep at least 1
        next.delete(userId);
      } else {
        next.add(userId);
      }
      return next;
    });
  }, []);

  // Build the ledger rows with running totals (only for visible members)
  const ledgerRows = useMemo((): LedgerRow[] => {
    const rows: LedgerRow[] = [];
    const runningTotals: Record<string, number> = {};

    // Initialize running totals to 0 for all visible members
    visibleMembers.forEach((member) => {
      runningTotals[member.userId] = 0;
    });

    filteredMatches.forEach((match, index) => {
      // Get bets for this match
      const deltas: Record<string, number | null> = {};

      visibleMembers.forEach((member) => {
        const bet = bets.find(
          (b) => b.matchId === match.matchId && b.userId === member.userId
        );

        // Calculate delta
        if (bet && bet.pointsDelta !== null && bet.status !== 'pending') {
          deltas[member.userId] = bet.pointsDelta;
          runningTotals[member.userId] += bet.pointsDelta;
        } else {
          deltas[member.userId] = null; // No bet or pending
        }
      });

      // Add match row
      rows.push({
        type: 'match',
        matchIndex: index,
        match,
        deltas,
      });

      // Add running total row
      rows.push({
        type: 'running-total',
        matchIndex: index,
        totals: { ...runningTotals },
      });
    });

    return rows;
  }, [visibleMembers, filteredMatches, bets]);

  // ── Dual Scrollbar Sync ──────────────────────────────────────────────────

  // Update the dummy div width whenever the table's scrollWidth changes
  useEffect(() => {
    const el = tableRef.current;
    if (!el) return;

    const updateWidth = () => {
      setTableScrollWidth(el.scrollWidth);
    };

    updateWidth();

    // Use ResizeObserver to react to layout changes
    const observer = new ResizeObserver(updateWidth);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ledgerRows, sortedMembers]);

  // Sync top scrollbar → bottom table
  const handleTopScroll = useCallback(() => {
    if (topScrollRef.current && tableRef.current) {
      tableRef.current.scrollLeft = topScrollRef.current.scrollLeft;
    }
  }, []);

  // Sync bottom table → top scrollbar
  const handleTableScroll = useCallback(() => {
    if (tableRef.current && topScrollRef.current) {
      topScrollRef.current.scrollLeft = tableRef.current.scrollLeft;
    }
  }, []);

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Member Filter Bar */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {sortedMembers.map((member) => (
          <MemberFilterPill
            key={member.userId}
            label={member.displayName}
            count={memberBetCounts[member.userId] ?? 0}
            active={selectedMemberIds.has(member.userId)}
            onClick={() => toggleMember(member.userId)}
          />
        ))}
      </div>

      {/* Table Container */}
      <div className="relative">
        {/* Top Scrollbar — synced with the table scroll */}
        {tableScrollWidth > 0 && (
          <div
            ref={topScrollRef}
            onScroll={handleTopScroll}
            className="ledger-top-scrollbar"
          >
            <div style={{ width: tableScrollWidth, height: 1 }} />
          </div>
        )}
        <div
          ref={tableRef}
          onScroll={handleTableScroll}
          className="overflow-x-auto ledger-scroll-container"
        >
          <table className="w-full border-collapse">
            <thead>
              <tr className="text-left">
                {/* Sticky first column — Date + Match / Result merged */}
                <th
                  className="sticky top-0 left-0 z-30 py-2 px-2 text-xs font-medium text-[var(--text-muted)] bg-[#1a2235] border-b border-r border-[var(--border)] shadow-[4px_0_10px_-2px_rgba(0,0,0,0.5)] min-w-[120px] sm:min-w-[240px] max-w-[50vw] whitespace-normal"
                >
                  Date / Match / Result
                </th>
                {/* Member columns — z-20 so they scroll under the sticky group headers */}
                {visibleMembers.map((member) => (
                  <th
                    key={member.userId}
                    className="sticky top-0 z-20 py-2 px-2 text-xs font-medium text-[var(--text-primary)] bg-[#1a2235] border-b border-[var(--border)] text-center"
                    style={{ minWidth: `${MEMBER_COLUMN_WIDTH}px` }}
                  >
                    {member.displayName}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {ledgerRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={1 + visibleMembers.length}
                    className="py-8 text-center text-xs text-[var(--text-muted)]"
                  >
                    No matches with bets yet.
                  </td>
                </tr>
              ) : (
                ledgerRows.map((row) => {
                  const isRunningTotal = row.type === 'running-total';

                  return (
                    <tr
                      key={`${row.type}-${row.matchIndex}`}
                      className={isRunningTotal ? 'bg-[#16202e]' : ''}
                    >
                      {/* Sticky merged column — Date + Match / Result — shadow creates visual edge when scrolling */}
                      <td
                        className="sticky-col sticky left-0 z-10 py-1.5 px-2 text-xs text-[var(--text-primary)] border-r border-[var(--border)] bg-[#1a2235] shadow-[4px_0_10px_-2px_rgba(0,0,0,0.5)] min-w-[120px] sm:min-w-[240px] max-w-[50vw] whitespace-normal break-words"
                      >
                        {isRunningTotal ? (
                          <span className="text-[var(--text-muted)] text-[10px] font-medium tracking-wide uppercase">
                            Running Total
                          </span>
                        ) : (
                          <span className="text-xs">
                            <span className="text-[var(--text-muted)]">{formatDate(row.match!.matchDate)}</span>
                            <span className="mx-2 text-[var(--text-muted)]">—</span>
                            {row.match!.matchName}
                            <span className="text-[var(--text-muted)] ml-2">
                              — {getWinnerDisplay(row.match!)}
                            </span>
                          </span>
                        )}
                      </td>

                      {/* Member columns — no sticky, scroll horizontally */}
                      {visibleMembers.map((member) => {
                        if (isRunningTotal) {
                          const total = row.totals?.[member.userId] ?? 0;
                          return (
                            <td
                              key={member.userId}
                              className="py-1.5 px-2 text-center text-xs text-[var(--text-primary)] font-semibold"
                            >
                              {total}
                              <span className="text-[var(--text-muted)] opacity-60 ml-0.5 text-[10px]">pts</span>
                            </td>
                          );
                        } else {
                          const delta = row.deltas?.[member.userId];
                          const hasBet = delta !== null;

                          return (
                            <td key={member.userId} className="py-1.5 px-2 text-center text-xs">
                              {hasBet ? (
                                <span
                                  className={
                                    delta! > 0
                                      ? 'text-blue-400 font-medium'
                                      : delta! < 0
                                      ? 'text-red-400 font-medium'
                                      : 'text-[var(--text-muted)]'
                                  }
                                >
                                  {formatDelta(delta!)}
                                </span>
                              ) : (
                                <span className="text-[var(--text-muted)] opacity-50">-</span>
                              )}
                            </td>
                          );
                        }
                      })}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
