import type { CricMatch } from '@/app/api/cricket/route';

export type { CricMatch };

const IPL_TEAMS = new Set([
  'MI', 'CSK', 'RCB', 'KKR', 'SRH', 'RR', 'DC', 'PBKS', 'GT', 'LSG',
  'Mumbai Indians', 'Chennai Super Kings', 'Royal Challengers Bangalore',
  'Royal Challengers Bengaluru', 'Kolkata Knight Riders', 'Sunrisers Hyderabad',
  'Rajasthan Royals', 'Delhi Capitals', 'Punjab Kings', 'Gujarat Titans',
  'Lucknow Super Giants',
]);

export async function getCricketMatches(): Promise<CricMatch[]> {
  const res = await fetch('/api/cricket');
  if (!res.ok) return [];
  const json = await res.json();
  return json.matches ?? [];
}

export function filterIPLMatches(matches: CricMatch[]): CricMatch[] {
  return matches.filter((m) => {
    if (m.name.includes('IPL')) return true;
    return m.teams.some((t) => IPL_TEAMS.has(t));
  });
}
