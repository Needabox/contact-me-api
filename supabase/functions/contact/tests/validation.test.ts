import { assertEquals, assertThrows } from "@std/assert";
import { ValidationError } from "../domain/errors.ts";
import {
  escapeHtml,
  isValidEmailAddress,
  normalizeAndValidateContactInput,
} from "../domain/validation.ts";

Deno.test("isValidEmailAddress validates standard addresses and rejects invalid ones", () => {
  assertEquals(isValidEmailAddress("user@example.com"), true);
  assertEquals(isValidEmailAddress("first.last+tag@sub.domain.co.id"), true);

  assertEquals(isValidEmailAddress(""), false);
  assertEquals(isValidEmailAddress("missing-at.com"), false);
  assertEquals(isValidEmailAddress("user@localhost"), false);
  assertEquals(isValidEmailAddress("user@.example.com"), false);
  assertEquals(isValidEmailAddress(".user@example.com"), false);
  assertEquals(isValidEmailAddress("user..name@example.com"), false);
  assertEquals(isValidEmailAddress("user@example.123"), false);
  assertEquals(isValidEmailAddress("user@example.com\r\nBcc:evil@x.com"), false);
});

Deno.test("normalizeAndValidateContactInput normalizes valid payload", () => {
  const result = normalizeAndValidateContactInput({
    name: "  Jane Doe  ",
    email: "  JANE@Example.COM ",
    subject: "  Partnership ",
    message: "Hello\r\nWorld  ",
    phone: "  +62 812 0000  ",
    company: "  VIBIX  ",
    source: "  vibix-web ",
    metadata: { locale: "en", priority: 1, optIn: true, ref: null },
  });

  assertEquals(result, {
    name: "Jane Doe",
    email: "jane@example.com",
    subject: "Partnership",
    message: "Hello\nWorld",
    phone: "+62 812 0000",
    company: "VIBIX",
    source: "vibix-web",
    metadata: { locale: "en", priority: 1, optIn: true, ref: null },
  });
});

Deno.test("normalizeAndValidateContactInput treats blank optional fields as null", () => {
  const result = normalizeAndValidateContactInput({
    name: "Jane Doe",
    email: "jane@example.com",
    message: "Hello",
    subject: "   ",
    phone: "",
    company: null,
  });

  assertEquals(result.subject, null);
  assertEquals(result.phone, null);
  assertEquals(result.company, null);
  assertEquals(result.source, null);
  assertEquals(result.metadata, {});
});

Deno.test("normalizeAndValidateContactInput rejects non-object body", () => {
  const err = assertThrows(
    () => normalizeAndValidateContactInput(["not", "an", "object"]),
    ValidationError,
  );
  assertEquals(err.details[0].field, "body");
});

Deno.test("normalizeAndValidateContactInput rejects header injection and invalid metadata", () => {
  const err = assertThrows(
    () =>
      normalizeAndValidateContactInput({
        name: "Jane\nBcc:evil@test.com",
        email: "not-an-email",
        message: " ",
        metadata: { nested: { bad: true } },
      }),
    ValidationError,
  );

  const fields = err.details.map((d) => d.field);
  assertEquals(fields.includes("name"), true);
  assertEquals(fields.includes("email"), true);
  assertEquals(fields.includes("message"), true);
  assertEquals(fields.includes("metadata.nested"), true);
});

Deno.test("escapeHtml escapes HTML special characters", () => {
  assertEquals(
    escapeHtml(`<script>alert("xss" & 'test')</script>`),
    "&lt;script&gt;alert(&quot;xss&quot; &amp; &#39;test&#39;)&lt;/script&gt;",
  );
});

Deno.test("normalizeAndValidateContactInput enforces field and metadata limits", () => {
  const tooManyKeys: Record<string, string> = {};
  for (let i = 0; i < 21; i++) {
    tooManyKeys[`k${i}`] = "v";
  }

  const err = assertThrows(
    () =>
      normalizeAndValidateContactInput({
        name: "a".repeat(121),
        email: "jane@example.com",
        message: "b".repeat(5001),
        metadata: tooManyKeys,
      }),
    ValidationError,
  );

  const fields = err.details.map((d) => d.field);
  assertEquals(fields, ["name", "message", "metadata"]);
});
