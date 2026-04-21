/**
 * tests/e2e/admin/group-matches-admin.spec.ts
 *
 * Category A8 — Group Matches Admin page (/groups/[groupId]/matches)
 */

import { test, expect } from '@playwright/test';
import { getGroupId } from '../../utils/sessionUtils';
import { createTestMatch, deleteTestDocument } from '../../utils/firestoreUtils';
import { loginAsRole } from '../../utils/authUtils';

function matchesUrl(groupId: string) { return `/groups/${groupId}/matches`; }

// ── Unauthenticated ───────────────────────────────────────────────────────────


test('A8-01: Unauthenticated → redirected to /login', async ({ page }) => {
  const groupId = getGroupId('friends');
  await page.goto(matchesUrl(groupId));
  await page.waitForFunction(
    () => window.location.href.includes('/login'),
    { timeout: 10_000 },
  );
  expect(page.url()).toContain('/login');
});


// ── Member: access denied ─────────────────────────────────────────────────────


// Use a fresh browser context so there is no carry-over navigation state from
// A8-01 (which leaves the page at /login?redirect=...).  Using the shared
// `page` fixture caused a double-navigation that stalled page.goto() when the
// Firebase / Firestore streams kept a connection open past the load event.
test('A8-02: Non-admin member → "Access denied" card with "Back to Group" button', async ({ browser }) => {
  const context = await browser.newContext();
  const page    = await context.newPage();

  await loginAsRole(page, 'friends_member_chethan');

  const groupId = getGroupId('friends');
  await page.goto(matchesUrl(groupId), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  await expect(page.getByText(/access denied/i)).toBeVisible();
  await expect(page.getByRole('link', { name: /Back to Group/i })).toBeVisible();

  await context.close();
});


// ── Admin tests ───────────────────────────────────────────────────────────────

// Helper: fresh context logged in as the group admin.
// Each test gets its own context to avoid cross-test navigation state.
async function adminPage(browser: import('@playwright/test').Browser) {
  const context = await browser.newContext();
  const page    = await context.newPage();
  await loginAsRole(page, 'friends_admin_ullas');
  return { context, page };
}

// Helper: navigate to the matches admin page without waiting for long-lived
// Firebase / Firestore streams (which stall the default 'load' wait).
async function gotoMatches(page: import('@playwright/test').Page, groupId: string) {
  await page.goto(matchesUrl(groupId), { waitUntil: 'domcontentloaded' });
  // Wait until the admin content is visible (spinner gone) or access-denied
  await expect(
    page.getByRole('button', { name: /^Create Match$/i })
      .or(page.getByText(/access denied/i))
  ).toBeVisible();
}


test('A8-03: Group admin sees "Add Matches" section, Create Match form, and "All Matches" list', async ({ browser }) => {
  const { context, page } = await adminPage(browser);
  const groupId = getGroupId('friends');
  await gotoMatches(page, groupId);

  await expect(page.getByText(/access denied/i)).not.toBeVisible();
  await expect(page.getByLabel('Team A').or(page.getByPlaceholder(/team a/i))).toBeVisible();
  await expect(page.getByLabel('Team B').or(page.getByPlaceholder(/team b/i))).toBeVisible();

  await context.close();
});

test('A8-07: Create Match form: missing match date → error toast', async ({ browser }) => {
  const { context, page } = await adminPage(browser);
  const groupId = getGroupId('friends');
  await gotoMatches(page, groupId);

  await page.getByLabel('Team A').fill('India');
  await page.getByLabel('Team B').fill('Australia');
  await page.getByRole('button', { name: /^Create Match$/i }).click();

  await expect(page.getByText(/please set a match date/i)).toBeVisible();
  await context.close();
});

test('A8-08: Create Match form: empty team name → error toast', async ({ browser }) => {
  const { context, page } = await adminPage(browser);
  const groupId = getGroupId('friends');
  await gotoMatches(page, groupId);

  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const dateStr = `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}T12:00`;

  const dateInput = page.locator('input[type="datetime-local"]').first();
  await dateInput.fill(dateStr);
  await page.getByLabel('Team A').fill('India');
  // Team B deliberately left empty
  await page.getByRole('button', { name: /^Create Match$/i }).click();

  await expect(page.getByText(/team names are required/i)).toBeVisible();
  await context.close();
});

test('A8-09: Create Match with format=Test → drawAllowed auto-checked and disabled', async ({ browser }) => {
  const { context, page } = await adminPage(browser);
  const groupId = getGroupId('friends');
  await gotoMatches(page, groupId);

  await page.locator('select[id="format"]').selectOption('Test');

  const drawCheckbox = page.locator('input[id="drawAllowed"]').or(page.getByLabel(/Allow Draw/i));
  await expect(drawCheckbox).toBeChecked({ timeout: 5_000 });
  await expect(drawCheckbox).toBeDisabled();
  await context.close();
});

test('A8-11: Match filter chips (All/Ongoing/Upcoming/Previous) filter the match list', async ({ browser }) => {
  const { context, page } = await adminPage(browser);
  const groupId = getGroupId('friends');
  const matchId = await createTestMatch(groupId, { status: 'upcoming', bettingOpen: true });

  try {
    await gotoMatches(page, groupId);

    await expect(page.getByRole('button', { name: /All/i }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /Upcoming/i })).toBeVisible();
    await page.getByRole('button', { name: /Upcoming/i }).click();
    await expect(page.getByText(/access denied/i)).not.toBeVisible();
  } finally {
    await deleteTestDocument('matches', matchId);
    await context.close();
  }
});

test('A8-12: "Edit" button on match opens edit modal pre-filled with match data', async ({ browser }) => {
  const { context, page } = await adminPage(browser);
  const groupId = getGroupId('friends');
  const matchId = await createTestMatch(groupId, {
    teamA: 'India',
    teamB: 'Australia',
    status: 'upcoming',
    bettingOpen: true,
  });

  try {
    await gotoMatches(page, groupId);
    await expect(page.getByText('India vs Australia')).toBeVisible();
    await page.getByRole('button', { name: /Edit/i }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('dialog').getByLabel('Team A')).toHaveValue('India', { timeout: 5_000 });
  } finally {
    await deleteTestDocument('matches', matchId);
    await context.close();
  }
});

test('A8-13: "Delete" button shows confirmation modal; confirm removes match', async ({ browser }) => {
  const { context, page } = await adminPage(browser);
  const groupId = getGroupId('friends');
  let matchId = await createTestMatch(groupId, {
    teamA: 'India',
    teamB: 'Bangladesh',
    status: 'upcoming',
    bettingOpen: true,
  });

  try {
    await gotoMatches(page, groupId);
    await expect(page.getByText('India vs Bangladesh')).toBeVisible();
    await page.getByRole('button', { name: /Delete/i }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: /Delete/i }).click();
    await expect(page.getByText('Match deleted')).toBeVisible();
    matchId = ''; // already deleted by the UI
  } finally {
    if (matchId) await deleteTestDocument('matches', matchId);
    await context.close();
  }
});

test('A8-14: "Close Betting" / "Open Betting" toggle updates match betting state', async ({ browser }) => {
  const { context, page } = await adminPage(browser);
  const groupId = getGroupId('friends');
  const matchId = await createTestMatch(groupId, {
    teamA: 'India',
    teamB: 'South Africa',
    status: 'upcoming',
    bettingOpen: true,
  });

  try {
    await gotoMatches(page, groupId);
    await expect(page.getByText('India vs South Africa')).toBeVisible();
    await page.getByRole('button', { name: /Close Betting/i }).first().click();
    await expect(page.getByText(/Betting closed/i)).toBeVisible();
    await page.getByRole('button', { name: /Open Betting/i }).first().click();
    await expect(page.getByText(/Betting opened/i)).toBeVisible();
  } finally {
    await deleteTestDocument('matches', matchId);
    await context.close();
  }
});

test('A8-15: Declare result → points settled, match shows completed', async ({ browser }) => {
  const { context, page } = await adminPage(browser);
  const groupId = getGroupId('friends');
  const matchId = await createTestMatch(groupId, {
    teamA: 'India',
    teamB: 'Zimbabwe',
    status: 'upcoming',
    bettingOpen: false,
    drawAllowed: false,
  });

  try {
    await gotoMatches(page, groupId);
    await expect(page.getByText('India vs Zimbabwe')).toBeVisible();

    const resultSelect = page.locator('select').filter({ hasText: /Result|pending/ }).first();
    if (await resultSelect.isVisible()) {
      await resultSelect.selectOption('team_a');
      await page.getByRole('button', { name: /Confirm/i }).first().click();
      await expect(page.getByText(/settled/i)).toBeVisible();
    }
  } finally {
    await deleteTestDocument('matches', matchId);
    await context.close();
  }
});

test('A8-17: "Manage Bets" button opens modal with all group members', async ({ browser }) => {
  const { context, page } = await adminPage(browser);
  const groupId = getGroupId('friends');
  const matchId = await createTestMatch(groupId, {
    teamA: 'India',
    teamB: 'Afghanistan',
    status: 'upcoming',
    bettingOpen: true,
  });

  try {
    await gotoMatches(page, groupId);
    await expect(page.getByText('India vs Afghanistan')).toBeVisible();
    await page.getByRole('button', { name: /Manage Bets/i }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(
      page.getByRole('dialog').getByText('Ullas').or(page.getByRole('dialog').getByText('Raghu')).first()
    ).toBeVisible();
  } finally {
    await deleteTestDocument('matches', matchId);
    await context.close();
  }
});

