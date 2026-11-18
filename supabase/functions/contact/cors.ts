const DEFAULT_ALLOW_HEADERS =
  "authorization, x-client-info, apikey, content-type";
const DEFAULT_ALLOW_METHODS = "POST, OPTIONS";

export interface CorsEvaluation {
  allowed: boolean;
  headers: Record<string, string>;
}

/** Computes CORS response headers for an incoming Origin against configured allowlist. */
export function evaluateCors(
  originHeader: string | null,
  allowedOrigins: string[],
): CorsEvaluation {
  if (allowedOrigins.includes("*")) {
    return {
      allowed: true,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": DEFAULT_ALLOW_HEADERS,
        "Access-Control-Allow-Methods": DEFAULT_ALLOW_METHODS,
      },
    };
  }

  if (originHeader === null) {
    return {
      allowed: true,
      headers: {
        "Vary": "Origin",
      },
    };
  }

  if (allowedOrigins.includes(originHeader)) {
    return {
      allowed: true,
      headers: {
        "Access-Control-Allow-Origin": originHeader,
        "Access-Control-Allow-Headers": DEFAULT_ALLOW_HEADERS,
        "Access-Control-Allow-Methods": DEFAULT_ALLOW_METHODS,
        "Vary": "Origin",
      },
    };
  }

  return {
    allowed: false,
    headers: {
      "Vary": "Origin",
    },
  };
}

/** Wraps a Web Fetch handler with preflight handling and CORS response headers. */
export function withCors(
  getAllowedOrigins: () => string[],
  next: (req: Request) => Promise<Response>,
): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    let allowedOrigins: string[];
    try {
      allowedOrigins = getAllowedOrigins();
    } catch {
      allowedOrigins = ["*"];
    }

    const cors = evaluateCors(req.headers.get("origin"), allowedOrigins);

    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: cors.allowed ? 204 : 403,
        headers: cors.headers,
      });
    }

    const response = await next(req);
    const headers = new Headers(response.headers);

    for (const [key, value] of Object.entries(cors.headers)) {
      if (key.toLowerCase() === "vary") {
        const existingVary = headers.get("vary");
        if (!existingVary) {
          headers.set("Vary", value);
        } else if (
          !existingVary
            .split(",")
            .map((v) => v.trim().toLowerCase())
            .includes("origin")
        ) {
          headers.set("Vary", `${existingVary}, Origin`);
        }
      } else {
        headers.set(key, value);
      }
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
}
