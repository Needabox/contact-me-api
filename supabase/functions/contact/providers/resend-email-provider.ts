import { EmailDeliveryError } from "../domain/errors.ts";
import type { EmailProvider } from "../domain/ports.ts";
import type { EmailMessage, EmailSendResult } from "../domain/types.ts";

export interface ResendEmailProviderOptions {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

/** Resend HTTP API email adapter using standard Web fetch. */
export class ResendEmailProvider implements EmailProvider {
  readonly name = "resend";
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #timeoutMs: number;
  readonly #fetchFn: typeof fetch;

  constructor(options: ResendEmailProviderOptions) {
    this.#apiKey = options.apiKey;
    this.#baseUrl = (options.baseUrl ?? "https://api.resend.com").replace(/\/+$/, "");
    this.#timeoutMs = options.timeoutMs ?? 10_000;
    this.#fetchFn = options.fetchFn ?? fetch;
  }

  async send(message: EmailMessage): Promise<EmailSendResult> {
    let response: Response;
    try {
      response = await this.#fetchFn(`${this.#baseUrl}/emails`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.#apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: message.from,
          to: message.to,
          reply_to: message.replyTo,
          subject: message.subject,
          text: message.text,
          html: message.html,
        }),
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch (error) {
      throw new EmailDeliveryError(
        this.name,
        "Email provider request failed or timed out.",
        undefined,
        { cause: error },
      );
    }

    const rawBody = await response.text();
    let parsedBody: Record<string, unknown> | null = null;
    if (rawBody.length > 0) {
      try {
        const json = JSON.parse(rawBody);
        if (typeof json === "object" && json !== null && !Array.isArray(json)) {
          parsedBody = json as Record<string, unknown>;
        }
      } catch {
        parsedBody = null;
      }
    }

    if (!response.ok) {
      const providerMessage = typeof parsedBody?.message === "string"
        ? parsedBody.message
        : `HTTP ${response.status}`;

      throw new EmailDeliveryError(
        this.name,
        `Resend delivery failed (${providerMessage}).`,
      );
    }

    const messageId = typeof parsedBody?.id === "string" ? parsedBody.id : null;
    return {
      provider: this.name,
      messageId,
    };
  }
}
