'use client';

import { useEffect, useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import { RefreshCw, Plus, Trash2, ChevronDown, ChevronUp, Pencil, Check, X } from 'lucide-react';
import { Timestamp } from 'firebase/firestore';
import AppNavbar from '@/components/AppNavbar';
import { Button, Card, Spinner } from '@/components/ui';
import {
  getMasterSeries,
  saveMasterSeries,
  getMasterMatchesBySeriesId,
  updateMasterMatchStatus,
  type MasterSeries,
  type MasterMatch,
} from '@/lib/masterMatches';

const SYNC_SECRET = process.env.NEXT_PUBLIC_SYNC_SECRET ?? '';

// ── Status badge ──────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  upcoming: 'bg-blue-500/20 text-blue-400',
  live:      'bg-green-500/20 text-green-400',
  completed: 'bg-[var(--bg-input)] text-[var(--text-muted)]',
  abandoned: 'bg-yellow-500/20 text-yellow-400',
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[status] ?? 'bg-[var(--bg-input)] text-[var(--text-muted)]'}`}>
      {status}
    </span>
  );
}

// ── Match table for a series ──────────────────────────────────────────────────

function toDatetimeLocal(ts: MasterMatch['startsAt']): string {
  try {
    const d = typeof ts?.toDate === 'function'
      ? ts.toDate()
      : new Date((ts as unknown as { seconds: number }).seconds * 1000);
    // Format as YYYY-MM-DDTHH:mm in local time for datetime-local input
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return '';
  }
}

function formatDate(ts: MasterMatch['startsAt']): string {
  try {
    const d = typeof ts?.toDate === 'function'
      ? ts.toDate()
      : new Date((ts as unknown as { seconds: number }).seconds * 1000);
    return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch {
    return '—';
  }
}

function MatchTable({ series }: { series: MasterSeries }) {
  const [matches, setMatches] = useState<MasterMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [filling, setFilling] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);

  const loadMatches = useCallback(async () => {
    setLoading(true);
    try {
      const list = await getMasterMatchesBySeriesId(series.cricapiId);
      setMatches(list);
    } catch {
      toast.error('Failed to load matches');
    } finally {
      setLoading(false);
    }
  }, [series.cricapiId]);

  useEffect(() => {
    loadMatches();
  }, [loadMatches]);

  async function handleSaveDate(matchId: string) {
    if (!editValue) return;
    setSaving(true);
    try {
      const newDate = new Date(editValue); // local time from datetime-local input
      await updateMasterMatchStatus(matchId, { startsAt: Timestamp.fromDate(newDate) } as Parameters<typeof updateMasterMatchStatus>[1]);
      setMatches((prev) => prev.map((m) => m.id === matchId ? { ...m, startsAt: Timestamp.fromDate(newDate) } : m));
      setEditingId(null);
      toast.success('Date updated');
    } catch {
      toast.error('Failed to update date');
    } finally {
      setSaving(false);
    }
  }

  async function handleFill() {
    setFilling(true);
    try {
      const res = await fetch('/api/fill-matches', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-sync-secret': SYNC_SECRET,
        },
        body: JSON.stringify({ cricapiId: series.cricapiId, seriesName: series.name }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error ?? 'Fill failed');
      } else {
        toast.success(`Filled ${json.inserted} match(es)`);
        await loadMatches();
      }
    } catch {
      toast.error('Network error');
    } finally {
      setFilling(false);
    }
  }

  return (
    <div className="mt-3 space-y-3">
      <div className="flex items-center gap-2">
        <Button size="sm" variant="secondary" onClick={handleFill} loading={filling}>
          <RefreshCw className="h-3.5 w-3.5" />
          Fill / Refresh Matches
        </Button>
        <span className="text-xs text-[var(--text-muted)]">{matches.length} match(es) in DB</span>
      </div>

      {loading ? (
        <div className="flex justify-center py-6"><Spinner /></div>
      ) : matches.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)] py-2">No matches found. Click Fill to import from CricAPI.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-[var(--text-muted)] text-xs">
                <th className="text-left px-3 py-2 font-medium">Match</th>
                <th className="text-left px-3 py-2 font-medium">Date</th>
                <th className="text-left px-3 py-2 font-medium">Status</th>
                <th className="text-left px-3 py-2 font-medium">Result</th>
              </tr>
            </thead>
            <tbody>
              {matches.map((m) => (
                <tr key={m.id} className="border-b border-[var(--border)] last:border-0">
                  <td className="px-3 py-2 font-medium text-[var(--text-primary)]">
                    {m.teamAShort} vs {m.teamBShort}
                    <span className="block text-xs text-[var(--text-muted)] font-normal">{m.teamA} vs {m.teamB}</span>
                  </td>
                  <td className="px-3 py-2 text-[var(--text-secondary)] whitespace-nowrap">
                    {editingId === m.id ? (
                      <div className="flex items-center gap-1">
                        <input
                          type="datetime-local"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          className="bg-[var(--bg-input)] border border-[var(--border)] rounded px-2 py-1 text-xs text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-green-500"
                        />
                        <button
                          onClick={() => handleSaveDate(m.id)}
                          disabled={saving}
                          className="p-1 text-green-400 hover:text-green-300"
                        >
                          <Check className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 group">
                        <span>{formatDate(m.startsAt)}</span>
                        <button
                          onClick={() => { setEditingId(m.id); setEditValue(toDatetimeLocal(m.startsAt)); }}
                          className="p-0.5 opacity-0 group-hover:opacity-100 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-opacity"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={m.status} />
                  </td>
                  <td className="px-3 py-2 text-[var(--text-secondary)]">
                    {m.result === 'team_a' ? m.teamAShort
                      : m.result === 'team_b' ? m.teamBShort
                      : m.result}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Series row ────────────────────────────────────────────────────────────────

function SeriesRow({ series, onDeleted }: { series: MasterSeries; onDeleted: () => void }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card variant="default" className="p-0 overflow-hidden">
      <div
        className="w-full flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-[var(--bg-hover)] transition-colors"
        onClick={() => setExpanded((v) => !v)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && setExpanded((v) => !v)}
      >
        <div>
          <div className="flex items-center gap-2">
            <p className="font-semibold text-[var(--text-primary)]">{series.name}</p>
            {series.endDate && series.endDate.toDate() < new Date() && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--bg-input)] text-[var(--text-muted)]">ended</span>
            )}
          </div>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            CricAPI ID: {series.cricapiId}
            {series.endDate && (
              <span className="ml-2">
                · ends {series.endDate.toDate().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="p-1.5 rounded text-[var(--text-muted)] hover:text-red-400 hover:bg-red-500/10 transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              onDeleted();
            }}
            title="Remove series"
          >
            <Trash2 className="h-4 w-4" />
          </button>
          {expanded ? <ChevronUp className="h-4 w-4 text-[var(--text-muted)]" /> : <ChevronDown className="h-4 w-4 text-[var(--text-muted)]" />}
        </div>
      </div>
      {expanded && (
        <div className="px-4 pb-4 border-t border-[var(--border)]">
          <MatchTable series={series} />
        </div>
      )}
    </Card>
  );
}

// ── Add series form ───────────────────────────────────────────────────────────

function AddSeriesForm({ onAdded }: { onAdded: () => void }) {
  const [name, setName] = useState('');
  const [cricapiId, setCricapiId] = useState('');
  const [endDate, setEndDate] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !cricapiId.trim()) return;
    setSaving(true);
    try {
      await saveMasterSeries({
        name: name.trim(),
        cricapiId: cricapiId.trim(),
        ...(endDate ? { endDate: Timestamp.fromDate(new Date(endDate)) } : {}),
      });
      toast.success('Series added');
      setName('');
      setCricapiId('');
      setEndDate('');
      onAdded();
    } catch {
      toast.error('Failed to save series');
    } finally {
      setSaving(false);
    }
  }

  const INPUT_CLS = 'flex-1 bg-[var(--bg-input)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-green-500';

  return (
    <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-2 flex-wrap">
      <input
        className={INPUT_CLS}
        placeholder="Series name (e.g. IPL 2026)"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
      />
      <input
        className={INPUT_CLS}
        placeholder="CricAPI series UUID"
        value={cricapiId}
        onChange={(e) => setCricapiId(e.target.value)}
        required
      />
      <div className="flex flex-col gap-0.5">
        <label className="text-xs text-[var(--text-muted)] px-1">End date (optional)</label>
        <input
          type="date"
          className="bg-[var(--bg-input)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-green-500"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
        />
      </div>
      <Button type="submit" size="md" loading={saving} disabled={!name.trim() || !cricapiId.trim()}>
        <Plus className="h-4 w-4" />
        Add Series
      </Button>
    </form>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const [seriesList, setSeriesList] = useState<MasterSeries[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);

  const loadSeries = useCallback(async () => {
    setLoading(true);
    try {
      const list = await getMasterSeries();
      setSeriesList(list);
    } catch {
      toast.error('Failed to load series');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadSeries(); }, [loadSeries]);

  async function handleSync() {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch('/api/trigger-sync');
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error ?? 'Sync failed');
      } else {
        const msg = json.reason
          ? `Sync: ${json.reason}`
          : `Synced ${json.synced} match(es), ${json.apiCalls} API call(s)`;
        toast.success(msg);
        setSyncResult(JSON.stringify(json, null, 2));
      }
    } catch {
      toast.error('Network error during sync');
    } finally {
      setSyncing(false);
    }
  }

  function handleSeriesRemoved(series: MasterSeries) {
    // Just remove from local state — Firestore delete would need the doc ref.
    // For now, prompt user to remove manually.
    toast('Series hidden from view. To permanently delete, remove from Firestore console.', {
      icon: 'ℹ️',
    });
    setSeriesList((prev) => prev.filter((s) => s.id !== series.id));
  }

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <AppNavbar
        maxWidth="5xl"
        center={
          <span className="font-light text-[var(--text-primary)] text-sm sm:text-base">
            Admin
          </span>
        }
        tabs={[]}
      />

      <main className="max-w-5xl mx-auto px-2 py-8 space-y-8">

        {/* Sync section */}
        <section>
          <h2 className="text-base font-semibold text-[var(--text-primary)] mb-3">Match Sync</h2>
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
            <Button onClick={handleSync} loading={syncing} variant="primary">
              <RefreshCw className="h-4 w-4" />
              Sync Live Matches
            </Button>
            <p className="text-xs text-[var(--text-muted)]">
              Fetches latest status from CricAPI for all active matches.
            </p>
          </div>
          {syncResult && (
            <pre className="mt-3 text-xs bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-3 overflow-x-auto text-[var(--text-secondary)] max-h-48">
              {syncResult}
            </pre>
          )}
        </section>

        {/* Series section */}
        <section>
          <h2 className="text-base font-semibold text-[var(--text-primary)] mb-3">Series</h2>

          <Card variant="default" className="mb-4">
            <p className="text-sm font-medium text-[var(--text-primary)] mb-3">Add Series</p>
            <AddSeriesForm onAdded={loadSeries} />
          </Card>

          {loading ? (
            <div className="flex justify-center py-12"><Spinner size="xl" /></div>
          ) : seriesList.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No series added yet.</p>
          ) : (
            <div className="space-y-3">
              {seriesList.map((s) => (
                <SeriesRow key={s.id} series={s} onDeleted={() => handleSeriesRemoved(s)} />
              ))}
            </div>
          )}
        </section>

      </main>
    </div>
  );
}
