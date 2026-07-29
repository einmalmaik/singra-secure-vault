import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  isSmtpConfigured,
  sendSmtpMail,
  SmtpConfigurationError,
  SmtpDeliveryError,
} from "./smtp.ts";

const safeEnv = new Map([
  ["SMTP_HOST", "smtp.example.invalid"],
  ["SMTP_PORT", "465"],
  ["SMTP_USER", "synthetic-user"],
  ["SMTP_PASSWORD", "synthetic-test-password"],
  ["SMTP_FROM", "noreply@example.invalid"],
  ["SMTP_SENDER_NAME", "Singra Test"],
]);

const readSafeEnv = (name: string) => safeEnv.get(name);

Deno.test("SMTP adapter enforces TLS on port 465 and disables external content access", async () => {
  let options: Record<string, unknown> | undefined;
  let message: Record<string, unknown> | undefined;
  let closed = false;

  const result = await sendSmtpMail({
    to: "recipient@example.invalid",
    subject: "Synthetic notification",
    text: "Synthetic message body",
  }, {
    readEnv: readSafeEnv,
    createTransport: (transportOptions) => {
      options = transportOptions;
      return {
        sendMail: async (mail) => {
          message = mail;
          return { messageId: "synthetic-message-id" };
        },
        close: () => {
          closed = true;
        },
      };
    },
  });

  assertEquals(result, { messageId: "synthetic-message-id" });
  assertEquals(options?.port, 465);
  assertEquals(options?.secure, true);
  assertEquals(options?.requireTLS, true);
  assertEquals((options?.tls as Record<string, unknown>).rejectUnauthorized, true);
  assertEquals(options?.disableFileAccess, true);
  assertEquals(options?.disableUrlAccess, true);
  assertEquals(message?.disableFileAccess, true);
  assertEquals(message?.disableUrlAccess, true);
  assertEquals(closed, true);
});

Deno.test("SMTP adapter fails closed when port 465 or required secrets are missing", async () => {
  assertEquals(isSmtpConfigured(readSafeEnv), true);
  assertEquals(isSmtpConfigured((name) => name === "SMTP_PORT" ? "587" : readSafeEnv(name)), false);

  await assertRejects(
    () => sendSmtpMail({
      to: "recipient@example.invalid",
      subject: "Synthetic notification",
      text: "Synthetic message body",
    }, {
      readEnv: (name) => name === "SMTP_PORT" ? "587" : readSafeEnv(name),
      createTransport: () => {
        throw new Error("must not create transport");
      },
    }),
    SmtpConfigurationError,
  );
});

Deno.test("SMTP adapter rejects header injection before opening a connection", async () => {
  await assertRejects(
    () => sendSmtpMail({
      to: "recipient@example.invalid",
      subject: "Synthetic notification\r\nBcc: attacker@example.invalid",
      text: "Synthetic message body",
    }, {
      readEnv: readSafeEnv,
      createTransport: () => {
        throw new Error("must not create transport");
      },
    }),
    SmtpDeliveryError,
  );
});

Deno.test("SMTP adapter redacts provider errors behind a stable error", async () => {
  const error = await assertRejects(
    () => sendSmtpMail({
      to: "recipient@example.invalid",
      subject: "Synthetic notification",
      text: "Synthetic message body",
    }, {
      readEnv: readSafeEnv,
      createTransport: () => ({
        sendMail: () => Promise.reject(new Error("provider included a sensitive diagnostic")),
      }),
    }),
    SmtpDeliveryError,
  );

  assertEquals(error.message, "SMTP delivery failed");
});
