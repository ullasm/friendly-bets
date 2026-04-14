import {
  collection,
  doc,
  getDocs,
  setDoc,
  updateDoc,
  query,
  where,
  Timestamp,
} from 'firebase/firestore';
import { db } from './firebase';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MasterSeries {
  id: string;
  name: string;
  cricapiId: string;
  endDate?: Timestamp;
}

export type MasterMatchStatus = 'upcoming' | 'live' | 'completed' | 'abandoned';
export type MasterMatchResult = 'team_a' | 'team_b' | 'draw' | 'abandoned' | 'pending';

export interface MasterMatch {
  id: string;
  source: 'cricapi';
  sourceApiId: string;       // cricapiId of the series
  sourceMatchId: string;     // CricAPI match UUID (= doc ID)
  seriesName: string;
  teamA: string;
  teamAShort: string;
  teamB: string;
  teamBShort: string;
  startsAt: Timestamp;
  matchStarted: boolean;
  matchEnded: boolean;
  status: MasterMatchStatus;
  result: MasterMatchResult;
}

export interface SourceData {
  id: string;
  type: 'series_info' | 'match_info';
  api: 'cricapi';
  data: string;              // raw JSON.stringify of API response
  createdAt: Timestamp;
  parsed: boolean;
}

// ── Series ────────────────────────────────────────────────────────────────────

export async function getMasterSeries(): Promise<MasterSeries[]> {
  const snap = await getDocs(collection(db, 'masterSeries'));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as MasterSeries));
}

export async function saveMasterSeries(series: Omit<MasterSeries, 'id'> & { id?: string }): Promise<void> {
  const id = series.id ?? series.cricapiId;
  await setDoc(doc(db, 'masterSeries', id), { ...series, id }, { merge: true });
}

// ── Master Matches ────────────────────────────────────────────────────────────

export async function getMasterMatchesBySeriesId(cricapiId: string): Promise<MasterMatch[]> {
  const snap = await getDocs(
    query(
      collection(db, 'masterMatch'),
      where('sourceApiId', '==', cricapiId)
    )
  );
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() } as MasterMatch))
    .sort((a, b) => a.startsAt.toMillis() - b.startsAt.toMillis());
}

export async function getActiveMatches(): Promise<MasterMatch[]> {
  const snap = await getDocs(
    query(collection(db, 'masterMatch'), where('matchEnded', '==', false))
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as MasterMatch));
}

export async function upsertMasterMatch(
  match: Omit<MasterMatch, 'id'>
): Promise<void> {
  const id = match.sourceMatchId;
  await setDoc(doc(db, 'masterMatch', id), { ...match, id }, { merge: true });
}

export async function updateMasterMatchStatus(
  sourceMatchId: string,
  fields: Partial<Pick<MasterMatch, 'matchStarted' | 'matchEnded' | 'status' | 'result' | 'startsAt'>>
): Promise<void> {
  await updateDoc(doc(db, 'masterMatch', sourceMatchId), fields as Record<string, unknown>);
}

// ── Source Data ───────────────────────────────────────────────────────────────

export async function saveSourceData(
  payload: Omit<SourceData, 'id' | 'createdAt'>
): Promise<string> {
  const ref = doc(collection(db, 'sourceData'));
  const data: SourceData = {
    ...payload,
    id: ref.id,
    createdAt: Timestamp.now(),
  };
  await setDoc(ref, data);
  return ref.id;
}

export async function markSourceDataParsed(id: string): Promise<void> {
  await updateDoc(doc(db, 'sourceData', id), { parsed: true });
}

// ── Status / Result parsing ───────────────────────────────────────────────────

export function deriveStatus(matchStarted: boolean, matchEnded: boolean, result: MasterMatchResult): MasterMatchStatus {
  if (result === 'abandoned') return 'abandoned';
  if (matchEnded) return 'completed';
  if (matchStarted) return 'live';
  return 'upcoming';
}

export function parseResultFromStatus(
  statusText: string,
  teamA: string,
  teamAShort: string,
  teamB: string,
  teamBShort: string
): MasterMatchResult {
  const s = statusText.toLowerCase();
  if (s.includes('no result') || s.includes('abandoned')) return 'abandoned';
  if (s.includes('draw') || s.includes('tied')) return 'draw';
  if (s.includes(teamA.toLowerCase()) || s.includes(teamAShort.toLowerCase())) return 'team_a';
  if (s.includes(teamB.toLowerCase()) || s.includes(teamBShort.toLowerCase())) return 'team_b';
  return 'pending';
}
