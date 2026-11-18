import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { type ContactConfig, loadContactConfig } from "./config.ts";
import { withCors } from "./cors.ts";
import { ConfigurationError } from "./domain/errors.ts";
import type { EmailProvider } from "./domain/ports.ts";
import { createContactHandler } from "./handler.ts";
import { createEmailProvider } from "./providers/email-provider-factory.ts";
import { SupabaseContactRepository } from "./repositories/supabase-contact-repository.ts";
import { SubmitContactUseCase } from "./use-cases/submit-contact.ts";

interface CachedRuntime {
  config: ContactConfig;
  emailProvider: EmailProvider;
}

let cachedRuntime: CachedRuntime | null = null;

function getRuntime(): CachedRuntime {
  if (cachedRuntime) {
    return cachedRuntime;
  }

  const config = loadContactConfig();
  const emailProvider = createEmailProvider(config.emailProvider);
  cachedRuntime = { config, emailProvider };
  return cachedRuntime;
}

const supabaseHandler = withSupabase(
  {
    auth: ["publishable", "secret"],
    cors: "disabled",
  },
  async (req, ctx) => {
    let runtime: CachedRuntime;
    try {
      runtime = getRuntime();
    } catch (error) {
      if (error instanceof ConfigurationError) {
        console.error("Contact API configuration error:", error.message);
        return Response.json(
          {
            success: false,
            error: {
              code: error.code,
              message: "Contact service is not properly configured.",
            },
          },
          { status: 500 },
        );
      }
      throw error;
    }

    const contactRepository = new SupabaseContactRepository(ctx.supabaseAdmin);
    const submitContact = new SubmitContactUseCase({
      contactRepository,
      emailProvider: runtime.emailProvider,
      fromEmail: runtime.config.fromEmail,
      toEmails: runtime.config.toEmails,
    });

    const handleContact = createContactHandler({ submitContact });
    return await handleContact(req);
  },
);

export default {
  fetch: withCors(
    () => {
      try {
        return getRuntime().config.allowedOrigins;
      } catch {
        // Defer configuration errors to the inner handler so JSON error formatting applies.
        return ["*"];
      }
    },
    supabaseHandler,
  ),
};
