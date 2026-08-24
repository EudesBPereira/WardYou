import { env } from "../env.js";

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/**
 * Send an email via Azure Communication Services Email. Best-effort: when ACS
 * isn't configured (no connection string / sender), the message is logged
 * instead of sent, so local/dev flows still work without a mail provider.
 * Returns true when the provider accepted the message.
 */
export async function sendEmail(msg: MailMessage): Promise<boolean> {
  if (!env.ACS_CONNECTION_STRING || !env.MAIL_FROM) {
    console.warn(`[mailer] ACS not configured — email to ${msg.to} not sent. Subject: ${msg.subject}`);
    console.warn(`[mailer] (dev) body:\n${msg.text}`);
    return false;
  }
  try {
    // Lazy import so the dependency is only loaded when actually sending.
    const { EmailClient } = await import("@azure/communication-email");
    const client = new EmailClient(env.ACS_CONNECTION_STRING);
    const poller = await client.beginSend({
      senderAddress: env.MAIL_FROM,
      content: { subject: msg.subject, html: msg.html, plainText: msg.text },
      recipients: { to: [{ address: msg.to }] },
    });
    await poller.pollUntilDone();
    return true;
  } catch (err) {
    console.error("[mailer] failed to send email:", err);
    return false;
  }
}
