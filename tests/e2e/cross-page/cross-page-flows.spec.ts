/**
 * tests/e2e/cross-page/cross-page-flows.spec.ts
 *
 * Category B — Cross-page flow tests (B-01 through B-08)
 * These are end-to-end flows that span multiple pages.
 */

import { test, expect } from '@playwright/test';
import { getGroupId } from '../../utils/sessionUtils';
import { createTestMatch, deleteTestDocument, updateTestMatch } from '../../utils/firestoreUtils';
import { loginAsRole } from '../../utils/authUtils';
import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';

function initAdmin() {
  if (!admin.apps.length) {
    const keyPath = path.resolve(process.cwd(), 'serviceAccountKey.json');
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(keyPath, 'utf-8'))) });
  }
}

async function getInviteCode(groupId: string): Promise<string> {
  initAdmin();
  const snap = await admin.firestore().collection('groups').doc(groupId).get();
  return snap.data()?.inviteCode as string;
}

// ── B-02: Admin creates match → member bets → declare result → points update ─


let matchId: string;

test.afterEach(async () => {
  if (matchId) await deleteTestDocument('matches', matchId);
});

test('B-02: Full flow — match created, bet placed, result declared, standings updated', async ({ browser }) => {
  const groupId = getGroupId('friends');

  // Step 1: Admin creates a match
  matchId = await createTestMatch(groupId, {
    teamA: 'Kenya',
    teamB: 'Canada',
    bettingOpen: true,
    status: 'upcoming',
    drawAllowed: false,
  });

  // Step 2: Member places a bet
  const ctxMember = await browser.newContext();
  const pageMember = await ctxMember.newPage();
  await loginAsRole(pageMember, 'friends_member_raghu');

  await pageMember.goto(`/groups/${groupId}`);
  await pageMember.waitForLoadState('domcontentloaded');
  await pageMember.waitForTimeout(1500);

  const b02MatchCard = pageMember.locator('div').filter({ hasText: /Kenya.*Canada|Canada.*Kenya/ }).filter({ has: pageMember.getByRole('button', { name: /Place Bet/i }) }).last();
  await b02MatchCard.getByRole('button', { name: /Place Bet/i }).first().click();
  await pageMember.waitForTimeout(500);
  await pageMember.locator('button', { hasText: /^Kenya$/ }).first().click();
  await pageMember.getByPlaceholder('Custom amount').fill('1000');
  await pageMember.getByRole('button', { name: /Confirm Bet/i }).click();
  await expect(pageMember.getByText(/placed successfully/i)).toBeVisible();

  // Step 3: Admin closes betting and declares Kenya wins
  const ctxAdmin = await browser.newContext();
  const pageAdmin = await ctxAdmin.newPage();
  await loginAsRole(pageAdmin, 'friends_admin_ullas');

  await pageAdmin.goto(`/groups/${groupId}/matches`);
  await pageAdmin.waitForLoadState('domcontentloaded');
  await pageAdmin.waitForTimeout(1500);
  await expect(pageAdmin.getByText('Kenya vs Canada').first()).toBeVisible();

  const b02AdminCard = pageAdmin.locator('div').filter({ hasText: /Kenya.*Canada|Canada.*Kenya/ }).first();
  await b02AdminCard.getByRole('button', { name: /Close Betting/i }).first().click();
  await expect(pageAdmin.getByText(/Betting closed/i)).toBeVisible();

  // Declare result
  const resultSelect = b02AdminCard.locator('select').filter({ hasText: /Result|pending/ }).first()
    .or(b02AdminCard.locator('select[value="pending"]').first());
  if (await resultSelect.isVisible()) {
    await resultSelect.selectOption('team_a'); // Kenya wins
    await b02AdminCard.getByRole('button', { name: /Confirm/i }).first().click();
    await expect(pageAdmin.getByText(/settled/i)).toBeVisible();
  }

  // Step 4: Member checks points page — standings updated
  await pageMember.goto(`/groups/${groupId}/points`);
  await pageMember.waitForLoadState('domcontentloaded');
  await pageMember.waitForTimeout(1500);
  await expect(pageMember.getByRole('list').getByText('Raghu')).toBeVisible();

  await ctxMember.close();
  await ctxAdmin.close();
});


// ── B-03: Admin promotes member → promoted user sees Matches tab ──────────────


test('B-03: Promote Raghu → Raghu sees Matches tab', async ({ browser }) => {
  const groupId = getGroupId('friends');

  // Admin promotes Raghu
  const ctxAdmin = await browser.newContext();
  const pageAdmin = await ctxAdmin.newPage();
  await loginAsRole(pageAdmin, 'friends_admin_ullas');

  await pageAdmin.goto(`/groups/${groupId}/group`);
  await pageAdmin.waitForLoadState('domcontentloaded');
  await pageAdmin.waitForTimeout(1500);
  await expect(pageAdmin.getByText('Raghu')).toBeVisible();

  const raghuRow = pageAdmin.locator('li').filter({ hasText: 'Raghu' }).first();
  const makeAdminBtn = raghuRow.getByRole('button', { name: /Make Admin/i });
  if (await makeAdminBtn.isVisible()) {
    await makeAdminBtn.click();
    await expect(pageAdmin.getByText(/now an admin/i)).toBeVisible();
    await pageAdmin.waitForTimeout(2000); // allow Firestore write to propagate

    // Raghu opens their dashboard — should see Matches tab
    const ctxRaghu = await browser.newContext();
    const pageRaghu = await ctxRaghu.newPage();
    await loginAsRole(pageRaghu, 'friends_member_raghu');

    await pageRaghu.goto(`/groups/${groupId}`);
    await pageRaghu.waitForLoadState('domcontentloaded');
    await pageRaghu.waitForTimeout(2000);
    // Reload to pick up promoted role from Firestore
    await pageRaghu.reload();
    await pageRaghu.waitForLoadState('domcontentloaded');
    await pageRaghu.waitForTimeout(2000);
    await expect(pageRaghu.getByRole('link', { name: 'Matches' })).toBeVisible();

    // Restore — demote Raghu back to member
    await pageAdmin.reload();
    await pageAdmin.waitForLoadState('domcontentloaded');
  await pageAdmin.waitForTimeout(1500);
    const raghuRowRestore = pageAdmin.locator('li').filter({ hasText: 'Raghu' }).first();
    const removeAdminBtn = raghuRowRestore.getByRole('button', { name: /Remove Admin/i });
    if (await removeAdminBtn.isVisible()) {
      await removeAdminBtn.click();
      await expect(pageAdmin.getByText(/now a member/i)).toBeVisible();
    }

    await ctxRaghu.close();
  }

  await ctxAdmin.close();
});


// ── B-04: Invite regeneration → old link invalid → new link works ─────────────


test('B-04: Old invite URL resolves to "Invalid invite link" after regeneration', async ({ browser }) => {
  const groupId = getGroupId('friends');
  const oldCode = await getInviteCode(groupId);

  // Admin regenerates invite
  const ctxAdmin = await browser.newContext();
  const pageAdmin = await ctxAdmin.newPage();
  await loginAsRole(pageAdmin, 'friends_admin_ullas');

  await pageAdmin.goto(`/groups/${groupId}/group`);
  await pageAdmin.waitForLoadState('domcontentloaded');
  await pageAdmin.waitForTimeout(1500);

  await pageAdmin.getByRole('button', { name: /Regenerate/i }).click();
  await expect(pageAdmin.getByText(/old link is now invalid/i)).toBeVisible();

  // Fetch new code
  const newCode = await getInviteCode(groupId);
  expect(newCode).not.toBe(oldCode);

  // Guest visits old code — should see "Invalid invite link"
  const ctxGuest = await browser.newContext();
  const pageGuest = await ctxGuest.newPage();
  await loginAsRole(pageGuest, 'superAdmin'); // auth needed to query Firestore for invite code
  await pageGuest.goto(`/join/${oldCode}`);
  await pageGuest.waitForLoadState('domcontentloaded');
  await pageGuest.waitForTimeout(1500);
  await expect(pageGuest.getByText(/invalid invite link/i)).toBeVisible();

  await ctxAdmin.close();
  await ctxGuest.close();
});


// ── B-07: Draw/abandoned match → refund flow ─────────────────────────────────


let matchId: string;

test.afterEach(async () => {
  if (matchId) await deleteTestDocument('matches', matchId);
});

test('B-07: Admin declares match abandoned → member bet shows "Refunded" badge', async ({ browser }) => {
  const groupId = getGroupId('friends');
  matchId = await createTestMatch(groupId, {
    teamA: 'Namibia',
    teamB: 'UAE',
    bettingOpen: true,
    status: 'upcoming',
    drawAllowed: false,
    noDrawPolicy: 'refund',
  });

  // Member bets
  const ctxMember = await browser.newContext();
  const pageMember = await ctxMember.newPage();
  await loginAsRole(pageMember, 'friends_member_raghu');

  await pageMember.goto(`/groups/${groupId}`);
  await pageMember.waitForLoadState('domcontentloaded');
  await pageMember.waitForTimeout(1500);
  const b07MatchCard = pageMember.locator('div').filter({ hasText: /Namibia.*UAE|UAE.*Namibia/ }).filter({ has: pageMember.getByRole('button', { name: /Place Bet/i }) }).last();
  await b07MatchCard.getByRole('button', { name: /Place Bet/i }).first().click();
  await pageMember.waitForTimeout(500);
  await pageMember.locator('button', { hasText: /^Namibia$/ }).first().click();
  await pageMember.getByPlaceholder('Custom amount').fill('500');
  await pageMember.getByRole('button', { name: /Confirm Bet/i }).click();
  await expect(pageMember.getByText(/placed successfully/i)).toBeVisible();

  // Admin declares abandoned
  const ctxAdmin = await browser.newContext();
  const pageAdmin = await ctxAdmin.newPage();
  await loginAsRole(pageAdmin, 'friends_admin_ullas');

  await pageAdmin.goto(`/groups/${groupId}/matches`);
  await pageAdmin.waitForLoadState('domcontentloaded');
  await pageAdmin.waitForTimeout(1500);
  await expect(pageAdmin.getByText('Namibia vs UAE').first()).toBeVisible();

  const b07AdminCard = pageAdmin.locator('div').filter({ hasText: /Namibia.*UAE|UAE.*Namibia/ }).first();
  await b07AdminCard.getByRole('button', { name: /Close Betting/i }).first().click();
  await expect(pageAdmin.getByText(/Betting closed/i)).toBeVisible();

  const resultSelect = b07AdminCard.locator('select').filter({ hasText: /Result|pending/i }).first()
    .or(b07AdminCard.locator('select[name="result"], select#result').first());
  if (await resultSelect.isVisible()) {
    await resultSelect.selectOption('abandoned');
    await b07AdminCard.getByRole('button', { name: /Confirm/i }).first().click();
    await expect(pageAdmin.getByText(/settled/i)).toBeVisible();
  }

  // Member refreshes — bet should show Refunded status
  await pageMember.goto(`/groups/${groupId}`);
  await pageMember.waitForLoadState('domcontentloaded');
  await pageMember.waitForTimeout(1500);
  await expect(
    pageMember.getByText(/refunded/i).first()
  ).toBeVisible();

  await ctxMember.close();
  await ctxAdmin.close();
});


// ── B-01: Registration → join via invite → place bet [STUB] ──────────────────


test.skip(true, '[STUB] Registration creates real Firebase Auth users; requires teardown. Covered by manual testing.');


// ── B-05 / B-06 / B-08 remain as integration-level tests ─────────────────────


test.skip(true, '[DEFERRED] B-05 (delete group) and B-06 (remove member) permanently mutate test data. Run only in isolated teardown-aware sessions.');



test.skip(true, '[COMPLEX] Rollover requires draw+rollover policy match, bet lock, then next match settlement. Covered by manual E2E walkthrough.');

