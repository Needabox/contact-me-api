export type MetadataPrimitive = string | number | boolean | null;

export type ContactMetadata = Record<string, MetadataPrimitive>;

export interface ContactSubmissionInput {
  name: string;
  email: string;
  message: string;
  subject?: string;
  phone?: string;
  company?: string;
  source?: string;
  metadata?: ContactMetadata;
}

export interface NormalizedContactInput {
  name: string;
  email: string;
  message: string;
  subject: string | null;
  phone: string | null;
  company: string | null;
  source: string | null;
  metadata: ContactMetadata;
}

export type EmailStatus = "pending" | "sent" | "failed";

export interface ContactRecord {
  id: string;
  name: string;
  email: string;
  subject: string | null;
  message: string;
  phone: string | null;
  company: string | null;
  source: string | null;
  metadata: Record<string, unknown>;
  emailStatus: EmailStatus;
  emailProvider: string | null;
  providerMessageId: string | null;
  emailError: string | null;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EmailMessage {
  from: string;
  to: string[];
  replyTo: string;
  subject: string;
  text: string;
  html: string;
}

export interface EmailSendResult {
  provider: string;
  messageId: string | null;
}

export interface SubmitContactResult {
  id: string;
  status: EmailStatus;
  createdAt: string;
}
