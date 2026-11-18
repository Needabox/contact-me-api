import { RepositoryError } from "../domain/errors.ts";
import type {
  ContactRepository,
  EmailDeliveryFailure,
  EmailDeliverySuccess,
} from "../domain/ports.ts";
import type {
  ContactRecord,
  EmailStatus,
  NormalizedContactInput,
} from "../domain/types.ts";

export interface DatabaseErrorLike {
  message: string;
  code?: string;
}

export interface DatabaseQueryResult<TData = unknown> {
  data?: TData | null;
  error: DatabaseErrorLike | null;
}

export interface DatabaseInsertBuilder {
  select(columns?: string): {
    single(): PromiseLike<DatabaseQueryResult<unknown>>;
  };
}

export interface DatabaseUpdateBuilder {
  eq(column: string, value: string): PromiseLike<{ error: DatabaseErrorLike | null }>;
}

/** Minimal structural subset of SupabaseClient needed for table persistence. */
export interface SupabaseTableClient {
  from(table: string): {
    insert(values: Record<string, unknown>): DatabaseInsertBuilder;
    update(values: Record<string, unknown>): DatabaseUpdateBuilder;
  };
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asRequiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new RepositoryError(
      `Invalid database row: missing or invalid '${field}'.`,
    );
  }
  return value;
}

function asEmailStatus(value: unknown): EmailStatus {
  if (value === "pending" || value === "sent" || value === "failed") {
    return value;
  }
  throw new RepositoryError(
    `Invalid database row: unexpected email_status '${String(value)}'.`,
  );
}

function mapRowToContactRecord(rawRow: unknown): ContactRecord {
  if (typeof rawRow !== "object" || rawRow === null || Array.isArray(rawRow)) {
    throw new RepositoryError("Invalid database row returned from repository.");
  }

  const row = rawRow as Record<string, unknown>;
  const metadata = typeof row.metadata === "object" &&
      row.metadata !== null &&
      !Array.isArray(row.metadata)
    ? (row.metadata as Record<string, unknown>)
    : {};

  return {
    id: asRequiredString(row.id, "id"),
    name: asRequiredString(row.name, "name"),
    email: asRequiredString(row.email, "email"),
    subject: asNullableString(row.subject),
    message: asRequiredString(row.message, "message"),
    phone: asNullableString(row.phone),
    company: asNullableString(row.company),
    source: asNullableString(row.source),
    metadata,
    emailStatus: asEmailStatus(row.email_status),
    emailProvider: asNullableString(row.email_provider),
    providerMessageId: asNullableString(row.provider_message_id),
    emailError: asNullableString(row.email_error),
    sentAt: asNullableString(row.sent_at),
    createdAt: asRequiredString(row.created_at, "created_at"),
    updatedAt: asRequiredString(row.updated_at, "updated_at"),
  };
}

/** PostgreSQL repository adapter backed by an injected Supabase client. */
export class SupabaseContactRepository implements ContactRepository {
  readonly #client: SupabaseTableClient;
  readonly #tableName: string;

  constructor(
    client: SupabaseTableClient,
    tableName = "contact_submissions",
  ) {
    this.#client = client;
    this.#tableName = tableName;
  }

  async create(input: NormalizedContactInput): Promise<ContactRecord> {
    const { data, error } = await this.#client
      .from(this.#tableName)
      .insert({
        name: input.name,
        email: input.email,
        subject: input.subject,
        message: input.message,
        phone: input.phone,
        company: input.company,
        source: input.source,
        metadata: input.metadata,
        email_status: "pending",
      })
      .select("*")
      .single();

    if (error || !data) {
      throw new RepositoryError(
        `Failed to persist contact submission: ${error?.message ?? "no row returned"}`,
        { cause: error ?? undefined },
      );
    }

    return mapRowToContactRecord(data);
  }

  async markEmailSent(id: string, details: EmailDeliverySuccess): Promise<void> {
    const { error } = await this.#client
      .from(this.#tableName)
      .update({
        email_status: "sent",
        email_provider: details.provider,
        provider_message_id: details.messageId,
        email_error: null,
        sent_at: details.sentAt,
      })
      .eq("id", id);

    if (error) {
      throw new RepositoryError(
        `Failed to update contact submission status to sent: ${error.message}`,
        { cause: error },
      );
    }
  }

  async markEmailFailed(
    id: string,
    details: EmailDeliveryFailure,
  ): Promise<void> {
    const { error } = await this.#client
      .from(this.#tableName)
      .update({
        email_status: "failed",
        email_provider: details.provider,
        email_error: details.errorMessage,
      })
      .eq("id", id);

    if (error) {
      throw new RepositoryError(
        `Failed to update contact submission status to failed: ${error.message}`,
        { cause: error },
      );
    }
  }
}
