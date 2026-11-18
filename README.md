# VIBIX Contact API

Reusable, provider-agnostic Contact API built on **Supabase Edge Functions** (TypeScript / Deno 2) and **Supabase PostgreSQL**.

## Architecture

The `contact` Edge Function separates transport, business logic, persistence, and email delivery behind explicit interfaces:

- **`index.ts`**: Edge entrypoint and dependency-injection composition root (`withSupabase` + `withCors`).
- **`config.ts` / `cors.ts`**: Runtime environment validation and CORS enforcement.
- **`handler.ts`**: Web Standard `Request` / `Response` layer (method checks, body size limit, JSON parsing, HTTP error mapping).
- **`domain/`**: Pure TypeScript entities, validation rules, error types, and `ContactRepository` / `EmailProvider` ports (zero Supabase SDK imports).
- **`use-cases/submit-contact.ts`**: `SubmitContactUseCase` orchestrating validation, PostgreSQL persistence, notification email composition, and delivery status updates.
- **`repositories/supabase-contact-repository.ts`**: `ContactRepository` implementation backed by `public.contact_submissions`.
- **`providers/`**: `EmailProvider` implementations (`ResendEmailProvider`, `ConsoleEmailProvider`) and `createEmailProvider` factory.

## API Contract

### `POST /functions/v1/contact`

Requires a valid Supabase `publishable` or `secret` key in the `apikey` header (enforced via `withSupabase({ auth: ["publishable", "secret"] })`).

#### Request Body (`application/json`, max 32 KB)

```json
{
  "name": "Jane Doe",
  "email": "jane@example.com",
  "subject": "Partnership inquiry",
  "message": "Hello team, we would like to collaborate.",
  "phone": "+62 812 0000 0000",
  "company": "Acme Corp",
  "source": "vibix-web",
  "metadata": {
    "locale": "en"
  }
}
```

- Required: `name` (1–120 chars), `email` (valid email, max 254 chars), `message` (1–5000 chars)
- Optional: `subject` (max 200 chars), `phone` (max 40 chars), `company` (max 120 chars), `source` (max 100 chars), `metadata` (flat JSON object, max 20 keys / 4096 bytes)

#### Responses

- **`201 Created`**
  ```json
  {
    "success": true,
    "data": {
      "id": "<uuid>",
      "status": "sent",
      "createdAt": "2026-11-18T13:30:00.000Z"
    }
  }
  ```
- **`400 Bad Request`**: Malformed JSON or validation errors (`INVALID_JSON`, `VALIDATION_ERROR`)
- **`401 Unauthorized`**: Missing or invalid `apikey` header
- **`405 Method Not Allowed`**: Non-`POST` methods (`METHOD_NOT_ALLOWED`)
- **`413 Payload Too Large`**: Request body > 32 KB (`PAYLOAD_TOO_LARGE`)
- **`415 Unsupported Media Type`**: Missing `application/json` `Content-Type` (`UNSUPPORTED_MEDIA_TYPE`)
- **`502 Bad Gateway`**: Submission persisted in PostgreSQL (`email_status = 'failed'`), but email provider delivery failed (`DELIVERY_FAILED`)
- **`500 Internal Server Error`**: Configuration or database failure (`CONFIGURATION_ERROR`, `INTERNAL_ERROR`)

## Environment Variables

See [`.env.example`](./.env.example).

- `EMAIL_PROVIDER`: `"resend"` or `"console"`
- `CONTACT_FROM_EMAIL`: Verified sender address (`email@domain` or `Display Name <email@domain>`)
- `CONTACT_TO_EMAIL`: Comma-separated recipient inbox email(s)
- `RESEND_API_KEY`: Required when `EMAIL_PROVIDER=resend`
- `RESEND_BASE_URL` *(optional)*: Override Resend API base URL
- `ALLOWED_ORIGINS` *(optional)*: Comma-separated allowed CORS origins (defaults to `*`)

Runtime variables `SUPABASE_URL`, `SUPABASE_ANON_KEY` / `SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_SECRET_KEY` are injected automatically by the Supabase Edge Runtime.

## Local Development & Testing

```bash
# Start local Supabase stack (requires Docker)
supabase start

# Apply local migrations
supabase db reset

# Serve the contact function locally with an env file
supabase functions serve contact --env-file supabase/.env.local

# Type-check, lint, and run unit tests (requires Deno 2)
cd supabase/functions/contact
deno task check
deno task lint
deno task test
```

> **Note for Supabase GitHub Integration:** `supabase/.gitignore` currently ignores `config.toml` from the initial CLI scaffold. If you want `[functions.contact]` settings (`verify_jwt = false`, `deno_version = 2`) tracked in Git for automated GitHub deployments, remove `config.toml` from `supabase/.gitignore` before pushing.
