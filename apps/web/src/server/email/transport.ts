import "server-only";
import { env } from "../env";
import { logger } from "../logger";

export interface OutgoingEmail {
  to: string[];
  cc?: string[];
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
  attachments?: { filename: string; content: Buffer; contentType: string }[];
  /** Idempotency / correlation, sent as a header and used for provider tags. */
  messageId?: string;
  tag?: string;
}

export interface SendResult {
  provider: string;
  providerMessageId: string | null;
}

interface Transport {
  name: string;
  send(msg: OutgoingEmail): Promise<SendResult>;
}

const logTransport: Transport = {
  name: "log",
  send(msg) {
    logger.info({ to: msg.to, subject: msg.subject, tag: msg.tag }, "email (log transport)");
    return Promise.resolve({ provider: "log", providerMessageId: null });
  },
};

async function smtpTransport(): Promise<Transport> {
  const nodemailer = await import("nodemailer");
  const t = nodemailer.createTransport(env.SMTP_URL ?? "smtp://localhost:1025");
  return {
    name: "smtp",
    async send(msg) {
      const info = await t.sendMail({
        from: env.EMAIL_FROM,
        to: msg.to,
        cc: msg.cc,
        replyTo: msg.replyTo,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
        attachments: msg.attachments,
        headers: msg.messageId ? { "X-PTI-Message": msg.messageId } : undefined,
      });
      return { provider: "smtp", providerMessageId: info.messageId };
    },
  };
}

function postmarkTransport(): Transport {
  const token = env.POSTMARK_SERVER_TOKEN ?? "";
  return {
    name: "postmark",
    async send(msg) {
      const res = await fetch("https://api.postmarkapp.com/email", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json", "X-Postmark-Server-Token": token },
        body: JSON.stringify({
          From: env.EMAIL_FROM,
          To: msg.to.join(","),
          Cc: msg.cc?.join(","),
          ReplyTo: msg.replyTo,
          Subject: msg.subject,
          HtmlBody: msg.html,
          TextBody: msg.text,
          Tag: msg.tag,
          MessageStream: "outbound",
          TrackOpens: false,
          Metadata: msg.messageId ? { pti: msg.messageId } : undefined,
          Attachments: msg.attachments?.map((a) => ({
            Name: a.filename,
            Content: a.content.toString("base64"),
            ContentType: a.contentType,
          })),
        }),
        signal: AbortSignal.timeout(15_000),
      });
      const body = (await res.json()) as { MessageID?: string; ErrorCode?: number; Message?: string };
      if (!res.ok || body.ErrorCode) throw new Error(`Postmark ${res.status}: ${body.Message ?? "unknown error"}`);
      return { provider: "postmark", providerMessageId: body.MessageID ?? null };
    },
  };
}

let transport: Promise<Transport> | undefined;

function getTransport(): Promise<Transport> {
  transport ??=
    env.EMAIL_PROVIDER === "smtp"
      ? smtpTransport()
      : Promise.resolve(env.EMAIL_PROVIDER === "postmark" ? postmarkTransport() : logTransport);
  return transport;
}

export async function sendEmail(msg: OutgoingEmail): Promise<SendResult> {
  return (await getTransport()).send(msg);
}
