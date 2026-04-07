'use client';

export function getInviteLink(inviteCode: string): string {
  const baseUrl =
    typeof window === 'undefined'
      ? 'https://whowins.live'
      : window.location.origin;

  return `${baseUrl}/join/${inviteCode}`;
}

export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  throw new Error('Clipboard is not available in this browser.');
}
