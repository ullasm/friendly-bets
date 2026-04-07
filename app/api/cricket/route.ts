export const revalidate = 300; // cache for 5 minutes

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
    const [liveRes, upcomingRes] = await Promise.all([
      fetch(`https://api.cricapi.com/v1/currentMatches?apikey=${API_KEY}&offset=0`, {
        next: { revalidate: 300 },
      }),
      fetch(`https://api.cricapi.com/v1/matches?apikey=${API_KEY}&offset=0`, {
        next: { revalidate: 300 },
      }),
    ]);

    const [liveJson, upcomingJson] = await Promise.all([
      liveRes.ok ? liveRes.json() : Promise.resolve({ data: [] }),
      upcomingRes.ok ? upcomingRes.json() : Promise.resolve({ data: [] }),
    ]);

    const liveMatches: CricMatch[] = (liveJson.data ?? []).map((m: unknown) => normalise(m, true));
    const upcomingMatches: CricMatch[] = (upcomingJson.data ?? []).map((m: unknown) => normalise(m, false));

    // De-duplicate: upcoming list may overlap with live
    const liveIds = new Set(liveMatches.map((m) => m.id));
    const deduped = upcomingMatches.filter((m) => !liveIds.has(m.id));

    const matches = [...liveMatches, ...deduped];

    return Response.json({ matches });
  } catch {
    return Response.json({ matches: [] });
  }
}
