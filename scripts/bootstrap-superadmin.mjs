import { randomBytes } from 'node:crypto';
import { readFileSync, appendFileSync, chmodSync, lstatSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

// Run from the repository root. Secrets are never logged or committed.
const envPath = resolve('.env');
const email = 'kadirid9@gmail.com';
const name = 'Kadiri Daniel';
const apply = process.argv.includes('--apply');
const envText = readFileSync(envPath, 'utf8');
if (lstatSync(envPath).isSymbolicLink()) throw new Error('Refusing a symlinked .env');
function persist(key, value) {
  if (new RegExp(`^${key}=`, 'm').test(envText)) {
    if (process.env[key] !== value) throw new Error(`${key} already exists with a different value; review it locally`);
    return;
  }
  appendFileSync(envPath, `\n${key}=${JSON.stringify(value)}\n`, { mode: 0o600 });
  process.env[key] = value;
}
async function main() {
  chmodSync(envPath, 0o600);
  persist('INITIAL_SUPERADMIN_EMAIL', email);
  persist('INITIAL_SUPERADMIN_NAME', name);
  if (!apply) {
    console.log('Bootstrap identity configured. Run with --apply after migration 0003. Password is generated only for a new account.');
    return;
  }
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key || /YOUR_|PLACEHOLDER/.test(url + key)) throw new Error('Configure SUPABASE_URL and SUPABASE_SECRET_KEY in .env first');
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const schema = await client.from('department_icons').select('id').limit(1);
  if (schema.error) throw new Error('Migration 0003 is not available or the database cannot be reached. Apply migrations before bootstrap.');
  let user;
  for (let page = 1; ; page++) {
    const result = await client.auth.admin.listUsers({ page, perPage: 100 });
    if (result.error) throw new Error('Unable to inspect existing accounts; no account was changed');
    user = result.data.users.find(item => item.email?.toLowerCase() === email);
    if (user || result.data.users.length < 100) break;
  }
  let created = false;
  if (user) {
    if (!user.email_confirmed_at) throw new Error('Existing account must verify its email before becoming superadmin; password unchanged');
  } else {
    const password = process.env.INITIAL_SUPERADMIN_PASSWORD || randomBytes(36).toString('base64url');
    if (password.length < 24) throw new Error('Initial password must be at least 24 characters');
    persist('INITIAL_SUPERADMIN_PASSWORD', password);
    const result = await client.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: name } });
    if (result.error || !result.data.user) throw new Error('Account creation failed. Password remains saved for a safe retry; no password was printed.');
    user = result.data.user;
    created = true;
  }
  const grant = await client.rpc('bootstrap_platform_superadmin', { p_user_id: user.id, p_email: email, p_name: name });
  if (grant.error) throw new Error('Account exists but role assignment failed. Apply migration 0003 and retry; password will not be reset.');
  console.log(created ? 'Superadmin created. Initial password is in the ignored .env; rotate it and remove the bootstrap secret.' : 'Superadmin role assigned to the existing verified account. Existing password was preserved.');
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Bootstrap failed'); process.exitCode = 1; });
