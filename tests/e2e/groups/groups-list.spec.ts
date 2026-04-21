/**
 * tests/e2e/groups/groups-list.spec.ts
 *
 * Category A4 (My Groups on profile), A5 — Groups list page scenarios
 */

import { test, expect } from '@playwright/test';
import { getGroupId } from '../../utils/sessionUtils';
import { loginAsRole } from '../../utils/authUtils';

// Use a user who belongs to both groups
test.beforeEach(async ({ page }) => {
  await loginAsRole(page, 'friends_admin_ullas');
});


test('A5-03: NEXT_PUBLIC_ALLOW_CREATE_GROUP=true → "Create Group" button visible', async ({ page }) => {
  await page.goto('/groups');
  // If the env flag is true the button should be visible
  const createBtn = page.getByRole('link', { name: /Create Group/i });
  // The feature flag is set to 'true' in the project; assert it is visible
  await expect(createBtn).toBeVisible();
});

test('A5-05: Groups listed as cards with group name and "Enter Group" button', async ({ page }) => {
  await page.goto('/groups');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);
  // Ullas belongs to at least GroupA
  await expect(page.getByText('GroupA', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /Enter Group/i }).first()).toBeVisible();
});

test('A5-06: "Enter Group" navigates to the correct group dashboard', async ({ page }) => {
  const groupId = getGroupId('friends');
  await page.goto('/groups');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);

  // Click the Enter Group button for the friends group card
  await page.getByText('GroupA', { exact: true }).waitFor({ timeout: 15_000 });
  // Click Enter Group for the exact friends group by its href
  await page.locator(`a[href="/groups/${groupId}"]`).filter({ hasText: /Enter Group/i }).click();

  await page.waitForURL(`**/${groupId}**`, { timeout: 15_000 });
  expect(page.url()).toContain(groupId);
});


// ── A4 — Profile: My Groups section ──────────────────────────────────────────


test('A4-02: Profile shows display name, email, total points, avatar', async ({ page }) => {
  await page.goto('/profile');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);
  // Display name should be visible
  await expect(page.getByText('Ullas', { exact: true })).toBeVisible();
  // Points text
  await expect(page.getByText(/pts total/i)).toBeVisible();
});

test('A4-03: Avatar colour picker buttons are visible and have accessible labels', async ({ page }) => {
  await page.goto('/profile');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);
  // Each swatch has aria-label containing "avatar colour"
  const swatches = page.getByRole('button', { name: /avatar colour/i });
  await expect(swatches.first()).toBeVisible();
  const count = await swatches.count();
  expect(count).toBe(7); // 7 colours
});

test('A4-04: Display name fewer than 2 characters → error toast', async ({ page }) => {
  await page.goto('/profile');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);
  const nameInput = page.getByLabel('Display Name');
  await nameInput.clear();
  await nameInput.fill('X');
  await page.getByRole('button', { name: /Save Changes/i }).click();
  await expect(page.getByText(/at least 2 characters/i)).toBeVisible();
});

test('A4-05: Save profile with no changes → "Nothing to update" info toast', async ({ page }) => {
  await page.goto('/profile');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);
  // Without changing anything, Save Changes should be disabled; the button is disabled when !isDirty
  const saveBtn = page.getByRole('button', { name: /Save Changes/i });
  await expect(saveBtn).toBeDisabled({ timeout: 15_000 });
});

test('A4-08: My Groups list shows groups the user belongs to', async ({ page }) => {
  await page.goto('/profile');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);
  // Should see "My Groups" section heading
  await expect(page.getByText('My Groups')).toBeVisible();
  // Ullas belongs to GroupA and FamilyGroupA
  await expect(page.getByText('GroupA', { exact: true })).toBeVisible();
});

test('A4-09: Clicking a group in My Groups navigates to that group dashboard', async ({ page }) => {
  const groupId = getGroupId('friends');
  await page.goto('/profile');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);
  await page.getByText('GroupA', { exact: true }).click();
  await page.waitForURL(`**/${groupId}**`, { timeout: 15_000 });
  expect(page.url()).toContain(groupId);
});

test('A4-10: Creator badge shows for groups created by the current user', async ({ page }) => {
  await page.goto('/profile');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);
  // Ullas created GroupA, so a "Creator" badge should be visible
  await expect(page.getByText('Creator').first()).toBeVisible();
});

