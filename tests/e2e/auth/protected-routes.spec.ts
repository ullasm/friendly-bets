/**
 * tests/e2e/auth/protected-routes.spec.ts
 *
 * A1 — Home redirect behaviour
 * A4-01 — Profile protected route
 * A5-01 — Groups protected route
 */

import { test, expect } from '@playwright/test';
import { getGroupId } from '../../utils/sessionUtils';
import { loginAsRole } from '../../utils/authUtils';

// ── A1: Home route ────────────────────────────────────────────────────────────


test('A1-01: Unauthenticated visit to / → redirects to /login', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.location.href.includes('/login'), { timeout: 15_000 });
  expect(page.url()).toContain('/login');
});

test('A1-02: Authenticated visit to / → redirects to /groups', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await loginAsRole(page, 'friends_admin_ullas');

  await page.goto('/');
  await page.waitForURL('**/groups**', { timeout: 10_000 });
  expect(page.url()).toContain('/groups');

  await context.close();
});


// ── A4-01: Profile — unauthenticated ─────────────────────────────────────────


test('A4-01: Unauthenticated → redirected to /login?redirect=/profile', async ({ page }) => {
  await page.goto('/profile');
  await page.waitForFunction(() => window.location.href.includes('/login'), { timeout: 15_000 });
  expect(page.url()).toContain('/login');
  expect(page.url()).toContain('redirect');
  expect(page.url()).toContain('profile');
});


// ── A5-01: Groups — unauthenticated ──────────────────────────────────────────


test('A5-01: Unauthenticated → redirected to /login', async ({ page }) => {
  await page.goto('/groups');
  await page.waitForFunction(() => window.location.href.includes('/login'), { timeout: 15_000 });
  expect(page.url()).toContain('/login');
});


// ── Group sub-routes — unauthenticated ────────────────────────────────────────


test('Unauthenticated visit to /groups/[groupId] → redirects to /login', async ({ page }) => {
  const groupId = getGroupId('friends');
  await page.goto(`/groups/${groupId}`);
  await page.waitForFunction(() => window.location.href.includes('/login'), { timeout: 15_000 });
  expect(page.url()).toContain('/login');
});

test('Unauthenticated visit to /groups/[groupId]/matches → redirects to /login', async ({ page }) => {
  const groupId = getGroupId('friends');
  await page.goto(`/groups/${groupId}/matches`);
  await page.waitForFunction(() => window.location.href.includes('/login'), { timeout: 15_000 });
  expect(page.url()).toContain('/login');
});

test('Unauthenticated visit to /groups/[groupId]/points → redirects to /login', async ({ page }) => {
  const groupId = getGroupId('friends');
  await page.goto(`/groups/${groupId}/points`);
  await page.waitForFunction(() => window.location.href.includes('/login'), { timeout: 15_000 });
  expect(page.url()).toContain('/login');
});

test('Unauthenticated visit to /groups/create → redirects to /login', async ({ page }) => {
  await page.goto('/groups/create');
  await page.waitForFunction(() => window.location.href.includes('/login'), { timeout: 15_000 });
  expect(page.url()).toContain('/login');
});

