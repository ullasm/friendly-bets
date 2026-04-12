import { runSync } from '@/lib/syncMatches';

export async function GET(): Promise<Response> {
  try {
    return await runSync();
  } catch (err) {
    console.error('[trigger-sync] Unhandled error:', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
