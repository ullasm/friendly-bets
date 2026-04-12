import * as admin from 'firebase-admin';
import type { Firestore } from 'firebase-admin/firestore';

let _adminDb: Firestore | null = null;

export function getAdminDb(): Firestore {
  if (_adminDb) return _adminDb;

  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!serviceAccount) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY env var is not set');
  }

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(serviceAccount)),
    });
  }

  _adminDb = admin.firestore();
  return _adminDb;
}
