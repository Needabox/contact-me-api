import type {
  ContactRecord,
  EmailMessage,
  EmailSendResult,
  NormalizedContactInput,
} from "./types.ts";

export interface EmailDeliverySuccess {
  provider: string;
  messageId: string | null;
  sentAt: string;
}

export interface EmailDeliveryFailure {
  provider: string;
  errorMessage: string;
}

export interface ContactRepository {
  create(input: NormalizedContactInput): Promise<ContactRecord>;
  markEmailSent(id: string, details: EmailDeliverySuccess): Promise<void>;
  markEmailFailed(id: string, details: EmailDeliveryFailure): Promise<void>;
}

export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<EmailSendResult>;
}
