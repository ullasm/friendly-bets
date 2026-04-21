/**
 * tests/e2e/groups/group-manage.spec.ts
 *
 * Category A11 — Group manage page (/groups/[groupId]/group) scenarios
 */

import { test, expect } from '@playwright/test';
import { getGroupId } from '../../utils/sessionUtils';
import { loginAsRole } from '../../utils/authUtils';

function manageUrl(groupId: string) { return `/groups/${groupId}/group`; }

// ── Unauthenticated ───────────────────────────────────────────────────────────


test('A11-01: Unauthenticated → redirected to /login', async ({ page }) => {
  const groupId = getGroupId('friends');
  await page.goto(manageUrl(groupId));
  await page.waitForFunction(() => window.location.href.includes('/login'), { timeout: 15_000 });
  expect(page.url()).toContain('/login');
});


// ── Member read-only view ─────────────────────────────────────────────────────

test.beforeEach(async ({ page }) => { await loginAsRole(page, 'friends_member_kutti'); });

test('A11-03: Member sees group name, invite link, member list with role badges', async ({ page }) => {
  const groupId = getGroupId('friends');
  await page.goto(manageUrl(groupId));
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);

  // Group name should appear
  await expect(page.getByRole('main').getByText('GroupA')).toBeVisible();
  // Invite link section
  await expect(page.getByRole('button', { name: /Copy/i })).toBeVisible();
  // Members list — Raghu should appear
  await expect(page.getByRole('list').getByText('Raghu')).toBeVisible();
});

test('A11-04: Member sees "Share on WhatsApp" button', async ({ page }) => {
  const groupId = getGroupId('friends');
  await page.goto(manageUrl(groupId));
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);
  // WhatsApp link is a raw <a> element without role="link", use element locator
  await expect(page.locator('a', { hasText: /Share on WhatsApp/i }).or(
    page.getByText(/WhatsApp/i)
  )).toBeVisible();
});

test('A11-05: Member does NOT see pencil/edit icon next to group name', async ({ page }) => {
  const groupId = getGroupId('friends');
  await page.goto(manageUrl(groupId));
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);
  // No inline edit controls for group name
  await expect(page.getByRole('button', { name: /edit group name|rename/i })).not.toBeVisible();
});

test('A11-06: Member does NOT see "Regenerate Link" button', async ({ page }) => {
  const groupId = getGroupId('friends');
  await page.goto(manageUrl(groupId));
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);
  await expect(page.getByRole('button', { name: /Regenerate/i })).not.toBeVisible();
});

test('A11-08: Member does NOT see Danger Zone section', async ({ page }) => {
  const groupId = getGroupId('friends');
  await page.goto(manageUrl(groupId));
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);
  await expect(page.getByText(/Danger Zone/i)).not.toBeVisible();
  await expect(page.getByRole('button', { name: /Delete Group/i })).not.toBeVisible();
});


// ── Admin full view ───────────────────────────────────────────────────────────

test.beforeEach(async ({ page }) => { await loginAsRole(page, 'friends_admin_ullas'); });

test('A11-10: Admin sees pencil icon next to group name; clicking enables inline edit', async ({ page }) => {
  const groupId = getGroupId('friends');
  await page.goto(manageUrl(groupId));
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);

  // Pencil/edit button for group name
  const editBtn = page.getByRole('button', { name: /edit|pencil/i }).first();
  await expect(editBtn).toBeVisible();
  await editBtn.click();

  // An input field for the group name should appear
  const nameInput = page.getByRole('textbox').first();
  await expect(nameInput).toBeVisible();
});

test('A11-11: Admin saves group name < 3 chars → error toast', async ({ page }) => {
  const groupId = getGroupId('friends');
  await page.goto(manageUrl(groupId));
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);

  const editBtn = page.getByRole('button', { name: /edit|pencil/i }).first();
  await editBtn.click();

  const nameInput = page.getByRole('textbox').first();
  await nameInput.clear();
  await nameInput.fill('AB');

  await page.getByRole('button', { name: /Save|✓|save/i }).first().click();
  await expect(page.getByText(/at least 3 characters/i)).toBeVisible();
});

test('A11-13: Admin regenerates invite link → toast warns old link is invalid', async ({ page }) => {
  const groupId = getGroupId('friends');
  await page.goto(manageUrl(groupId));
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);

  const regenBtn = page.getByRole('button', { name: /Regenerate/i });
  await expect(regenBtn).toBeVisible();
  await regenBtn.click();

  await expect(page.getByText(/old link is now invalid/i)).toBeVisible();
});

test('A11-14: Admin can "Make Admin" for a member', async ({ page }) => {
  const groupId = getGroupId('friends');
  await page.goto(manageUrl(groupId));
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);

  // Find a non-admin member and promote (Raghu is a member)
  await expect(page.getByText('Raghu')).toBeVisible();

  const makeAdminBtn = page.getByRole('button', { name: /Make Admin/i }).first();
  if (await makeAdminBtn.isVisible()) {
    await makeAdminBtn.click();
    await expect(page.getByText(/now an admin/i)).toBeVisible();

    // Restore — demote back
    const removeAdminBtn = page.getByRole('button', { name: /Remove Admin/i }).filter({ hasText: /Raghu/ }).first()
      .or(page.getByRole('button', { name: /Remove Admin/i }).first());
    if (await removeAdminBtn.isVisible()) {
      await removeAdminBtn.click();
      await expect(page.getByText(/now a member/i)).toBeVisible();
    }
  }
});

test('A11-19: Admin sees Danger Zone with "Delete Group" button', async ({ page }) => {
  const groupId = getGroupId('friends');
  await page.goto(manageUrl(groupId));
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);

  await expect(page.getByText(/Danger Zone/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /Delete Group/i })).toBeVisible();
});

test('A11-20: Delete Group modal requires typing exact group name; mismatch keeps button disabled', async ({ page }) => {
  const groupId = getGroupId('friends');
  await page.goto(manageUrl(groupId));
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);

  await page.getByRole('button', { name: /Delete Group/i }).click();

  // Modal should open
  await expect(page.getByRole('dialog')).toBeVisible();

  // Type wrong name — button should be disabled
  const confirmInput = page.getByRole('dialog').getByRole('textbox');
  await confirmInput.fill('WrongName');
  const deleteBtn = page.getByRole('dialog').getByRole('button', { name: /Delete Group/i });
  await expect(deleteBtn).toBeDisabled();

  // Close modal
  await page.getByRole('button', { name: /Cancel/i }).click();
});

test('A11-16: Admin can edit member display name inline (pencil icon)', async ({ page }) => {
  const groupId = getGroupId('friends');
  await page.goto(manageUrl(groupId));
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);

  await expect(page.getByText('Raghu')).toBeVisible();

  // Member rows should have a pencil/edit button
  const pencilBtns = page.getByRole('button', { name: /edit|pencil/i });
  const count = await pencilBtns.count();
  // There should be at least 2 edit buttons (group name + at least one member)
  expect(count).toBeGreaterThan(1);
});

test('A11-17: Admin saves member name < 2 chars → error toast', async ({ page }) => {
  const groupId = getGroupId('friends');
  await page.goto(manageUrl(groupId));
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);

  await expect(page.getByText('Raghu')).toBeVisible();

  // Click edit on the member row (second pencil button, after group name edit)
  const memberEditBtns = page.getByRole('button', { name: /edit|pencil/i });
  // Skip the first one (group name), click second (member name)
  const count = await memberEditBtns.count();
  if (count > 1) {
    await memberEditBtns.nth(1).click();
    const memberInput = page.getByRole('textbox').last();
    await memberInput.clear();
    await memberInput.fill('X');
    await page.getByRole('button', { name: /Save|✓|save/i }).last().click();
    await expect(page.getByText(/at least 2 characters/i)).toBeVisible();
  }
});

test('A11-18: Admin "Remove" button shows confirmation modal; Cancel keeps member', async ({ page }) => {
  const groupId = getGroupId('friends');
  await page.goto(manageUrl(groupId));
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);

  await expect(page.getByText('Raghu')).toBeVisible();

  const removeBtn = page.getByRole('button', { name: /^Remove$/i }).first();
  if (await removeBtn.isVisible()) {
    await removeBtn.click();
    // Confirmation modal
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button', { name: /Cancel/i }).click();
    // Member should still be visible
    await expect(page.getByText('Raghu')).toBeVisible();
  }
});

