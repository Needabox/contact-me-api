import { EmailDeliveryError } from "../domain/errors.ts";
import type { ContactRepository, EmailProvider } from "../domain/ports.ts";
import type {
  ContactRecord,
  EmailMessage,
  SubmitContactResult,
} from "../domain/types.ts";
import {
  escapeHtml,
  normalizeAndValidateContactInput,
} from "../domain/validation.ts";

export interface SubmitContactUseCaseDependencies {
  contactRepository: ContactRepository;
  emailProvider: EmailProvider;
  fromEmail: string;
  toEmails: string[];
  now?: () => Date;
}

function buildNotificationSubject(
  record: Pick<ContactRecord, "name" | "subject" | "source">,
): string {
  const base = record.subject ? record.subject : `New contact from ${record.name}`;
  return record.source ? `[${record.source}] ${base}` : `[Contact] ${base}`;
}

function buildContactNotificationEmail(
  record: ContactRecord,
  fromEmail: string,
  toEmails: string[],
): EmailMessage {
  const subject = buildNotificationSubject(record);

  const detailRows: Array<[string, string]> = [
    ["Submission ID", record.id],
    ["Name", record.name],
    ["Email", record.email],
  ];

  if (record.subject) detailRows.push(["Subject", record.subject]);
  if (record.phone) detailRows.push(["Phone", record.phone]);
  if (record.company) detailRows.push(["Company", record.company]);
  if (record.source) detailRows.push(["Source", record.source]);
  detailRows.push(["Submitted At", record.createdAt]);

  const textLines = [
    "New Contact Submission",
    "======================",
    ...detailRows.map(([label, value]) => `${label}: ${value}`),
    "",
    "Message:",
    record.message,
  ];

  const metadataEntries = Object.entries(record.metadata);
  if (metadataEntries.length > 0) {
    textLines.push("", "Metadata:", JSON.stringify(record.metadata, null, 2));
  }

  const htmlRows = detailRows
    .map(
      ([label, value]) =>
        `<tr><th align="left" style="padding:6px 12px 6px 0;color:#475569;vertical-align:top;">${
          escapeHtml(label)
        }</th><td style="padding:6px 0;color:#0f172a;">${escapeHtml(value)}</td></tr>`,
    )
    .join("");

  const htmlMessage = escapeHtml(record.message).replaceAll("\n", "<br />");
  const htmlMetadata = metadataEntries.length > 0
    ? `<h3 style="margin:20px 0 8px;font-size:14px;color:#334155;">Metadata</h3><pre style="background:#f8fafc;padding:12px;border-radius:6px;font-size:12px;overflow:auto;">${
      escapeHtml(JSON.stringify(record.metadata, null, 2))
    }</pre>`
    : "";

  const html = [
    '<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;max-width:640px;color:#0f172a;">',
    '<h2 style="margin:0 0 16px;font-size:18px;">New Contact Submission</h2>',
    `<table style="border-collapse:collapse;width:100%;font-size:14px;">${htmlRows}</table>`,
    '<h3 style="margin:20px 0 8px;font-size:14px;color:#334155;">Message</h3>',
    `<div style="background:#f8fafc;padding:14px;border-radius:6px;font-size:14px;line-height:1.5;">${htmlMessage}</div>`,
    htmlMetadata,
    "</div>",
  ].join("");

  return {
    from: fromEmail,
    to: toEmails,
    replyTo: record.email,
    subject,
    text: textLines.join("\n"),
    html,
  };
}

/** Coordinates validation, persistence, and provider-agnostic email notification. */
export class SubmitContactUseCase {
  readonly #contactRepository: ContactRepository;
  readonly #emailProvider: EmailProvider;
  readonly #fromEmail: string;
  readonly #toEmails: string[];
  readonly #now: () => Date;

  constructor(deps: SubmitContactUseCaseDependencies) {
    this.#contactRepository = deps.contactRepository;
    this.#emailProvider = deps.emailProvider;
    this.#fromEmail = deps.fromEmail;
    this.#toEmails = [...deps.toEmails];
    this.#now = deps.now ?? (() => new Date());
  }

  async execute(rawInput: unknown): Promise<SubmitContactResult> {
    const validatedInput = normalizeAndValidateContactInput(rawInput);
    const record = await this.#contactRepository.create(validatedInput);
    const emailMessage = buildContactNotificationEmail(
      record,
      this.#fromEmail,
      this.#toEmails,
    );

    let sendResult;
    try {
      sendResult = await this.#emailProvider.send(emailMessage);
    } catch (error) {
      const errorMessage = error instanceof Error
        ? error.message
        : "Unknown email delivery failure.";

      try {
        await this.#contactRepository.markEmailFailed(record.id, {
          provider: this.#emailProvider.name,
          errorMessage: errorMessage.slice(0, 1000),
        });
      } catch (markError) {
        console.error(
          `Failed to record email failure status for submission ${record.id}:`,
          markError,
        );
      }

      if (error instanceof EmailDeliveryError) {
        throw new EmailDeliveryError(
          error.provider,
          error.message,
          record.id,
          { cause: error },
        );
      }

      throw new EmailDeliveryError(
        this.#emailProvider.name,
        "Contact submission was saved, but notification email delivery failed.",
        record.id,
        { cause: error },
      );
    }

    try {
      await this.#contactRepository.markEmailSent(record.id, {
        provider: sendResult.provider,
        messageId: sendResult.messageId,
        sentAt: this.#now().toISOString(),
      });
    } catch (markError) {
      // Email has already been dispatched; avoid returning 5xx that prompts duplicate submissions.
      console.warn(
        `Email sent via ${sendResult.provider}, but failed to update status for submission ${record.id}:`,
        markError,
      );
    }

    return {
      id: record.id,
      status: "sent",
      createdAt: record.createdAt,
    };
  }
}
