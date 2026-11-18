import { ValidationError, type ValidationFieldError } from "./errors.ts";
import type {
  ContactMetadata,
  MetadataPrimitive,
  NormalizedContactInput,
} from "./types.ts";

export const FIELD_LIMITS = {
  nameMin: 1,
  nameMax: 120,
  emailMin: 3,
  emailMax: 254,
  subjectMax: 200,
  messageMin: 1,
  messageMax: 5000,
  phoneMax: 40,
  companyMax: 120,
  sourceMax: 100,
  metadataMaxKeys: 20,
  metadataKeyMaxLength: 64,
  metadataValueMaxLength: 500,
  metadataMaxBytes: 4096,
} as const;

const CONTROL_CHARS_SINGLE_LINE = /[\r\n\0]/;
const DOMAIN_LABEL_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Validates an email address without backtracking-prone regexes. */
export function isValidEmailAddress(email: string): boolean {
  if (
    email.length < FIELD_LIMITS.emailMin ||
    email.length > FIELD_LIMITS.emailMax ||
    CONTROL_CHARS_SINGLE_LINE.test(email) ||
    /\s/.test(email)
  ) {
    return false;
  }

  const atIndex = email.indexOf("@");
  if (atIndex <= 0 || atIndex !== email.lastIndexOf("@")) {
    return false;
  }

  const localPart = email.slice(0, atIndex);
  const domainPart = email.slice(atIndex + 1);

  if (localPart.length > 64 || domainPart.length > 253) {
    return false;
  }

  if (localPart.startsWith(".") || localPart.endsWith(".") || localPart.includes("..")) {
    return false;
  }

  const labels = domainPart.split(".");
  if (labels.length < 2) {
    return false;
  }

  for (const label of labels) {
    if (!DOMAIN_LABEL_REGEX.test(label)) {
      return false;
    }
  }

  const tld = labels[labels.length - 1];
  return tld.length >= 2 && !/^\d+$/.test(tld);
}

/** Escapes HTML special characters for safe email body rendering. */
export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function validateRequiredSingleLine(
  record: Record<string, unknown>,
  field: string,
  minLength: number,
  maxLength: number,
  errors: ValidationFieldError[],
): string {
  const raw = record[field];
  if (typeof raw !== "string") {
    errors.push({ field, message: `${field} must be a string.` });
    return "";
  }

  if (CONTROL_CHARS_SINGLE_LINE.test(raw)) {
    errors.push({ field, message: `${field} must not contain line breaks.` });
    return "";
  }

  const trimmed = raw.trim();
  if (trimmed.length < minLength) {
    errors.push({ field, message: `${field} is required.` });
    return "";
  }

  if (trimmed.length > maxLength) {
    errors.push({
      field,
      message: `${field} must be at most ${maxLength} characters.`,
    });
    return "";
  }

  return trimmed;
}

function validateOptionalSingleLine(
  record: Record<string, unknown>,
  field: string,
  maxLength: number,
  errors: ValidationFieldError[],
): string | null {
  const raw = record[field];
  if (raw === undefined || raw === null) {
    return null;
  }

  if (typeof raw !== "string") {
    errors.push({ field, message: `${field} must be a string.` });
    return null;
  }

  if (CONTROL_CHARS_SINGLE_LINE.test(raw)) {
    errors.push({ field, message: `${field} must not contain line breaks.` });
    return null;
  }

  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return null;
  }

  if (trimmed.length > maxLength) {
    errors.push({
      field,
      message: `${field} must be at most ${maxLength} characters.`,
    });
    return null;
  }

  return trimmed;
}

function validateMessage(
  record: Record<string, unknown>,
  errors: ValidationFieldError[],
): string {
  const raw = record.message;
  if (typeof raw !== "string") {
    errors.push({ field: "message", message: "message must be a string." });
    return "";
  }

  if (raw.includes("\0")) {
    errors.push({
      field: "message",
      message: "message contains invalid characters.",
    });
    return "";
  }

  const normalized = raw.replaceAll("\r\n", "\n").trim();
  if (normalized.length < FIELD_LIMITS.messageMin) {
    errors.push({ field: "message", message: "message is required." });
    return "";
  }

  if (normalized.length > FIELD_LIMITS.messageMax) {
    errors.push({
      field: "message",
      message: `message must be at most ${FIELD_LIMITS.messageMax} characters.`,
    });
    return "";
  }

  return normalized;
}

function isValidMetadataValue(value: unknown): value is MetadataPrimitive {
  if (value === null || typeof value === "boolean") {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (typeof value === "string") {
    return !value.includes("\0") && value.length <= FIELD_LIMITS.metadataValueMaxLength;
  }
  return false;
}

function validateMetadata(
  record: Record<string, unknown>,
  errors: ValidationFieldError[],
): ContactMetadata {
  const raw = record.metadata;
  if (raw === undefined || raw === null) {
    return {};
  }

  if (!isPlainObject(raw)) {
    errors.push({
      field: "metadata",
      message: "metadata must be a plain JSON object.",
    });
    return {};
  }

  const entries = Object.entries(raw);
  if (entries.length > FIELD_LIMITS.metadataMaxKeys) {
    errors.push({
      field: "metadata",
      message: `metadata must have at most ${FIELD_LIMITS.metadataMaxKeys} keys.`,
    });
    return {};
  }

  const sanitized: ContactMetadata = {};
  for (const [key, value] of entries) {
    const trimmedKey = key.trim();
    if (
      trimmedKey.length === 0 ||
      trimmedKey.length > FIELD_LIMITS.metadataKeyMaxLength ||
      CONTROL_CHARS_SINGLE_LINE.test(trimmedKey)
    ) {
      errors.push({
        field: "metadata",
        message: "metadata keys must be non-empty strings up to 64 characters.",
      });
      return {};
    }

    if (!isValidMetadataValue(value)) {
      errors.push({
        field: `metadata.${trimmedKey}`,
        message:
          "metadata values must be string (max 500 chars), finite number, boolean, or null.",
      });
      return {};
    }

    sanitized[trimmedKey] = value;
  }

  const byteSize = new TextEncoder().encode(JSON.stringify(sanitized)).length;
  if (byteSize > FIELD_LIMITS.metadataMaxBytes) {
    errors.push({
      field: "metadata",
      message: `metadata exceeds maximum size of ${FIELD_LIMITS.metadataMaxBytes} bytes.`,
    });
    return {};
  }

  return sanitized;
}

/** Validates and normalizes an untrusted contact submission payload. */
export function normalizeAndValidateContactInput(
  rawInput: unknown,
): NormalizedContactInput {
  if (!isPlainObject(rawInput)) {
    throw new ValidationError([
      { field: "body", message: "Request body must be a JSON object." },
    ]);
  }

  const errors: ValidationFieldError[] = [];

  const name = validateRequiredSingleLine(
    rawInput,
    "name",
    FIELD_LIMITS.nameMin,
    FIELD_LIMITS.nameMax,
    errors,
  );

  const rawEmail = validateRequiredSingleLine(
    rawInput,
    "email",
    FIELD_LIMITS.emailMin,
    FIELD_LIMITS.emailMax,
    errors,
  );
  const email = rawEmail.toLowerCase();
  if (rawEmail.length > 0 && !isValidEmailAddress(email)) {
    errors.push({ field: "email", message: "email must be a valid email address." });
  }

  const message = validateMessage(rawInput, errors);
  const subject = validateOptionalSingleLine(
    rawInput,
    "subject",
    FIELD_LIMITS.subjectMax,
    errors,
  );
  const phone = validateOptionalSingleLine(
    rawInput,
    "phone",
    FIELD_LIMITS.phoneMax,
    errors,
  );
  const company = validateOptionalSingleLine(
    rawInput,
    "company",
    FIELD_LIMITS.companyMax,
    errors,
  );
  const source = validateOptionalSingleLine(
    rawInput,
    "source",
    FIELD_LIMITS.sourceMax,
    errors,
  );
  const metadata = validateMetadata(rawInput, errors);

  if (errors.length > 0) {
    throw new ValidationError(errors);
  }

  return {
    name,
    email,
    message,
    subject,
    phone,
    company,
    source,
    metadata,
  };
}
