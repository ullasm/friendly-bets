import type { CricMatch } from '@/app/api/cricket/route';

export type { CricMatch };

// Lowercase set for case-insensitive matching
const IPL_TEAM_NAMES = new Set([
  'mi', 'csk', 'rcb', 'kkr', 'srh', 'rr', 'dc', 'pbks', 'gt', 'lsg',
  'mumbai indians', 'chennai super kings',
  'royal challengers bangalore', 'royal challengers bengaluru',
  'kolkata knight riders', 'sunrisers hyderabad',
  'rajasthan royals', 'delhi capitals', 'punjab kings',
  'gujarat titans', 'lucknow super giants',
]);

export async function getCricketMatches(): Promise<CricMatch[]> {
  const res = await fetch('/api/cricket');
  if (!res.ok) return [];
  const json = await res.json();
  return json.matches ?? [];
}

// Used by dashboard live scores — keeps only IPL matches.
// Case-insensitive to handle API name variations.
export function filterIPLMatches(matches: CricMatch[]): CricMatch[] {
  return matches.filter((m) => {
    const nameLower = m.name.toLowerCase();
    if (nameLower.includes('ipl') || nameLower.includes('indian premier league')) return true;
    return m.teams.some((t) => IPL_TEAM_NAMES.has(t.toLowerCase()));
  });
}
