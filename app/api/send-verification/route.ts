import * as admin from 'firebase-admin';
import { getAdminDb } from '@/lib/firebaseAdmin';

export async function POST(req: Request): Promise<Response> {
  try {
    getAdminDb();
    const { uid } = await req.json();
    if (!uid) return Response.json({ error: 'uid required' }, { status: 400 });

    const auth = admin.auth();
    const user = await auth.getUser(uid);

    if (!user.email) return Response.json({ error: 'User has no email' }, { status: 400 });
    if (user.emailVerified) return Response.json({ message: 'Already verified' });

    const link = await auth.generateEmailVerificationLink(user.email);
    return Response.json({ email: user.email, verificationLink: link });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
