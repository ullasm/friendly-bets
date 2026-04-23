'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Bet } from '@/lib/matches';
import type { GroupMember } from '@/lib/groups';

// ── Constants ────────────────────────────────────────────────────────────────

const MEMBER_COLUMN_WIDTH = 90;   // minWidth for each member column

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

type FilterOption = 'Betted' | 'Betted By Me' | 'All';

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

// ── Filter Pills ────────────────────────────────────────────────────────────

function FilterPill({
  label,
  active,
  onClick,
}: {
  label: FilterOption;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
        active
          ? 'bg-blue-600 text-white'
          : 'bg-[var(--bg-input)] text-[var(--text-muted)] hover:text-[var(--text-primary)] border border-[var(--border)]'
      }`}
    >
      {label}
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
  const [activeFilter, setActiveFilter] = useState<FilterOption>('Betted');
  const tableRef = useRef<HTMLDivElement>(null);
  const topScrollRef = useRef<HTMLDivElement>(null);
  const [tableScrollWidth, setTableScrollWidth] = useState(0);

  // Sort members by display name for consistent column ordering
  const sortedMembers = useMemo(() => {
    return [...members].sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [members]);

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

  // Build a set of matchIds where the current user has a bet
  const matchIdsWithMyBets = useMemo(() => {
    const settledStatuses = new Set(['won', 'lost', 'refunded', 'locked']);
    const matchIds = new Set<string>();
    bets.forEach((bet) => {
      if (bet.userId === currentUserId && settledStatuses.has(bet.status)) {
        matchIds.add(bet.matchId);
      }
    });
    return matchIds;
  }, [bets, currentUserId]);

  // Filter matches based on active filter
  const filteredMatches = useMemo(() => {
    if (activeFilter === 'All') return sortedMatches;
    if (activeFilter === 'Betted') {
      return sortedMatches.filter((m) => matchIdsWithBets.has(m.matchId));
    }
    // 'Betted By Me'
    return sortedMatches.filter((m) => matchIdsWithMyBets.has(m.matchId));
  }, [sortedMatches, activeFilter, matchIdsWithBets, matchIdsWithMyBets]);

  // Build the ledger rows with running totals (using filtered matches)
  const ledgerRows = useMemo((): LedgerRow[] => {
    const rows: LedgerRow[] = [];
    const runningTotals: Record<string, number> = {};

    // Initialize running totals to 0 for all members
    sortedMembers.forEach((member) => {
      runningTotals[member.userId] = 0;
    });

    filteredMatches.forEach((match, index) => {
      // Get bets for this match
      const deltas: Record<string, number | null> = {};

      sortedMembers.forEach((member) => {
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
  }, [sortedMembers, filteredMatches, bets]);

  // ── Dual Scrollbar Sync ──────────────────────────────────────────────────

  // Update the dummy div width whenever the table's scrollWidth changes
  useEffect(() => {
    const el = tableRef.current;
    if (!el) return;

    const updateWidth = () => {
      setTableScrollWidth(el.scrollWidth);
    };

    updateWidth();

    // Use ResizeObserver to react to layout changes (filter changes, etc.)
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

  const filterOptions: FilterOption[] = ['Betted', 'Betted By Me', 'All'];

  return (
    <div>
      {/* Filter Bar */}
      <div className="flex items-center gap-2 mb-4">
        {filterOptions.map((option) => (
          <FilterPill
            key={option}
            label={option}
            active={activeFilter === option}
            onClick={() => setActiveFilter(option)}
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
                {/* Sticky first column group headers — z-30 to stay above scrolling content */}
                <th
                  className="sticky top-0 left-0 z-30 py-2 px-2 text-xs font-medium text-[var(--text-muted)] bg-[#1a2235] border-b border-r border-[var(--border)] whitespace-nowrap"
                  style={{ minWidth: '100px' }}
                >
                  Date
                </th>
                <th
                  className="sticky top-0 left-[100px] z-30 py-2 px-2 text-xs font-medium text-[var(--text-muted)] bg-[#1a2235] border-b border-r border-[var(--border)] whitespace-nowrap"
                  style={{ minWidth: '140px' }}
                >
                  Match
                </th>
                <th
                  className="sticky top-0 left-[240px] z-30 py-2 px-2 text-xs font-medium text-[var(--text-muted)] bg-[#1a2235] border-b border-r border-[var(--border)] shadow-[4px_0_10px_-2px_rgba(0,0,0,0.5)]"
                  style={{ minWidth: '80px' }}
                >
                  Result
                </th>
                {/* Member columns — z-20 so they scroll under the sticky group headers */}
                {sortedMembers.map((member) => (
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
                    colSpan={3 + sortedMembers.length}
                    className="py-8 text-center text-xs text-[var(--text-muted)]"
                  >
                    {activeFilter === 'All'
                      ? 'No completed matches yet.'
                      : activeFilter === 'Betted'
                      ? 'No matches with bets yet.'
                      : 'You haven\'t placed any bets yet.'}
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
                      {/* Sticky Date column — z-10 to stay above horizontally scrolling cells */}
                      <td
                        className="sticky-col sticky left-0 z-10 py-1.5 px-2 text-xs text-[var(--text-primary)] border-r border-[var(--border)] whitespace-nowrap bg-[#1a2235]"
                      >
                        {isRunningTotal ? '' : formatDate(row.match!.matchDate)}
                      </td>

                      {/* Sticky Match column */}
                      <td
                        className="sticky-col sticky left-[100px] z-10 py-1.5 px-2 text-xs text-[var(--text-primary)] border-r border-[var(--border)] whitespace-nowrap bg-[#1a2235]"
                      >
                        {isRunningTotal ? (
                          <span className="text-[var(--text-muted)] text-[10px] font-medium tracking-wide uppercase">
                            Running Total
                          </span>
                        ) : (
                          <span className="text-xs">{row.match!.matchName}</span>
                        )}
                      </td>

                      {/* Sticky Result column — shadow creates visual edge when scrolling */}
                      <td
                        className="sticky-col sticky left-[240px] z-10 py-1.5 px-2 text-xs text-[var(--text-primary)] border-r border-[var(--border)] bg-[#1a2235] shadow-[4px_0_10px_-2px_rgba(0,0,0,0.5)]"
                      >
                        {isRunningTotal ? '' : (
                          <span className="text-xs">{getWinnerDisplay(row.match!)}</span>
                        )}
                      </td>

                      {/* Member columns — no sticky, scroll horizontally */}
                      {sortedMembers.map((member) => {
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
