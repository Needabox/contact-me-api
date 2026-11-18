import type { EmailProvider } from "../domain/ports.ts";
import type { EmailMessage, EmailSendResult } from "../domain/types.ts";

export type LogWriter = (message: string, payload: Record<string, unknown>) => void;

/** Local development and dry-run email provider that logs outgoing messages without network calls. */
export class ConsoleEmailProvider implements EmailProvider {
  readonly name = "console";
  readonly #log: LogWriter;

  constructor(log: LogWriter = (msg, payload) => console.info(msg, payload)) {
    this.#log = log;
  }

  send(message: EmailMessage): Promise<EmailSendResult> {
    const messageId = `console-${crypto.randomUUID()}`;
    this.#log("[ConsoleEmailProvider] Simulated email delivery", {
      messageId,
      from: message.from,
      to: message.to,
      replyTo: message.replyTo,
      subject: message.subject,
    });

    return Promise.resolve({
      provider: this.name,
      messageId,
    });
  }
}
