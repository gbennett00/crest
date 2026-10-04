/**
 * Delivery of plan-invitation emails.
 *
 * Email is sent through Resend when `RESEND_API_KEY` is configured. In
 * environments without it (local dev, previews), delivery is skipped and the
 * invite link is logged so the flow is still testable end-to-end. The invitation
 * row is always created regardless of delivery outcome — the owner can copy the
 * link from the members page — so a mail outage never loses the invite.
 */

export interface InvitationEmailParams {
  to: string;
  inviterEmail: string;
  planName: string;
  inviteUrl: string;
}

export interface DeliveryResult {
  delivered: boolean;
  error?: string;
}

export async function sendInvitationEmail(
  params: InvitationEmailParams,
): Promise<DeliveryResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.INVITATION_EMAIL_FROM ?? "Crest <onboarding@resend.dev>";

  if (!apiKey) {
    console.info(
      `[invite] Email delivery not configured (set RESEND_API_KEY). ` +
        `Invite link for ${params.to}: ${params.inviteUrl}`,
    );
    return { delivered: false };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: params.to,
        subject: `${params.inviterEmail} invited you to “${params.planName}” on Crest`,
        html: renderInvitationEmailHtml(params),
        text: renderInvitationEmailText(params),
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { delivered: false, error: detail || `HTTP ${res.status}` };
    }
    return { delivered: true };
  } catch (e) {
    return { delivered: false, error: e instanceof Error ? e.message : "send failed" };
  }
}

function renderInvitationEmailText(p: InvitationEmailParams): string {
  return [
    `${p.inviterEmail} has invited you to collaborate on the "${p.planName}" budget in Crest.`,
    "",
    `Accept the invitation: ${p.inviteUrl}`,
    "",
    "This invitation expires in 7 days. If you weren't expecting it, you can ignore this email.",
  ].join("\n");
}

function renderInvitationEmailHtml(p: InvitationEmailParams): string {
  const inviter = escapeHtml(p.inviterEmail);
  const plan = escapeHtml(p.planName);
  const url = escapeHtml(p.inviteUrl);
  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;border:1px solid #e5e7eb;">
      <tr><td style="padding:28px 28px 8px;">
        <h1 style="margin:0 0 12px;font-size:20px;">You've been invited to Crest</h1>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.5;color:#334155;">
          <strong>${inviter}</strong> has invited you to collaborate on the
          <strong>${plan}</strong> budget.
        </p>
        <p style="margin:0 0 24px;">
          <a href="${url}" style="display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:10px 20px;border-radius:8px;">Accept invitation</a>
        </p>
        <p style="margin:0 0 4px;font-size:13px;color:#64748b;">This invitation expires in 7 days.</p>
        <p style="margin:0;font-size:13px;color:#64748b;">If you weren't expecting it, you can safely ignore this email.</p>
      </td></tr>
    </table>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
