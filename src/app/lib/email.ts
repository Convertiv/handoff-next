import { Resend } from 'resend';

function appBaseUrl(): string {
  const u = process.env.HANDOFF_APP_URL?.replace(/\/+$/, '');
  return u || 'http://localhost:3000';
}

function fromAddress(): string {
  return process.env.RESEND_FROM ?? 'Handoff <onboarding@resend.dev>';
}

export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.info('[email] RESEND_API_KEY not set; skip sendPasswordResetEmail to', to, resetUrl);
    return;
  }
  const resend = new Resend(key);
  const { error } = await resend.emails.send({
    from: fromAddress(),
    to: [to],
    subject: 'Reset your Handoff password',
    html: `
      <p>You requested a password reset for your Handoff account.</p>
      <p><a href="${resetUrl}">Set a new password</a></p>
      <p>This link expires in one hour. If you did not request this, you can ignore this email.</p>
    `,
  });
  if (error) {
    console.error('[email] Resend error (password reset):', error);
    throw new Error(error.message ?? 'Failed to send email');
  }
}

export async function sendInviteEmail(to: string, inviteUrl: string, inviterName?: string | null): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.info('[email] RESEND_API_KEY not set; skip sendInviteEmail to', to, inviteUrl);
    return;
  }
  const resend = new Resend(key);
  const who = inviterName ? ` (${inviterName})` : '';
  const { error } = await resend.emails.send({
    from: fromAddress(),
    to: [to],
    subject: 'You have been invited to Handoff',
    html: `
      <p>You have been invited to join Handoff${who}.</p>
      <p><a href="${inviteUrl}">Choose your password</a> to activate your account.</p>
      <p>This link expires in one week.</p>
    `,
  });
  if (error) {
    console.error('[email] Resend error (invite):', error);
    throw new Error(error.message ?? 'Failed to send email');
  }
}

export { appBaseUrl };
