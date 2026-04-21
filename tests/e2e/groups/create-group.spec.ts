/**
 * tests/e2e/groups/create-group.spec.ts
 *
 * Category A6 — Create Group page scenarios
 */

import { test, expect } from '@playwright/test';
import { deleteTestDocument } from '../../utils/firestoreUtils';
import { loginAsRole } from '../../utils/authUtils';

// ── Unauthenticated (no storageState) ─────────────────────────────────────────


test('A6-01: Unauthenticated → redirected to /login', async ({ page }) => {
  await page.goto('/groups/create');
  await page.waitForFunction(() => window.location.href.includes('/login'), { timeout: 15_000 });
  expect(page.url()).toContain('/login');
});


// ── Authenticated tests ───────────────────────────────────────────────────────

test.beforeEach(async ({ page }) => { await loginAsRole(page, 'friends_admin_ullas'); });

test('A6-02: Group name fewer than 3 characters → error toast', async ({ page }) => {
  await page.goto('/groups/create');
  await page.getByLabel('Group Name').fill('AB');
  await page.getByRole('button', { name: 'Create Group' }).click();
  await expect(page.getByText(/at least 3 characters/i)).toBeVisible();
});

test('A6-03: Valid name → group created → redirects to new group dashboard', async ({ page }) => {
  await page.goto('/groups/create');
  await page.getByLabel('Group Name').fill('Test Group Delete Me');
  await page.getByRole('button', { name: 'Create Group' }).click();

  await expect(page.getByText('Group created!')).toBeVisible();

  // Should redirect to the new group dashboard
  await page.waitForURL('**/groups/**', { timeout: 15_000 });
  const url = page.url();
  expect(url).toMatch(/\/groups\/[A-Za-z0-9]+$/);

  // Extract new groupId and clean up
  const match = url.match(/\/groups\/([A-Za-z0-9]+)$/);
  if (match) {
    const newGroupId = match[1];
    // Minimal cleanup: delete the group doc (full cascade teardown is Phase 4)
    await deleteTestDocument('groups', newGroupId);
  }
});

test('A6-04: "Back to Groups" link navigates to /groups', async ({ page }) => {
  await page.goto('/groups/create');
  await page.getByRole('link', { name: /Back to Groups/i }).click();
  await page.waitForURL('**/groups', { timeout: 10_000 });
  expect(page.url()).toMatch(/\/groups\/?$/);
});

test('A6-05: Creator is set as group admin — Matches tab appears after creation', async ({ page }) => {
  await page.goto('/groups/create');
  await page.getByLabel('Group Name').fill('Temp Admin Check Group');
  await page.getByRole('button', { name: 'Create Group' }).click();

  await page.waitForURL('**/groups/**', { timeout: 15_000 });

  // Admin should see the Matches tab
  await expect(page.getByRole('link', { name: 'Matches' })).toBeVisible();

  // Clean up
  const url = page.url();
  const match = url.match(/\/groups\/([A-Za-z0-9]+)/);
  if (match) {
    await deleteTestDocument('groups', match[1]);
  }
});

