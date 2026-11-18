import { ConfigurationError } from "./domain/errors.ts";
import { isValidEmailAddress } from "./domain/validation.ts";
import type { EmailProviderConfig } from "./providers/email-provider-factory.ts";

export type EnvReader = (key: string) => string | undefined;

export interface ContactConfig {
  emailProvider: EmailProviderConfig;
  fromEmail: string;
  toEmails: string[];
  allowedOrigins: string[];
}

const CONTROL_CHARS = /[\r\n\0]/;
const DISPLAY_NAME_EMAIL_REGEX = /^[^<>]+<([^<>]+)>$/;

function defaultReadEnv(key: string): string | undefined {
  return Deno.env.get(key);
}

function readRequiredEnv(readEnv: EnvReader, key: string): string {
  const value = readEnv(key)?.trim();
  if (!value) {
    throw new ConfigurationError(
      `Missing required environment variable '${key}'.`,
    );
  }
  if (CONTROL_CHARS.test(value)) {
    throw new ConfigurationError(
      `Environment variable '${key}' contains invalid control characters.`,
    );
  }
  return value;
}

function validateSenderEmail(value: string, key: string): string {
  if (isValidEmailAddress(value)) {
    return value.toLowerCase();
  }

  const match = DISPLAY_NAME_EMAIL_REGEX.exec(value);
  if (match) {
    const address = match[1].trim().toLowerCase();
    const displayName = value.slice(0, value.indexOf("<")).trim();
    if (displayName.length > 0 && isValidEmailAddress(address)) {
      return `${displayName} <${address}>`;
    }
  }

  throw new ConfigurationError(
    `Environment variable '${key}' must be a valid email address or 'Name <email@domain>'.`,
  );
}

function parseRecipientEmails(rawValue: string, key: string): string[] {
  const recipients = rawValue
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length > 0);

  if (recipients.length === 0) {
    throw new ConfigurationError(
      `Environment variable '${key}' must contain at least one email address.`,
    );
  }

  for (const email of recipients) {
    if (!isValidEmailAddress(email)) {
      throw new ConfigurationError(
        `Environment variable '${key}' contains an invalid email address: '${email}'.`,
      );
    }
  }

  return [...new Set(recipients)];
}

/** Parses ALLOWED_ORIGINS into '*' or exact HTTP(S) origin strings. */
export function parseAllowedOrigins(rawValue?: string): string[] {
  const trimmed = rawValue?.trim();
  if (!trimmed || trimmed === "*") {
    return ["*"];
  }

  const origins = trimmed
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (origins.length === 0 || origins.includes("*")) {
    return ["*"];
  }

  const normalized: string[] = [];
  for (const entry of origins) {
    let parsed: URL;
    try {
      parsed = new URL(entry);
    } catch {
      throw new ConfigurationError(
        `Environment variable 'ALLOWED_ORIGINS' contains an invalid URL: '${entry}'.`,
      );
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new ConfigurationError(
        `Environment variable 'ALLOWED_ORIGINS' only supports http/https origins: '${entry}'.`,
      );
    }

    normalized.push(parsed.origin);
  }

  return [...new Set(normalized)];
}

function validateHttpUrl(value: string, key: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ConfigurationError(
      `Environment variable '${key}' must be a valid URL.`,
    );
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ConfigurationError(
      `Environment variable '${key}' must use http or https protocol.`,
    );
  }

  return value.replace(/\/+$/, "");
}

/** Loads and validates runtime environment configuration for the Contact API. */
export function loadContactConfig(
  readEnv: EnvReader = defaultReadEnv,
): ContactConfig {
  const providerName = readRequiredEnv(readEnv, "EMAIL_PROVIDER").toLowerCase();
  const fromEmail = validateSenderEmail(
    readRequiredEnv(readEnv, "CONTACT_FROM_EMAIL"),
    "CONTACT_FROM_EMAIL",
  );
  const toEmails = parseRecipientEmails(
    readRequiredEnv(readEnv, "CONTACT_TO_EMAIL"),
    "CONTACT_TO_EMAIL",
  );
  const allowedOrigins = parseAllowedOrigins(readEnv("ALLOWED_ORIGINS"));

  let emailProvider: EmailProviderConfig;
  switch (providerName) {
    case "resend": {
      const apiKey = readRequiredEnv(readEnv, "RESEND_API_KEY");
      const rawBaseUrl = readEnv("RESEND_BASE_URL")?.trim();
      emailProvider = {
        provider: "resend",
        apiKey,
        ...(rawBaseUrl
          ? { baseUrl: validateHttpUrl(rawBaseUrl, "RESEND_BASE_URL") }
          : {}),
      };
      break;
    }
    case "console": {
      emailProvider = { provider: "console" };
      break;
    }
    default:
      throw new ConfigurationError(
        `Unsupported EMAIL_PROVIDER '${providerName}'. Supported values: resend, console.`,
      );
  }

  return {
    emailProvider,
    fromEmail,
    toEmails,
    allowedOrigins,
  };
}
