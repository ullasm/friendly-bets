export const revalidate = 60; // cache for 1 minute

export interface CricMatch {
  id: string;
  name: string;
  teams: string[];
  date: string;
  dateTimeLocal: string;
  matchType: string;
  status: string;
  venue: string;
  score: string | null;
  isLive: boolean;
}

const API_KEY = process.env.NEXT_PUBLIC_CRICAPI_KEY ?? '';

function buildScore(scoreArr: Array<{ r?: number; w?: number; o?: number; inning?: string }> | undefined): string | null {
  if (!scoreArr || scoreArr.length === 0) return null;
  return scoreArr
    .map((s) => {
      const inning = s.inning ?? '';
      const runs = s.r != null ? s.r : '-';
      const wkts = s.w != null ? `/${s.w}` : '';
      const overs = s.o != null ? ` (${s.o} ov)` : '';
      return `${inning}: ${runs}${wkts}${overs}`;
    })
    .join(' | ');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalise(raw: any, isLive: boolean): CricMatch {
  return {
    id: raw.id ?? raw.unique_id ?? '',
    name: raw.name ?? '',
    teams: Array.isArray(raw.teams) ? raw.teams : [],
    date: raw.date ?? '',
    dateTimeLocal: raw.dateTimeLocal ?? raw.date ?? '',
    matchType: (raw.matchType ?? raw.match_type ?? '').toLowerCase(),
    status: raw.status ?? '',
    venue: raw.venue ?? '',
    score: buildScore(raw.score),
    isLive,
  };
}

export async function GET() {
  if (!API_KEY) {
    return Response.json({ matches: [] });
  }

  try {
    const [liveRes, upcomingRes, upcomingRes2] = await Promise.all([
      fetch(`https://api.cricapi.com/v1/currentMatches?apikey=${API_KEY}&offset=0`, {
        next: { revalidate: 60 },
      }),
      fetch(`https://api.cricapi.com/v1/matches?apikey=${API_KEY}&offset=0`, {
        next: { revalidate: 60 },
      }),
      fetch(`https://api.cricapi.com/v1/matches?apikey=${API_KEY}&offset=25`, {
        next: { revalidate: 60 },
      }),
    ]);

    const [liveJson, upcomingJson, upcomingJson2] = await Promise.all([
      liveRes.ok ? liveRes.json() : Promise.resolve({ data: [] }),
      upcomingRes.ok ? upcomingRes.json() : Promise.resolve({ data: [] }),
      upcomingRes2.ok ? upcomingRes2.json() : Promise.resolve({ data: [] }),
    ]);

    const liveMatches: CricMatch[] = (liveJson.data ?? []).map((m: unknown) => normalise(m, true));
    const upcomingRaw = [
      ...(upcomingJson.data ?? []),
      ...(upcomingJson2.data ?? []),
    ].map((m: unknown) => normalise(m, false));

    // De-duplicate across live + both upcoming pages
    const seen = new Set<string>(liveMatches.map((m) => m.id));
    const dedupedUpcoming = upcomingRaw.filter((m) => {
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    });

    // Filter out matches more than 24 hours in the past
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const all = [...liveMatches, ...dedupedUpcoming].filter((m) => {
      const t = new Date(m.dateTimeLocal || m.date).getTime();
      return isNaN(t) || t >= cutoff;
    });

    // Sort by date ascending so upcoming matches appear first
    all.sort((a, b) => {
      const da = new Date(a.dateTimeLocal || a.date).getTime();
      const db = new Date(b.dateTimeLocal || b.date).getTime();
      if (isNaN(da) && isNaN(db)) return 0;
      if (isNaN(da)) return 1;
      if (isNaN(db)) return -1;
      return da - db;
    });

    return Response.json({ matches: all });
  } catch {
    return Response.json({ matches: [] });
  }
}
