import { assertEquals } from "@std/assert";
import {
  ConfigurationError,
  EmailDeliveryError,
  RepositoryError,
  ValidationError,
} from "../domain/errors.ts";
import type { SubmitContactResult } from "../domain/types.ts";
import { createContactHandler, type SubmitContactExecutor } from "../handler.ts";

class StubSubmitContact implements SubmitContactExecutor {
  impl: (rawInput: unknown) => Promise<SubmitContactResult>;

  constructor(impl: (rawInput: unknown) => Promise<SubmitContactResult>) {
    this.impl = impl;
  }

  execute(rawInput: unknown): Promise<SubmitContactResult> {
    return this.impl(rawInput);
  }
}

Deno.test("handler returns 201 on valid POST request", async () => {
  const handler = createContactHandler({
    submitContact: new StubSubmitContact(() =>
      Promise.resolve({
        id: "id-1",
        status: "sent",
        createdAt: "2026-11-18T13:30:00.000Z",
      })
    ),
  });

  const res = await handler(
    new Request("https://example.test/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Jane",
        email: "jane@example.com",
        message: "Hi",
      }),
    }),
  );

  assertEquals(res.status, 201);
  assertEquals(await res.json(), {
    success: true,
    data: {
      id: "id-1",
      status: "sent",
      createdAt: "2026-11-18T13:30:00.000Z",
    },
  });
});

Deno.test("handler returns 405 for non-POST requests", async () => {
  const handler = createContactHandler({
    submitContact: new StubSubmitContact(() => {
      throw new Error("should not execute");
    }),
  });

  const res = await handler(
    new Request("https://example.test/contact", { method: "GET" }),
  );

  assertEquals(res.status, 405);
  assertEquals(res.headers.get("allow"), "POST, OPTIONS");
  const body = await res.json();
  assertEquals(body.error.code, "METHOD_NOT_ALLOWED");
});

Deno.test("handler returns 415 when Content-Type is not application/json", async () => {
  const handler = createContactHandler({
    submitContact: new StubSubmitContact(() => {
      throw new Error("should not execute");
    }),
  });

  const res = await handler(
    new Request("https://example.test/contact", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "hello",
    }),
  );

  assertEquals(res.status, 415);
  const body = await res.json();
  assertEquals(body.error.code, "UNSUPPORTED_MEDIA_TYPE");
});

Deno.test("handler returns 413 when body exceeds byte limit", async () => {
  const handler = createContactHandler({
    submitContact: new StubSubmitContact(() => {
      throw new Error("should not execute");
    }),
    maxBodyBytes: 32,
  });

  const res = await handler(
    new Request("https://example.test/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "a".repeat(100) }),
    }),
  );

  assertEquals(res.status, 413);
  const body = await res.json();
  assertEquals(body.error.code, "PAYLOAD_TOO_LARGE");
});

Deno.test("handler returns 400 on malformed JSON or ValidationError", async () => {
  const handler = createContactHandler({
    submitContact: new StubSubmitContact(() => {
      throw new ValidationError([{ field: "email", message: "invalid" }]);
    }),
  });

  const malformedRes = await handler(
    new Request("https://example.test/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{bad json",
    }),
  );
  assertEquals(malformedRes.status, 400);
  assertEquals((await malformedRes.json()).error.code, "INVALID_JSON");

  const validationRes = await handler(
    new Request("https://example.test/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }),
  );
  assertEquals(validationRes.status, 400);
  const validationBody = await validationRes.json();
  assertEquals(validationBody.error.code, "VALIDATION_ERROR");
  assertEquals(validationBody.error.details, [
    { field: "email", message: "invalid" },
  ]);
});

Deno.test("handler maps EmailDeliveryError to 502 and infrastructure errors to 500", async () => {
  const originalError = console.error;
  console.error = () => undefined;
  try {
    const deliveryHandler = createContactHandler({
      submitContact: new StubSubmitContact(() => {
        throw new EmailDeliveryError("resend", "Provider down", "sub-123");
      }),
    });

    const deliveryRes = await deliveryHandler(
      new Request("https://example.test/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    assertEquals(deliveryRes.status, 502);
    assertEquals(await deliveryRes.json(), {
      success: false,
      error: {
        code: "DELIVERY_FAILED",
        message: "Provider down",
        details: { submissionId: "sub-123" },
      },
    });

    for (
      const err of [
        new ConfigurationError("Missing key"),
        new RepositoryError("DB down"),
      ]
    ) {
      const errorHandler = createContactHandler({
        submitContact: new StubSubmitContact(() => {
          throw err;
        }),
      });
      const res = await errorHandler(
        new Request("https://example.test/contact", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }),
      );
      assertEquals(res.status, 500);
    }
  } finally {
    console.error = originalError;
  }
});
