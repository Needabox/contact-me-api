import { ConfigurationError } from "../domain/errors.ts";
import type { EmailProvider } from "../domain/ports.ts";
import { ConsoleEmailProvider } from "./console-email-provider.ts";
import { ResendEmailProvider } from "./resend-email-provider.ts";

export type EmailProviderConfig =
  | {
    provider: "resend";
    apiKey: string;
    baseUrl?: string;
  }
  | {
    provider: "console";
  };

/** Instantiates the configured EmailProvider implementation. */
export function createEmailProvider(config: EmailProviderConfig): EmailProvider {
  switch (config.provider) {
    case "resend":
      return new ResendEmailProvider({
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
      });
    case "console":
      return new ConsoleEmailProvider();
    default: {
      const exhaustiveCheck: never = config;
      throw new ConfigurationError(
        `Unsupported email provider configuration: ${JSON.stringify(exhaustiveCheck)}`,
      );
    }
  }
}
