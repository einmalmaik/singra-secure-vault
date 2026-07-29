import nodemailer from "npm:nodemailer@9.0.3";

const SMTP_PORT = 465;
const EMAIL_PATTERN = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const HEADER_NAME_PATTERN = /^[A-Za-z0-9-]+$/;

export interface SmtpMail {
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  headers?: Record<string, string>;
}

interface SmtpConfig {
  host: string;
  port: typeof SMTP_PORT;
  user: string;
  password: string;
  fromAddress: string;
  senderName: string;
}

interface SmtpTransport {
  sendMail(message: Record<string, unknown>): Promise<{ messageId?: string }>;
  close?(): void;
}

type TransportFactory = (options: Record<string, unknown>) => SmtpTransport;
type EnvReader = (name: string) => string | undefined;

export class SmtpConfigurationError extends Error {
  constructor() {
    super("SMTP transport is not configured safely");
    this.name = "SmtpConfigurationError";
  }
}

export class SmtpDeliveryError extends Error {
  constructor() {
    super("SMTP delivery failed");
    this.name = "SmtpDeliveryError";
  }
}

export function isSmtpConfigured(readEnv: EnvReader = Deno.env.get): boolean {
  try {
    readSmtpConfig(readEnv);
    return true;
  } catch {
    return false;
  }
}

export async function sendSmtpMail(
  mail: SmtpMail,
  dependencies: {
    readEnv?: EnvReader;
    createTransport?: TransportFactory;
  } = {},
): Promise<{ messageId: string }> {
  const config = readSmtpConfig(dependencies.readEnv ?? Deno.env.get);
  const normalized = validateMail(mail);
  const createTransport = dependencies.createTransport ??
    (nodemailer.createTransport.bind(nodemailer) as unknown as TransportFactory);
  const transport = createTransport({
    host: config.host,
    port: config.port,
    secure: true,
    requireTLS: true,
    auth: {
      user: config.user,
      pass: config.password,
    },
    tls: {
      minVersion: "TLSv1.2",
      rejectUnauthorized: true,
      servername: config.host,
    },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    disableFileAccess: true,
    disableUrlAccess: true,
    logger: false,
    debug: false,
  });

  try {
    const result = await transport.sendMail({
      from: {
        name: config.senderName,
        address: config.fromAddress,
      },
      to: normalized.to,
      subject: normalized.subject,
      text: normalized.text,
      html: normalized.html,
      headers: normalized.headers,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    return { messageId: typeof result.messageId === "string" ? result.messageId : "" };
  } catch {
    // Do not propagate provider errors: SMTP failures can contain recipient
    // addresses, credentials, or provider-specific diagnostic details.
    throw new SmtpDeliveryError();
  } finally {
    transport.close?.();
  }
}

function readSmtpConfig(readEnv: EnvReader): SmtpConfig {
  const host = cleanSingleLine(readEnv("SMTP_HOST"));
  const rawPort = cleanSingleLine(readEnv("SMTP_PORT"));
  const user = cleanSingleLine(readEnv("SMTP_USER"));
  const password = readEnv("SMTP_PASSWORD") ?? "";
  const fromAddress = cleanSingleLine(readEnv("SMTP_FROM"));
  const senderName = cleanSingleLine(readEnv("SMTP_SENDER_NAME")) || "Singra Vault";

  if (
    !host ||
    rawPort !== String(SMTP_PORT) ||
    !user ||
    !password ||
    !isEmailAddress(fromAddress) ||
    containsLineBreak(password)
  ) {
    throw new SmtpConfigurationError();
  }

  return {
    host,
    port: SMTP_PORT,
    user,
    password,
    fromAddress,
    senderName,
  };
}

function validateMail(mail: SmtpMail): Required<Pick<SmtpMail, "to" | "subject">> &
  Pick<SmtpMail, "text" | "html" | "headers"> {
  const recipients = (Array.isArray(mail.to) ? mail.to : [mail.to]).map((value) => value.trim());
  const subject = mail.subject.trim();

  if (
    recipients.length === 0 ||
    recipients.length > 10 ||
    recipients.some((address) => !isEmailAddress(address)) ||
    !subject ||
    subject.length > 200 ||
    containsLineBreak(subject) ||
    (!mail.text && !mail.html) ||
    (mail.text?.length ?? 0) > 200_000 ||
    (mail.html?.length ?? 0) > 500_000
  ) {
    throw new SmtpDeliveryError();
  }

  const headers = mail.headers ? validateHeaders(mail.headers) : undefined;
  return {
    to: recipients,
    subject,
    text: mail.text,
    html: mail.html,
    headers,
  };
}

function validateHeaders(headers: Record<string, string>): Record<string, string> {
  const entries = Object.entries(headers);
  if (entries.length > 20) {
    throw new SmtpDeliveryError();
  }

  for (const [name, value] of entries) {
    if (
      !HEADER_NAME_PATTERN.test(name) ||
      name.length > 100 ||
      value.length > 1_000 ||
      containsLineBreak(value)
    ) {
      throw new SmtpDeliveryError();
    }
  }

  return Object.fromEntries(entries);
}

function isEmailAddress(value: string): boolean {
  return value.length <= 254 && EMAIL_PATTERN.test(value) && !containsLineBreak(value);
}

function cleanSingleLine(value: string | undefined): string {
  const normalized = value?.trim() ?? "";
  return containsLineBreak(normalized) ? "" : normalized;
}

function containsLineBreak(value: string): boolean {
  return value.includes("\r") || value.includes("\n");
}
