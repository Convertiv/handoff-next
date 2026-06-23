import { Resend } from 'resend';

function appBaseUrl(): string {
  // Check in priority order:
  //   1. HANDOFF_APP_URL — explicit override (recommended in .env.example)
  //   2. AUTH_URL — set by Next-Auth v5 on Vercel and most hosting platforms
  //   3. NEXTAUTH_URL — legacy Next-Auth v4 name, still common in older deploys
  // Fall back to localhost only in development.
  const candidates = [
    process.env.HANDOFF_APP_URL,
    process.env.AUTH_URL,
    process.env.NEXTAUTH_URL,
  ];
  for (const c of candidates) {
    const u = c?.trim().replace(/\/+$/, '');
    if (u) return u;
  }
  return 'http://localhost:3000';
}

function fromAddress(): string {
  return process.env.RESEND_FROM ?? 'Handoff <onboarding@resend.dev>';
}

function emailLayout(opts: { title: string; body: string; ctaLabel: string; ctaUrl: string; footnote?: string }): string {
  const { title, body, ctaLabel, ctaUrl, footnote } = opts;
  const base = appBaseUrl();
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#f4f4f5;padding:48px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;">

          <!-- Logo / wordmark -->
          <tr>
            <td align="center" style="padding-bottom:28px;">
              <a href="${base}" style="text-decoration:none;">
                <span style="font-size:20px;font-weight:700;letter-spacing:-0.5px;color:#09090b;">Handoff</span>
              </a>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background-color:#ffffff;border-radius:12px;border:1px solid #e4e4e7;padding:40px 40px 36px;">

              <!-- Title -->
              <p style="margin:0 0 12px;font-size:18px;font-weight:600;color:#09090b;line-height:1.3;">${title}</p>

              <!-- Body -->
              <p style="margin:0 0 28px;font-size:14px;color:#52525b;line-height:1.6;">${body}</p>

              <!-- CTA button -->
              <table role="presentation" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="border-radius:8px;background-color:#18181b;">
                    <a href="${ctaUrl}"
                       style="display:inline-block;padding:11px 22px;font-size:14px;font-weight:500;color:#ffffff;text-decoration:none;border-radius:8px;letter-spacing:0.01em;">
                      ${ctaLabel}
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Fallback link -->
              <p style="margin:24px 0 0;font-size:12px;color:#a1a1aa;line-height:1.5;">
                Or copy and paste this URL into your browser:<br/>
                <a href="${ctaUrl}" style="color:#71717a;word-break:break-all;">${ctaUrl}</a>
              </p>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding-top:24px;text-align:center;">
              <p style="margin:0;font-size:12px;color:#a1a1aa;line-height:1.6;">
                ${footnote ?? 'This email was sent by Handoff.'}
                <br/>If you did not expect this, you can safely ignore it.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
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
    html: emailLayout({
      title: 'Reset your password',
      body: 'We received a request to reset the password for your Handoff account. Click the button below to choose a new one. This link expires in one hour.',
      ctaLabel: 'Reset password',
      ctaUrl: resetUrl,
      footnote: 'You requested a password reset for your Handoff account.',
    }),
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
  const who = inviterName ? `<strong>${inviterName}</strong> has` : 'You have been';
  const { error } = await resend.emails.send({
    from: fromAddress(),
    to: [to],
    subject: 'You have been invited to Handoff',
    html: emailLayout({
      title: "You're invited to Handoff",
      body: `${who} invited you to join Handoff — a design system collaboration platform. Click the button below to set your password and activate your account. This link expires in one week.`,
      ctaLabel: 'Accept invite',
      ctaUrl: inviteUrl,
      footnote: 'You received this because someone invited you to their Handoff workspace.',
    }),
  });
  if (error) {
    console.error('[email] Resend error (invite):', error);
    throw new Error(error.message ?? 'Failed to send email');
  }
}

export { appBaseUrl };
