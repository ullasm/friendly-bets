import { runFillAll } from '../fill-all/route';
import { runAutoAddMatches } from '../auto-add-matches/route';
import { runSync } from '@/lib/syncMatches';

export async function GET(req: Request) {
  const auth = req.headers.get('authorization');
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // 1. Fill all series API -> master matches
    const fillData = await runFillAll();

    // 2. Auto add 4-day upcoming master matches to user groups
    const autoAddData = await runAutoAddMatches();

    // 3. Sync live match state and settle
    const syncRes = await runSync();
    const syncData = await syncRes.json();

    return Response.json({
      success: true,
      fillAll: fillData,
      autoAddMatches: autoAddData,
      sync: syncData,
    });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
