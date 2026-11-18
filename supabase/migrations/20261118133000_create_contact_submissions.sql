-- Create table for contact form submissions persisted by the Contact Edge Function.
create table if not exists public.contact_submissions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  subject text,
  message text not null,
  phone text,
  company text,
  source text,
  metadata jsonb not null default '{}'::jsonb,
  email_status text not null default 'pending',
  email_provider text,
  provider_message_id text,
  email_error text,
  sent_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),

  constraint contact_submissions_name_length_chk
    check (char_length(btrim(name)) between 1 and 120),
  constraint contact_submissions_email_length_chk
    check (char_length(email) between 3 and 254),
  constraint contact_submissions_subject_length_chk
    check (subject is null or char_length(subject) <= 200),
  constraint contact_submissions_message_length_chk
    check (char_length(btrim(message)) between 1 and 5000),
  constraint contact_submissions_phone_length_chk
    check (phone is null or char_length(phone) <= 40),
  constraint contact_submissions_company_length_chk
    check (company is null or char_length(company) <= 120),
  constraint contact_submissions_source_length_chk
    check (source is null or char_length(source) <= 100),
  constraint contact_submissions_metadata_object_chk
    check (jsonb_typeof(metadata) = 'object'),
  constraint contact_submissions_email_status_chk
    check (email_status in ('pending', 'sent', 'failed'))
);

comment on table public.contact_submissions is
  'Stores contact API submissions and email notification delivery state.';

create index if not exists idx_contact_submissions_created_at
  on public.contact_submissions (created_at desc);

create index if not exists idx_contact_submissions_email_status
  on public.contact_submissions (email_status);

create index if not exists idx_contact_submissions_source
  on public.contact_submissions (source)
  where source is not null;

create or replace function public.set_contact_submissions_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists trg_contact_submissions_updated_at on public.contact_submissions;

create trigger trg_contact_submissions_updated_at
  before update on public.contact_submissions
  for each row
  execute function public.set_contact_submissions_updated_at();

alter table public.contact_submissions enable row level security;

-- Lock down direct PostgREST access; writes and status updates go through the Contact Edge Function.
revoke all on table public.contact_submissions from public, anon, authenticated;
grant select, insert, update on table public.contact_submissions to service_role;
