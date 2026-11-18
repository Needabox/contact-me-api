import {
  ConfigurationError,
  EmailDeliveryError,
  RepositoryError,
  ValidationError,
} from "./domain/errors.ts";
import type { SubmitContactResult } from "./domain/types.ts";

export interface SubmitContactExecutor {
  execute(rawInput: unknown): Promise<SubmitContactResult>;
}

export interface ContactHandlerDependencies {
  submitContact: SubmitContactExecutor;
  maxBodyBytes?: number;
}

const DEFAULT_MAX_BODY_BYTES = 32 * 1024;

class PayloadTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`Request body exceeds maximum size of ${maxBytes} bytes.`);
    this.name = "PayloadTooLargeError";
  }
}

function jsonError(
  status: number,
  code: string,
  message: string,
  details?: unknown,
  extraHeaders?: Record<string, string>,
): Response {
  const errorPayload: Record<string, unknown> = { code, message };
  if (details !== undefined) {
    errorPayload.details = details;
  }

  return Response.json(
    {
      success: false,
      error: errorPayload,
    },
    {
      status,
      headers: extraHeaders,
    },
  );
}

async function readTextWithByteLimit(
  req: Request,
  maxBytes: number,
): Promise<string> {
  const declaredLength = req.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (Number.isFinite(parsedLength) && parsedLength > maxBytes) {
      throw new PayloadTooLargeError(maxBytes);
    }
  }

  if (!req.body) {
    return "";
  }

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    if (value) {
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new PayloadTooLargeError(maxBytes);
      }
      chunks.push(value);
    }
  }

  const merged = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(merged);
}

/** Creates the HTTP Request -> Response handler for the Contact API. */
export function createContactHandler(
  deps: ContactHandlerDependencies,
): (req: Request) => Promise<Response> {
  const maxBodyBytes = deps.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;

  return async (req: Request): Promise<Response> => {
    if (req.method !== "POST") {
      return jsonError(
        405,
        "METHOD_NOT_ALLOWED",
        "Only POST requests are supported.",
        undefined,
        { "Allow": "POST, OPTIONS" },
      );
    }

    const contentType = req.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.includes("application/json")) {
      return jsonError(
        415,
        "UNSUPPORTED_MEDIA_TYPE",
        "Content-Type header must be application/json.",
      );
    }

    let rawText: string;
    try {
      rawText = await readTextWithByteLimit(req, maxBodyBytes);
    } catch (error) {
      if (error instanceof PayloadTooLargeError) {
        return jsonError(413, "PAYLOAD_TOO_LARGE", error.message);
      }
      console.error("Failed reading request body:", error);
      return jsonError(400, "INVALID_BODY", "Unable to read request body.");
    }

    if (rawText.trim().length === 0) {
      return jsonError(400, "INVALID_JSON", "Request body must not be empty.");
    }

    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(rawText);
    } catch {
      return jsonError(
        400,
        "INVALID_JSON",
        "Request body must be valid JSON.",
      );
    }

    try {
      const result = await deps.submitContact.execute(parsedBody);
      return Response.json(
        {
          success: true,
          data: result,
        },
        { status: 201 },
      );
    } catch (error) {
      if (error instanceof ValidationError) {
        return jsonError(400, error.code, error.message, error.details);
      }

      if (error instanceof EmailDeliveryError) {
        console.error(
          `Email delivery failed via provider '${error.provider}' for submission '${error.submissionId ?? "unknown"}':`,
          error,
        );
        return jsonError(
          502,
          error.code,
          error.message,
          error.submissionId ? { submissionId: error.submissionId } : undefined,
        );
      }

      if (error instanceof ConfigurationError) {
        console.error("Contact API configuration error:", error.message);
        return jsonError(
          500,
          error.code,
          "Contact service is not properly configured.",
        );
      }

      if (error instanceof RepositoryError) {
        console.error("Contact repository error:", error);
        return jsonError(
          500,
          "INTERNAL_ERROR",
          "Failed to process contact submission.",
        );
      }

      console.error("Unexpected Contact API error:", error);
      return jsonError(
        500,
        "INTERNAL_ERROR",
        "An unexpected error occurred while processing the contact submission.",
      );
    }
  };
}
