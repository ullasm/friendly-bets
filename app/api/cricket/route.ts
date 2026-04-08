import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';

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

interface CricApiDebug {
  currentMatches: number;
  matches0: number;
  matches25: number;
  matches50: number;
  total: number;
  source?: 'api' | 'cache';
  cacheAgeMinutes?: number;
  apiRequestCount?: number;
  limitReached?: boolean;
}

interface CricApiPayload {
  matches: CricMatch[];
  debug: CricApiDebug;
}

interface CricApiCacheDoc {
  request: {
    endpoints: string[];
    requestedAt: string;
  };
  response: CricApiPayload;
  timestamp: number;
  apiRequestCount: number;
}

const API_KEY = process.env.NEXT_PUBLIC_CRICAPI_KEY ?? '';
const CACHE_DOC_PATH = ['systemCache', 'cricapi-live-upcoming'] as const;
const CACHE_WINDOW_MS = 30 * 60 * 1000;
const API_REQUESTS_PER_REFRESH = 4;
const API_REQUEST_LIMIT = 100;

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

function buildEmptyPayload(debug: Partial<CricApiDebug> = {}): CricApiPayload {
  return {
    matches: [],
    debug: {
      currentMatches: 0,
      matches0: 0,
      matches25: 0,
      matches50: 0,
      total: 0,
      ...debug,
    },
  };
}

function withCacheDebug(payload: CricApiPayload, cacheAgeMinutes: number, apiRequestCount: number, limitReached = false): CricApiPayload {
  return {
    matches: payload.matches,
    debug: {
      ...payload.debug,
      source: 'cache',
      cacheAgeMinutes,
      apiRequestCount,
      limitReached,
    },
  };
}

async function getCacheDoc(): Promise<CricApiCacheDoc | null> {
  const snap = await getDoc(doc(db, ...CACHE_DOC_PATH));
  if (!snap.exists()) return null;
  return snap.data() as CricApiCacheDoc;
}

async function setCacheDoc(payload: CricApiPayload, endpoints: string[], apiRequestCount: number): Promise<void> {
  await setDoc(doc(db, ...CACHE_DOC_PATH), {
    request: {
      endpoints,
      requestedAt: new Date().toISOString(),
    },
    response: payload,
    timestamp: Date.now(),
    apiRequestCount,
  } satisfies CricApiCacheDoc);
}

export async function GET() {
  if (!API_KEY) {
    return Response.json(buildEmptyPayload({ source: 'cache', apiRequestCount: 0 }));
  }

  try {
    const now = Date.now();
    const cacheDoc = await getCacheDoc();
    const cachedAgeMs = cacheDoc ? now - cacheDoc.timestamp : Number.POSITIVE_INFINITY;
    const cachedAgeMinutes = cacheDoc ? Math.floor(cachedAgeMs / 60000) : 0;

    if (cacheDoc && cachedAgeMs < CACHE_WINDOW_MS) {
      return Response.json(withCacheDebug(cacheDoc.response, cachedAgeMinutes, cacheDoc.apiRequestCount));
    }

    const previousRequestCount = cacheDoc?.apiRequestCount ?? 0;
    if (previousRequestCount + API_REQUESTS_PER_REFRESH > API_REQUEST_LIMIT) {
      if (cacheDoc) {
        return Response.json(withCacheDebug(cacheDoc.response, cachedAgeMinutes, previousRequestCount, true));
      }

      return Response.json(
        buildEmptyPayload({ source: 'cache', apiRequestCount: previousRequestCount, limitReached: true }),
        { status: 429 }
      );
    }

    const endpoints = [
      `https://api.cricapi.com/v1/currentMatches?apikey=${API_KEY}&offset=0`,
      `https://api.cricapi.com/v1/matches?apikey=${API_KEY}&offset=0`,
      `https://api.cricapi.com/v1/matches?apikey=${API_KEY}&offset=25`,
      `https://api.cricapi.com/v1/matches?apikey=${API_KEY}&offset=50`,
    ];

    const [liveRes, upcomingRes, upcomingRes2, upcomingRes3] = await Promise.all(
      endpoints.map((endpoint) => fetch(endpoint, { cache: 'no-store' }))
    );

    const [liveJson, upcomingJson, upcomingJson2, upcomingJson3] = await Promise.all([
      liveRes.ok ? liveRes.json() : Promise.resolve({ data: [] }),
      upcomingRes.ok ? upcomingRes.json() : Promise.resolve({ data: [] }),
      upcomingRes2.ok ? upcomingRes2.json() : Promise.resolve({ data: [] }),
      upcomingRes3.ok ? upcomingRes3.json() : Promise.resolve({ data: [] }),
    ]);

    const rawCurrent: unknown[] = liveJson.data ?? [];
    const rawMatches0: unknown[] = upcomingJson.data ?? [];
    const rawMatches25: unknown[] = upcomingJson2.data ?? [];
    const rawMatches50: unknown[] = upcomingJson3.data ?? [];

    const liveMatches: CricMatch[] = rawCurrent.map((m) => normalise(m, true));
    const upcomingRaw: CricMatch[] = [...rawMatches0, ...rawMatches25, ...rawMatches50].map((m) => normalise(m, false));

    const seen = new Set<string>(liveMatches.map((m) => m.id));
    const dedupedUpcoming = upcomingRaw.filter((m) => {
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    });

    const all = [...liveMatches, ...dedupedUpcoming];
    all.sort((a, b) => {
      const da = new Date(a.dateTimeLocal || a.date).getTime();
      const db = new Date(b.dateTimeLocal || b.date).getTime();
      if (isNaN(da) && isNaN(db)) return 0;
      if (isNaN(da)) return 1;
      if (isNaN(db)) return -1;
      return da - db;
    });

    const payload: CricApiPayload = {
      matches: all,
      debug: {
        currentMatches: rawCurrent.length,
        matches0: rawMatches0.length,
        matches25: rawMatches25.length,
        matches50: rawMatches50.length,
        total: all.length,
        source: 'api',
        apiRequestCount: previousRequestCount + API_REQUESTS_PER_REFRESH,
      },
    };

    await setCacheDoc(payload, endpoints, previousRequestCount + API_REQUESTS_PER_REFRESH);

    return Response.json(payload);
  } catch (err) {
    console.error('[CricAPI] fetch error:', err);

    try {
      const cacheDoc = await getCacheDoc();
      if (cacheDoc) {
        const cacheAgeMinutes = Math.floor((Date.now() - cacheDoc.timestamp) / 60000);
        return Response.json(withCacheDebug(cacheDoc.response, cacheAgeMinutes, cacheDoc.apiRequestCount, true));
      }
    } catch (cacheErr) {
      console.error('[CricAPI] cache fallback error:', cacheErr);
    }

    return Response.json(buildEmptyPayload({ source: 'cache', limitReached: true }));
  }
}
