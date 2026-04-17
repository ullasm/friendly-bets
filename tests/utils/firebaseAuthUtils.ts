/**
 * tests/utils/firebaseAuthUtils.ts
 *
 * Authenticates a Playwright page by minting a Firebase custom token via the
 * Admin SDK and navigating to the test-only /test-auth page, which calls
 * signInWithCustomToken client-side. This avoids the signInWithEmailAndPassword
 * quota that would otherwise be exhausted by 150+ tests running in parallel.
 */

import type { Page } from '@playwright/test';
import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';

function initAdmin() {
  if (!admin.apps.length) {
    const keyPath = path.resolve(process.cwd(), 'serviceAccountKey.json');
    admin.initializeApp({
      credential: admin.credential.cert(
        JSON.parse(fs.readFileSync(keyPath, 'utf-8'))
      ),
    });
  }
}

export async function loginWithFirebase(
  page: Page,
  email: string,
  _password: string,
): Promise<void> {
  initAdmin();
  const { uid } = await admin.auth().getUserByEmail(email);
  const customToken = await admin.auth().createCustomToken(uid);

  await page.goto(`/test-auth?token=${encodeURIComponent(customToken)}`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForURL('**/groups**', { timeout: 30_000 });
}
