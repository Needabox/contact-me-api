import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { EmailDeliveryError } from "../domain/errors.ts";
import type {
  ContactRepository,
  EmailDeliveryFailure,
  EmailDeliverySuccess,
  EmailProvider,
} from "../domain/ports.ts";
import type {
  ContactRecord,
  EmailMessage,
  NormalizedContactInput,
} from "../domain/types.ts";
import { SubmitContactUseCase } from "../use-cases/submit-contact.ts";

class InMemoryContactRepository implements ContactRepository {
  createdInputs: NormalizedContactInput[] = [];
  sentUpdates: Array<{ id: string; details: EmailDeliverySuccess }> = [];
  failedUpdates: Array<{ id: string; details: EmailDeliveryFailure }> = [];
  failOnMarkSent = false;

  create(input: NormalizedContactInput): Promise<ContactRecord> {
    this.createdInputs.push(input);
    return Promise.resolve({
      id: "11111111-1111-4111-8111-111111111111",
      name: input.name,
      email: input.email,
      subject: input.subject,
      message: input.message,
      phone: input.phone,
      company: input.company,
      source: input.source,
      metadata: input.metadata,
      emailStatus: "pending",
      emailProvider: null,
      providerMessageId: null,
      emailError: null,
      sentAt: null,
      createdAt: "2026-11-18T13:30:00.000Z",
      updatedAt: "2026-11-18T13:30:00.000Z",
    });
  }

  markEmailSent(id: string, details: EmailDeliverySuccess): Promise<void> {
    if (this.failOnMarkSent) {
      return Promise.reject(new Error("DB update error"));
    }
    this.sentUpdates.push({ id, details });
    return Promise.resolve();
  }

  markEmailFailed(id: string, details: EmailDeliveryFailure): Promise<void> {
    this.failedUpdates.push({ id, details });
    return Promise.resolve();
  }
}

class FakeEmailProvider implements EmailProvider {
  readonly name = "fake-mailer";
  sentMessages: EmailMessage[] = [];
  shouldFailWith: Error | null = null;

  send(message: EmailMessage): Promise<{ provider: string; messageId: string }> {
    if (this.shouldFailWith) {
      return Promise.reject(this.shouldFailWith);
    }
    this.sentMessages.push(message);
    return Promise.resolve({ provider: this.name, messageId: "msg_123" });
  }
}

Deno.test("SubmitContactUseCase persists submission, sends escaped email, and marks sent", async () => {
  const repo = new InMemoryContactRepository();
  const provider = new FakeEmailProvider();

  const useCase = new SubmitContactUseCase({
    contactRepository: repo,
    emailProvider: provider,
    fromEmail: "VIBIX <no-reply@vibix.test>",
    toEmails: ["inbox@vibix.test"],
    now: () => new Date("2026-11-18T13:30:05.000Z"),
  });

  const result = await useCase.execute({
    name: "Jane <Admin>",
    email: "jane@example.com",
    subject: "Hello",
    message: "<script>alert(1)</script>\nLine 2",
    source: "landing-page",
  });

  assertEquals(result, {
    id: "11111111-1111-4111-8111-111111111111",
    status: "sent",
    createdAt: "2026-11-18T13:30:00.000Z",
  });

  assertEquals(repo.createdInputs.length, 1);
  assertEquals(provider.sentMessages.length, 1);
  assertEquals(provider.sentMessages[0].from, "VIBIX <no-reply@vibix.test>");
  assertEquals(provider.sentMessages[0].to, ["inbox@vibix.test"]);
  assertEquals(provider.sentMessages[0].replyTo, "jane@example.com");
  assertEquals(provider.sentMessages[0].subject, "[landing-page] Hello");
  assertStringIncludes(
    provider.sentMessages[0].html,
    "&lt;script&gt;alert(1)&lt;/script&gt;<br />Line 2",
  );
  assertStringIncludes(provider.sentMessages[0].html, "Jane &lt;Admin&gt;");

  assertEquals(repo.sentUpdates, [
    {
      id: "11111111-1111-4111-8111-111111111111",
      details: {
        provider: "fake-mailer",
        messageId: "msg_123",
        sentAt: "2026-11-18T13:30:05.000Z",
      },
    },
  ]);
});

Deno.test("SubmitContactUseCase records failure status and throws EmailDeliveryError when provider fails", async () => {
  const repo = new InMemoryContactRepository();
  const provider = new FakeEmailProvider();
  provider.shouldFailWith = new Error("SMTP timeout");

  const useCase = new SubmitContactUseCase({
    contactRepository: repo,
    emailProvider: provider,
    fromEmail: "no-reply@vibix.test",
    toEmails: ["inbox@vibix.test"],
  });

  const error = await assertRejects(
    () =>
      useCase.execute({
        name: "Jane",
        email: "jane@example.com",
        message: "Test message",
      }),
    EmailDeliveryError,
  );

  assertEquals(error.submissionId, "11111111-1111-4111-8111-111111111111");
  assertEquals(error.provider, "fake-mailer");
  assertEquals(repo.failedUpdates, [
    {
      id: "11111111-1111-4111-8111-111111111111",
      details: {
        provider: "fake-mailer",
        errorMessage: "SMTP timeout",
      },
    },
  ]);
});

Deno.test("SubmitContactUseCase succeeds if email sent even when markEmailSent update fails", async () => {
  const repo = new InMemoryContactRepository();
  repo.failOnMarkSent = true;
  const provider = new FakeEmailProvider();

  const useCase = new SubmitContactUseCase({
    contactRepository: repo,
    emailProvider: provider,
    fromEmail: "no-reply@vibix.test",
    toEmails: ["inbox@vibix.test"],
  });

  const originalWarn = console.warn;
  console.warn = () => undefined;
  try {
    const result = await useCase.execute({
      name: "Jane",
      email: "jane@example.com",
      message: "Test message",
    });

    assertEquals(result.status, "sent");
    assertEquals(provider.sentMessages.length, 1);
  } finally {
    console.warn = originalWarn;
  }
});
