import { getMasterSeries, saveSourceData, markSourceDataParsed, upsertMasterMatch } from '@/lib/masterMatches';
import { fetchSeriesInfo, parseSeriesInfoToMatches } from '@/lib/cricapiSeries';

export async function runFillAll() {
  const allSeries = await getMasterSeries();
  const now = new Date();
  const series = allSeries.filter((s) => !s.endDate || s.endDate.toDate() >= now);
  const results: { seriesId: string; inserted?: number; skipped?: true; error?: string }[] = [];

  for (const s of series) {
    try {
      const raw = await fetchSeriesInfo(s.cricapiId);
      const sourceDataId = await saveSourceData({
        type: 'series_info',
        api: 'cricapi',
        data: JSON.stringify(raw),
        parsed: false,
      });
      const matches = parseSeriesInfoToMatches(raw, s.cricapiId, s.name);
      await Promise.all(matches.map((m) => upsertMasterMatch(m)));
      await markSourceDataParsed(sourceDataId);
      results.push({ seriesId: s.id, inserted: matches.length });
    } catch (err) {
      results.push({ seriesId: s.id, error: String(err) });
    }
  }

  return { results };
}

export async function GET(req: Request) {
  const auth = req.headers.get('authorization');
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const data = await runFillAll();
  return Response.json(data);
}
