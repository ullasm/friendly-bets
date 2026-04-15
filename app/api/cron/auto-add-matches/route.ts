import { getAdminDb } from '@/lib/firebaseAdmin';

function inferFormat(seriesName: string): 'T20' | 'ODI' | 'Test' {
  const s = seriesName.toLowerCase();
  if (s.includes('test')) return 'Test';
  if (s.includes('odi') || s.includes('one day')) return 'ODI';
  return 'T20';
}

export async function runAutoAddMatches() {
  const db = getAdminDb();

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const cutoff = new Date(startOfToday.getTime() + 4 * 24 * 60 * 60 * 1000);

  // 1. Get upcoming masterMatches in the next 4 days
  const masterSnap = await db
    .collection('masterMatch')
    .where('matchEnded', '==', false)
    .where('startsAt', '>=', startOfToday)
    .where('startsAt', '<=', cutoff)
    .get();

  if (masterSnap.empty) {
    return { totalAdded: 0, reason: 'No upcoming matches in next 4 days' };
  }

  const upcoming = masterSnap.docs.map((d) => ({ id: d.id, ...d.data() } as {
    id: string;
    teamAShort: string;
    teamBShort: string;
    seriesName: string;
    matchStarted: boolean;
    startsAt: FirebaseFirestore.Timestamp;
    [key: string]: unknown;
  }));

  // 2. Get all groups
  const groupsSnap = await db.collection('groups').get();
  const groupIds = groupsSnap.docs.map((d) => d.id);

  const results: { groupId: string; added: string[]; errors: string[] }[] = [];

  for (const groupId of groupIds) {
    // 3. Get existing cricApiMatchIds for this group
    const existingSnap = await db
      .collection('matches')
      .where('groupId', '==', groupId)
      .get();

    const existingCricIds = new Set(
      existingSnap.docs
        .map((d) => d.data().cricApiMatchId as string | null)
        .filter((id): id is string => !!id)
    );

    const added: string[] = [];
    const errors: string[] = [];

    for (const mm of upcoming) {
      if (existingCricIds.has(mm.id)) continue;

      const format = inferFormat(mm.seriesName);
      const drawAllowed = format === 'Test';
      const status = mm.matchStarted ? 'live' : 'upcoming';

      try {
        await db.collection('matches').add({
          groupId,
          teamA: mm.teamAShort,
          teamB: mm.teamBShort,
          format,
          drawAllowed,
          noDrawPolicy: 'refund',
          matchDate: mm.startsAt,
          status,
          result: 'pending',
          bettingOpen: true,
          bettingClosedAt: null,
          cricApiMatchId: mm.id,
        });
        added.push(`${mm.teamAShort} vs ${mm.teamBShort}`);
      } catch (err) {
        errors.push(`${mm.id}: ${String(err)}`);
      }
    }

    results.push({ groupId, added, errors });
  }

  const totalAdded = results.reduce((s, r) => s + r.added.length, 0);
  return { totalAdded, results };
}

export async function GET(req: Request) {
  const auth = req.headers.get('authorization');
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const data = await runAutoAddMatches();
  return Response.json(data);
}
