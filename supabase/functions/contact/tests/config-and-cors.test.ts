import { assertEquals, assertThrows } from "@std/assert";
import { loadContactConfig, parseAllowedOrigins } from "../config.ts";
import { evaluateCors, withCors } from "../cors.ts";
import { ConfigurationError } from "../domain/errors.ts";

function makeEnvReader(values: Record<string, string>): (key: string) => string | undefined {
  return (key) => values[key];
}

Deno.test("loadContactConfig loads resend and console configurations", () => {
  const resendCfg = loadContactConfig(makeEnvReader({
    EMAIL_PROVIDER: "resend",
    RESEND_API_KEY: "test-key",
    RESEND_BASE_URL: "https://api.resend.com/",
    CONTACT_FROM_EMAIL: "VIBIX <contact@vibix.test>",
    CONTACT_TO_EMAIL: "a@vibix.test, b@vibix.test, a@vibix.test",
    ALLOWED_ORIGINS: "https://vibix.test, https://app.vibix.test/",
  }));

  assertEquals(resendCfg, {
    emailProvider: {
      provider: "resend",
      apiKey: "test-key",
      baseUrl: "https://api.resend.com",
    },
    fromEmail: "VIBIX <contact@vibix.test>",
    toEmails: ["a@vibix.test", "b@vibix.test"],
    allowedOrigins: ["https://vibix.test", "https://app.vibix.test"],
  });

  const consoleCfg = loadContactConfig(makeEnvReader({
    EMAIL_PROVIDER: "console",
    CONTACT_FROM_EMAIL: "contact@vibix.test",
    CONTACT_TO_EMAIL: "team@vibix.test",
  }));

  assertEquals(consoleCfg.emailProvider, { provider: "console" });
  assertEquals(consoleCfg.allowedOrigins, ["*"]);
});

Deno.test("loadContactConfig rejects missing or invalid configuration", () => {
  assertThrows(
    () => loadContactConfig(makeEnvReader({})),
    ConfigurationError,
    "EMAIL_PROVIDER",
  );

  assertThrows(
    () =>
      loadContactConfig(makeEnvReader({
        EMAIL_PROVIDER: "resend",
        CONTACT_FROM_EMAIL: "contact@vibix.test",
        CONTACT_TO_EMAIL: "team@vibix.test",
      })),
    ConfigurationError,
    "RESEND_API_KEY",
  );

  assertThrows(
    () =>
      loadContactConfig(makeEnvReader({
        EMAIL_PROVIDER: "unknown",
        CONTACT_FROM_EMAIL: "contact@vibix.test",
        CONTACT_TO_EMAIL: "team@vibix.test",
      })),
    ConfigurationError,
    "Unsupported EMAIL_PROVIDER",
  );

  assertThrows(
    () => parseAllowedOrigins("not-a-url"),
    ConfigurationError,
  );
});

Deno.test("withCors handles preflight and appends CORS headers for allowlisted origins", async () => {
  const handler = withCors(
    () => ["https://vibix.test"],
    () => Promise.resolve(Response.json({ ok: true }, { status: 201 })),
  );

  const allowedPreflight = await handler(
    new Request("https://api.test/contact", {
      method: "OPTIONS",
      headers: { Origin: "https://vibix.test" },
    }),
  );
  assertEquals(allowedPreflight.status, 204);
  assertEquals(
    allowedPreflight.headers.get("access-control-allow-origin"),
    "https://vibix.test",
  );

  const deniedPreflight = await handler(
    new Request("https://api.test/contact", {
      method: "OPTIONS",
      headers: { Origin: "https://evil.test" },
    }),
  );
  assertEquals(deniedPreflight.status, 403);
  assertEquals(
    deniedPreflight.headers.get("access-control-allow-origin"),
    null,
  );

  const postAllowed = await handler(
    new Request("https://api.test/contact", {
      method: "POST",
      headers: { Origin: "https://vibix.test" },
    }),
  );
  assertEquals(postAllowed.status, 201);
  assertEquals(
    postAllowed.headers.get("access-control-allow-origin"),
    "https://vibix.test",
  );
  assertEquals(postAllowed.headers.get("vary"), "Origin");

  assertEquals(
    evaluateCors(null, ["https://vibix.test"]).allowed,
    true,
  );
});
