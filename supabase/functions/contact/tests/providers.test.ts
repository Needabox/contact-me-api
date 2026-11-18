import { assertEquals, assertRejects } from "@std/assert";
import { EmailDeliveryError } from "../domain/errors.ts";
import { ConsoleEmailProvider } from "../providers/console-email-provider.ts";
import { createEmailProvider } from "../providers/email-provider-factory.ts";
import { ResendEmailProvider } from "../providers/resend-email-provider.ts";

const sampleMessage = {
  from: "VIBIX <no-reply@vibix.test>",
  to: ["team@vibix.test"],
  replyTo: "sender@example.com",
  subject: "[Contact] Inquiry",
  text: "Hello",
  html: "<p>Hello</p>",
};

Deno.test("ResendEmailProvider sends expected HTTP payload and returns messageId", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;

  const mockFetch: typeof fetch = (input, init) => {
    capturedUrl = String(input);
    capturedInit = init;
    return Promise.resolve(
      new Response(JSON.stringify({ id: "re_abc123" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  };

  const provider = new ResendEmailProvider({
    apiKey: "test-api-key",
    baseUrl: "https://api.resend.test/",
    fetchFn: mockFetch,
  });

  const result = await provider.send(sampleMessage);

  assertEquals(result, { provider: "resend", messageId: "re_abc123" });
  assertEquals(capturedUrl, "https://api.resend.test/emails");
  assertEquals(capturedInit?.method, "POST");
  assertEquals(
    (capturedInit?.headers as Record<string, string>)["Authorization"],
    "Bearer test-api-key",
  );
  assertEquals(JSON.parse(String(capturedInit?.body)), {
    from: sampleMessage.from,
    to: sampleMessage.to,
    reply_to: sampleMessage.replyTo,
    subject: sampleMessage.subject,
    text: sampleMessage.text,
    html: sampleMessage.html,
  });
});

Deno.test("ResendEmailProvider throws EmailDeliveryError on non-2xx response or network error", async () => {
  const apiErrorProvider = new ResendEmailProvider({
    apiKey: "test-api-key",
    fetchFn: () =>
      Promise.resolve(
        new Response(JSON.stringify({ message: "Invalid domain" }), {
          status: 422,
        }),
      ),
  });

  await assertRejects(
    () => apiErrorProvider.send(sampleMessage),
    EmailDeliveryError,
    "Resend delivery failed (Invalid domain).",
  );

  const networkErrorProvider = new ResendEmailProvider({
    apiKey: "test-api-key",
    fetchFn: () => Promise.reject(new TypeError("Connection refused")),
  });

  await assertRejects(
    () => networkErrorProvider.send(sampleMessage),
    EmailDeliveryError,
    "Email provider request failed or timed out.",
  );
});

Deno.test("ConsoleEmailProvider logs message and createEmailProvider selects implementation", async () => {
  const logged: Array<Record<string, unknown>> = [];
  const consoleProvider = new ConsoleEmailProvider((_msg, payload) => {
    logged.push(payload);
  });

  const res = await consoleProvider.send(sampleMessage);
  assertEquals(res.provider, "console");
  assertEquals(typeof res.messageId, "string");
  assertEquals(logged.length, 1);
  assertEquals(logged[0].subject, sampleMessage.subject);

  assertEquals(createEmailProvider({ provider: "console" }).name, "console");
  assertEquals(
    createEmailProvider({ provider: "resend", apiKey: "k" }).name,
    "resend",
  );
});
