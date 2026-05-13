import { logger } from '@/lib/logger';

/**
 * Normalize RESEND_FROM_EMAIL — if someone sets it to just a domain like
 * "alerts.example.com" instead of "notifications@alerts.example.com",
 * fix it automatically.
 */
function getFromAddress(): string {
  const raw = process.env.RESEND_FROM_EMAIL ?? 'notifications@alerts.charles.app';
  if (raw.includes('@')) return raw;
  return `notifications@${raw}`;
}

/** Escape characters that have special meaning in HTML to prevent XSS. */
function esc(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}

function row(label: string, value: string | number | boolean | null | undefined) {
  if (value == null || value === '') return '';
  const display = typeof value === 'boolean' ? (value ? 'Yes' : 'No') : esc(String(value));
  return `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:13px;white-space:nowrap">${esc(label)}</td><td style="padding:4px 0;font-size:13px;color:#111827">${display}</td></tr>`;
}

// ── Generic CRM email (used by ai-tools send_email) ──────────────────────

export interface SendEmailFromCRMParams {
  toEmail: string;
  fromName: string;
  replyTo?: string;
  subject: string;
  body: string;
}

export async function sendEmailFromCRM(params: SendEmailFromCRMParams): Promise<void> {
  if (!process.env.RESEND_API_KEY) { logger.warn('[email] RESEND_API_KEY not set — skipping'); return; }
  const { Resend } = await import('resend');
  const resend = new Resend(process.env.RESEND_API_KEY);
  const FROM = getFromAddress();

  const { toEmail, fromName, replyTo, subject, body } = params;

  const html = `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:32px 16px">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;border:1px solid #e5e7eb;overflow:hidden">
        <tr><td style="padding:28px 32px">
          <p style="margin:0;font-size:15px;color:#111827;line-height:1.7;white-space:pre-wrap">${esc(body)}</p>
        </td></tr>
        <tr><td style="padding:16px 32px;border-top:1px solid #f1f5f9">
          <p style="margin:0;font-size:12px;color:#9ca3af">Sent by ${esc(fromName)} via Charles.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const safeSubject = subject.replace(/[\r\n\t]/g, ' ').slice(0, 200);
  try {
    const result = await resend.emails.send({
      from: `${fromName.replace(/[\r\n\t<>"]/g, ' ').slice(0, 100)} <${FROM}>`,
      to: toEmail,
      replyTo: replyTo ?? undefined,
      subject: safeSubject,
      html,
    });
    if (result.error) {
      logger.error('[email] CRM email: Resend API error', { to: toEmail, resendError: result.error });
    } else {
      logger.info('[email] CRM email sent', { to: toEmail, messageId: result.data?.id });
    }
  } catch (err) {
    logger.error('[email] CRM email failed', { to: toEmail }, err);
  }
}

// ── New Deal notification (used by lib/notify.ts) ────────────────────────

export interface NewDealEmailParams {
  toEmail: string;
  spaceName: string;
  spaceSlug: string;
  dealTitle: string;
  dealValue?: number | null;
  dealAddress?: string | null;
  dealPriority?: string | null;
  contactNames?: string[];
}

export async function sendNewDealNotification(params: NewDealEmailParams): Promise<void> {
  if (!process.env.RESEND_API_KEY) { logger.warn('[email] RESEND_API_KEY not set — skipping'); return; }
  const { Resend } = await import('resend');
  const resend = new Resend(process.env.RESEND_API_KEY);
  const FROM = getFromAddress();

  const { toEmail, spaceName, spaceSlug, dealTitle, dealValue, dealAddress, dealPriority, contactNames } = params;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://my.charles.app';
  const dealsUrl = `${appUrl}/s/${spaceSlug}/deals`;

  const detailRows = [
    row('Title', dealTitle),
    row('Value', dealValue != null ? fmt(dealValue) : null),
    row('Address', dealAddress),
    row('Priority', dealPriority),
    row('Contacts', contactNames?.length ? contactNames.join(', ') : null),
  ].filter(Boolean).join('');

  const html = `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:32px 16px">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;border:1px solid #e5e7eb;overflow:hidden">
        <tr><td style="background:#0f172a;padding:20px 28px">
          <p style="margin:0;color:#94a3b8;font-size:12px;font-weight:500;text-transform:uppercase;letter-spacing:.05em">${esc(spaceName)}</p>
          <p style="margin:4px 0 0;color:#ffffff;font-size:20px;font-weight:700">New deal created</p>
        </td></tr>
        <tr><td style="padding:24px 28px">
          <p style="margin:0;font-size:18px;font-weight:700;color:#111827">${esc(dealTitle)}</p>
          ${dealValue != null ? `<p style="margin:6px 0 0;font-size:24px;font-weight:700;color:#059669">${fmt(dealValue)}</p>` : ''}
          ${detailRows ? `<table cellpadding="0" cellspacing="0" style="margin-top:18px;width:100%">${detailRows}</table>` : ''}
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px">
            <tr><td>
              <a href="${dealsUrl}" style="display:inline-block;background:#0f172a;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;padding:10px 22px;border-radius:8px">View deals &rarr;</a>
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:16px 28px;border-top:1px solid #f1f5f9">
          <p style="margin:0;font-size:11px;color:#9ca3af">You're receiving this because notifications are enabled for <strong>${esc(spaceName)}</strong>.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const safeDealTitle = dealTitle.replace(/[\r\n\t]/g, ' ').slice(0, 200);
  try {
    const result = await resend.emails.send({
      from: FROM,
      to: toEmail,
      subject: `New deal: ${safeDealTitle}${dealValue != null ? ` · ${fmt(dealValue)}` : ''}`,
      html,
    });
    if (result.error) {
      logger.error('[email] deal notification: Resend API error', { to: toEmail, resendError: result.error });
    } else {
      logger.info('[email] deal notification sent', { to: toEmail, messageId: result.data?.id });
    }
  } catch (err) {
    logger.error('[email] deal notification failed', { to: toEmail }, err);
  }
}

// ── Welcome email (used by /api/onboarding) ──────────────────────────────

export async function sendWelcomeEmail(params: {
  toEmail: string;
  userName: string | null;
  spaceName?: string | null;
  spaceSlug?: string | null;
}): Promise<void> {
  if (!process.env.RESEND_API_KEY) { logger.warn('[email] RESEND_API_KEY not set — skipping'); return; }
  const { Resend } = await import('resend');
  const resend = new Resend(process.env.RESEND_API_KEY);
  const FROM = getFromAddress();

  const { toEmail, userName, spaceName, spaceSlug } = params;
  const name = esc(userName) || 'there';
  const domain = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? 'my.charles.app';
  const dashboardUrl = spaceSlug ? `https://${domain}/s/${spaceSlug}` : `https://${domain}/setup`;

  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:32px 0">
  <div style="text-align:center;margin-bottom:28px">
    <span style="font-size:28px;font-weight:700;color:#111827">Welcome to Charles</span>
  </div>
  <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:28px 24px">
    <p style="margin:0 0 16px;font-size:15px;color:#111827;line-height:1.6">Hi ${name},</p>
    <p style="margin:0 0 16px;font-size:14px;color:#374151;line-height:1.6">
      Your Charles account is ready${spaceName ? ` and your workspace <strong>${esc(spaceName)}</strong> has been created` : ''}.
    </p>
    <div style="text-align:center;margin:24px 0 8px">
      <a href="${dashboardUrl}" style="display:inline-block;background:#0f172a;color:#ffffff;font-weight:600;font-size:14px;text-decoration:none;padding:10px 28px;border-radius:8px">
        Open your dashboard
      </a>
    </div>
  </div>
  <p style="text-align:center;font-size:12px;color:#9ca3af;margin-top:20px;line-height:1.5">
    Questions? Just reply to this email.<br/>
    &mdash; The Charles team
  </p>
</div>`;

  try {
    const result = await resend.emails.send({
      from: `Charles <${FROM}>`,
      to: toEmail,
      subject: `Welcome to Charles — your workspace is ready`,
      html,
    });
    if (result.error) {
      logger.error('[email] welcome: Resend API error', { to: toEmail, resendError: result.error });
    } else {
      logger.info('[email] welcome sent', { to: toEmail, messageId: result.data?.id });
    }
  } catch (err) {
    logger.error('[email] welcome failed', { to: toEmail }, err);
  }
}

// ── MFA enrollment prompt (used by /api/admin/actions) ───────────────────

export interface MfaEnrollmentPromptParams {
  toEmail: string;
  userName: string | null;
}

export async function sendMfaEnrollmentPrompt(params: MfaEnrollmentPromptParams): Promise<void> {
  if (!process.env.RESEND_API_KEY) {
    logger.warn('[email] RESEND_API_KEY not set — skipping MFA enrollment prompt');
    return;
  }
  const { Resend } = await import('resend');
  const resend = new Resend(process.env.RESEND_API_KEY);
  const FROM = getFromAddress();

  const { toEmail, userName } = params;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://my.charles.app';
  const accountSettingsUrl = `${appUrl}/settings/account`;
  const name = esc(userName) || 'there';

  const html = `
<!DOCTYPE html>
<html lang="en">
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#f9fafb;padding:32px 16px">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:520px;background:#ffffff;border-radius:12px;border:1px solid #e5e7eb;overflow:hidden">
        <tr><td style="background:#0f172a;padding:20px 28px">
          <p style="margin:0;color:#94a3b8;font-size:12px;font-weight:500;text-transform:uppercase;letter-spacing:.05em">Account Security</p>
          <p style="margin:4px 0 0;color:#ffffff;font-size:20px;font-weight:700">Enable two-factor authentication</p>
        </td></tr>
        <tr><td style="padding:24px 28px">
          <p style="margin:0 0 16px;font-size:15px;color:#111827;line-height:1.6">Hi ${name},</p>
          <p style="margin:0 0 16px;font-size:14px;color:#374151;line-height:1.6">
            To better protect your Charles account, we recommend enabling two-factor authentication (2FA).
          </p>
          <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
            <tr><td>
              <a href="${accountSettingsUrl}" style="display:inline-block;background:#0f172a;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;padding:10px 22px;border-radius:8px">Enable 2FA now &rarr;</a>
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:16px 28px;border-top:1px solid #f1f5f9">
          <p style="margin:0;font-size:11px;color:#9ca3af">The Charles team</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  try {
    const result = await resend.emails.send({
      from: `Charles <${FROM}>`,
      to: toEmail,
      subject: 'Secure your Charles account — enable two-factor authentication',
      html,
    });
    if (result.error) {
      logger.error('[email] MFA prompt: Resend API error', { to: toEmail, resendError: result.error });
    } else {
      logger.info('[email] MFA prompt sent', { to: toEmail, messageId: result.data?.id });
    }
  } catch (err) {
    logger.error('[email] MFA prompt failed', { to: toEmail }, err);
  }
}

// ── Team invite (used by /api/team/invite) ───────────────────────────────

export interface TeamInviteEmailParams {
  toEmail: string;
  teamName: string;
  inviterName: string | null;
  role: 'admin' | 'member';
  token: string;
}

export async function sendTeamInvite(params: TeamInviteEmailParams): Promise<void> {
  if (!process.env.RESEND_API_KEY) {
    logger.warn('[email] RESEND_API_KEY not set — skipping team invite email');
    return;
  }
  const { Resend } = await import('resend');
  const resend = new Resend(process.env.RESEND_API_KEY);
  const FROM = getFromAddress();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://my.charles.app';

  const { toEmail, teamName, inviterName, role, token } = params;
  const acceptUrl = `${appUrl}/team/accept/${encodeURIComponent(token)}`;
  const inviter = inviterName ?? 'A teammate';
  const roleLabel = role === 'admin' ? 'Admin' : 'Member';

  const html = `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:32px 16px">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;border:1px solid #e5e7eb;overflow:hidden">
        <tr><td style="background:#0f172a;padding:20px 28px">
          <p style="margin:0;color:#94a3b8;font-size:12px;font-weight:500;text-transform:uppercase;letter-spacing:.05em">Charles</p>
          <p style="margin:4px 0 0;color:#ffffff;font-size:20px;font-weight:700">${esc(teamName)}</p>
        </td></tr>
        <tr><td style="padding:24px 28px">
          <p style="margin:0;font-size:15px;color:#111827;line-height:1.6">
            <strong>${esc(inviter)}</strong> invited you to join <strong>${esc(teamName)}</strong> as a <strong>${esc(roleLabel)}</strong>.
          </p>
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px">
            <tr><td>
              <a href="${acceptUrl}" style="display:inline-block;background:#0f172a;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;padding:10px 22px;border-radius:8px">Accept invite &rarr;</a>
            </td></tr>
          </table>
          <p style="margin:16px 0 0;font-size:11px;color:#9ca3af">This invite expires in 7 days.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  try {
    const result = await resend.emails.send({
      from: FROM,
      to: toEmail,
      subject: `You're invited to join ${teamName.replace(/[\r\n\t]/g, ' ').slice(0, 100)}`,
      html,
    });
    if (result.error) {
      logger.error('[email] team invite: Resend API error', { to: toEmail, resendError: result.error });
    } else {
      logger.info('[email] team invite sent', { to: toEmail, messageId: result.data?.id });
    }
  } catch (err) {
    logger.error('[email] team invite failed', { to: toEmail }, err);
  }
}
