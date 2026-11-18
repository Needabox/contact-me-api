import { assertEquals, assertRejects } from "@std/assert";
import { RepositoryError } from "../domain/errors.ts";
import {
  SupabaseContactRepository,
  type SupabaseTableClient,
} from "../repositories/supabase-contact-repository.ts";

Deno.test("SupabaseContactRepository inserts and maps ContactRecord", async () => {
  let capturedTable = "";
  let capturedInsertValues: Record<string, unknown> | null = null;
  let capturedUpdateValues: Record<string, unknown> | null = null;
  let capturedEq: [string, string] | null = null;

  const fakeClient: SupabaseTableClient = {
    from(table) {
      capturedTable = table;
      return {
        insert(values) {
          capturedInsertValues = values;
          return {
            select() {
              return {
                single() {
                  return Promise.resolve({
                    data: {
                      id: "uuid-1",
                      name: values.name,
                      email: values.email,
                      subject: values.subject,
                      message: values.message,
                      phone: values.phone,
                      company: values.company,
                      source: values.source,
                      metadata: values.metadata,
                      email_status: "pending",
                      email_provider: null,
                      provider_message_id: null,
                      email_error: null,
                      sent_at: null,
                      created_at: "2026-11-18T13:30:00.000Z",
                      updated_at: "2026-11-18T13:30:00.000Z",
                    },
                    error: null,
                  });
                },
              };
            },
          };
        },
        update(values) {
          capturedUpdateValues = values;
          return {
            eq(column, value) {
              capturedEq = [column, value];
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  };

  const repo = new SupabaseContactRepository(fakeClient);
  const created = await repo.create({
    name: "Jane",
    email: "jane@example.com",
    subject: null,
    message: "Hello",
    phone: null,
    company: null,
    source: "web",
    metadata: { plan: "pro" },
  });

  assertEquals(capturedTable, "contact_submissions");
  assertEquals(capturedInsertValues?.["email_status"], "pending");
  assertEquals(created.id, "uuid-1");
  assertEquals(created.emailStatus, "pending");
  assertEquals(created.metadata, { plan: "pro" });

  await repo.markEmailSent("uuid-1", {
    provider: "resend",
    messageId: "msg-1",
    sentAt: "2026-11-18T13:30:02.000Z",
  });
  assertEquals(capturedUpdateValues, {
    email_status: "sent",
    email_provider: "resend",
    provider_message_id: "msg-1",
    email_error: null,
    sent_at: "2026-11-18T13:30:02.000Z",
  });
  assertEquals(capturedEq, ["id", "uuid-1"]);

  await repo.markEmailFailed("uuid-1", {
    provider: "resend",
    errorMessage: "Timeout",
  });
  assertEquals(capturedUpdateValues, {
    email_status: "failed",
    email_provider: "resend",
    email_error: "Timeout",
  });
});

Deno.test("SupabaseContactRepository wraps database errors in RepositoryError", async () => {
  const failingClient: SupabaseTableClient = {
    from() {
      return {
        insert() {
          return {
            select() {
              return {
                single() {
                  return Promise.resolve({
                    data: null,
                    error: { message: "permission denied", code: "42501" },
                  });
                },
              };
            },
          };
        },
        update() {
          return {
            eq() {
              return Promise.resolve({
                error: { message: "connection lost" },
              });
            },
          };
        },
      };
    },
  };

  const repo = new SupabaseContactRepository(failingClient);

  await assertRejects(
    () =>
      repo.create({
        name: "Jane",
        email: "jane@example.com",
        subject: null,
        message: "Hello",
        phone: null,
        company: null,
        source: null,
        metadata: {},
      }),
    RepositoryError,
    "Failed to persist contact submission: permission denied",
  );

  await assertRejects(
    () =>
      repo.markEmailFailed("uuid-1", {
        provider: "resend",
        errorMessage: "err",
      }),
    RepositoryError,
    "Failed to update contact submission status to failed: connection lost",
  );
});
