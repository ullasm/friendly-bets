import * as admin from 'firebase-admin';
import { getAdminDb } from '@/lib/firebaseAdmin';

export async function GET(): Promise<Response> {
  try {
    // Ensure admin is initialised
    getAdminDb();

    const auth = admin.auth();
    const result = await auth.listUsers();

    const users = result.users.map((u) => ({
      uid:           u.uid,
      email:         u.email ?? null,
      emailVerified: u.emailVerified,
      providers:     u.providerData.map((p) => p.providerId),
      createdAt:     u.metadata.creationTime,
      lastSignIn:    u.metadata.lastSignInTime,
    }));

    // Separate email-only users (no Google provider)
    const emailOnlyUsers = users.filter(
      (u) => u.providers.includes('password') && !u.providers.includes('google.com')
    );

    return Response.json({ total: users.length, emailOnlyUsers, allUsers: users });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
