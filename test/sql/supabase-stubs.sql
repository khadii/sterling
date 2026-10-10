-- ONLY for an empty disposable local PostgreSQL database. Not a production migration.
create role anon;
create role authenticated;
create role service_role bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql as 'select null::uuid';
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}', email_confirmed_at timestamptz);
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);

-- Hosted Supabase grants the postgres role's default privileges to service_role,
-- which is why the API can read workspace tables it never owned. anon and
-- authenticated deliberately receive nothing here: those roles only ever reach
-- data through explicit row level security policies.
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant execute on functions to service_role;
grant usage on schema public, auth, storage to service_role;
