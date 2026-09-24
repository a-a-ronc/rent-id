# Deploying RentID

**Hosting:** Cloudflare Workers ($5/mo Workers Paid) · **Database/Auth/Storage:** Supabase Pro ($25/mo) · **$30/mo total.**

Every command below runs in **Git Bash** from the repo folder (`/d/RentID/repo`).
Steps 1–6 get a working site on a `*.workers.dev` URL. Step 7 puts it on
`rentid.online`. Nothing in 1–6 touches the live domain or email.

---

## 1. Push the branch

```bash
git push origin aaron/real-backend
```

Open the PR: <https://github.com/a-a-ronc/RentID/compare/main...aaron/real-backend>
(description is in `D:\RentID\PULL_REQUEST.md`). **In Lovable, disconnect GitHub
before merging** — this branch removes the Lovable build wrapper, so Lovable's
editor can no longer build it.

You don't need to merge to deploy. Deploys come from whatever is checked out.

## 2. Create the Supabase project

1. supabase.com → **New project**. Name `rentid`, region **West US (Oregon)**.
   Save the database password in your password manager.
2. **Upgrade the org to Pro.** Free projects pause after 7 days without traffic.
3. **Project Settings → API Keys.** Copy the project URL, the **publishable** key
   and the **secret** key.

## 3. Apply the schema (18 migrations)

```bash
bunx supabase login
bunx supabase link --project-ref <your-project-ref>     # asks for the DB password
bunx supabase db push                                    # lists 18 migrations; answer Y
```

If `bunx supabase` fails to start, use `npx supabase` for the same three commands.

Expect 43 tables, 128+ policies, and a private `documents` bucket. Every
migration has been applied to a clean Postgres 16 and passes all 10 RLS suites.

## 4. Supabase auth settings (dashboard)

**Authentication → URL Configuration**

- Site URL: `https://rentid.online`
- Redirect URLs — add all of:
  `https://rentid.online/**` · `https://www.rentid.online/**` ·
  `https://rentid.*.workers.dev/**` · `http://localhost:5173/**`

**Authentication → Sign In / Providers → Email → turn OFF "Confirm email"** for
now. Supabase's built-in mailer only delivers to members of your Supabase
organization and is heavily rate-limited, so a landlord signing up would never
get the confirmation email. Turn it back on once custom SMTP is set up
(Authentication → Emails → SMTP — Microsoft 365 or Resend).

## 5. Build config + deploy

Create `.env` in the repo folder (it is git-ignored):

```bash
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
VITE_SUPABASE_PROJECT_ID=<ref>
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_PROJECT_ID=<ref>
```

Only public values go in `.env` — they are compiled into the browser bundle and
copied into the Worker's `vars`. **The secret key never goes in this file.**

```bash
bun install
bunx wrangler login          # browser opens; approve
bun run deploy               # builds, then deploys Worker "rentid"
```

The output ends with `https://rentid.<your-subdomain>.workers.dev`. On the first
deploy wrangler may ask you to pick that subdomain.

Upgrade to **Workers Paid ($5/mo)**: dashboard → Workers & Pages → Plans. The
free plan's 10 ms CPU limit is too tight for server-rendered React.

Then the secrets (each prompts for the value; they persist across deploys):

```bash
bunx wrangler secret put SUPABASE_SERVICE_ROLE_KEY --name rentid   # the Supabase *secret* key
bunx wrangler secret put RENTID_ADMIN_ACCESS_CODE  --name rentid   # any long passphrase
openssl rand -base64 32                                            # copy the output, then:
bunx wrangler secret put RENTID_ENCRYPTION_KEYS    --name rentid   # 2026-09:<that output>
```

`SUPABASE_SERVICE_ROLE_KEY` is what makes `/join` (the waitlist form) work.

## 6. Smoke test on the workers.dev URL

- Home, For landlords, For tenants, For property managers, `/rent` all load.
- `/join` → submit → "You're on the list."
- Sign up as a landlord → add a property and unit → invite a tenant → copy the link.
- Open the invite link in a private window → sign up with the invited email → accept.
- Upload a document from the landlord side and open it.

Make yourself (and Gavin) admin — Supabase **SQL Editor**:

```sql
insert into public.user_roles (user_id, role)
select id, 'admin' from auth.users where email in ('you@example.com')
on conflict do nothing;
```

## 7. Move rentid.online to Cloudflare

**Microsoft 365 email is what breaks if this is done carelessly.** Do it in order.

1. **GoDaddy → DNS → Export zone file.** Keep it.
2. **Cloudflare → Add a domain → `rentid.online` → Free plan.** Compare the
   imported records line by line against the export. Required for M365:
   - `MX @` → `…mail.protection.outlook.com`
   - `TXT @` → `v=spf1 include:spf.protection.outlook.com -all` (exactly one SPF)
   - `TXT @` → `MS=ms…` (domain verification)
   - `CNAME autodiscover` → `autodiscover.outlook.com`
   - `CNAME selector1._domainkey` / `selector2._domainkey` (DKIM)
   - `TXT _dmarc` (if present)

   Get the tenant-specific values from **M365 admin → Settings → Domains →
   rentid.online → DNS records**. Mail records must be **DNS only (grey cloud)**.

3. **Delete** the imported `A`/`CNAME` records for `@` and `www` (they point at
   the old Lovable site). The Worker creates its own.
4. **GoDaddy → Nameservers → Change** to the two Cloudflare gives you.
5. Wait for Cloudflare to show the zone **Active** (minutes to a few hours).
6. Attach the domain:
   ```bash
   bun run deploy:live
   ```
   Or from any browser: Workers & Pages → rentid → Settings → Domains & Routes →
   Add → Custom domain → `rentid.online` (and `www.rentid.online`). If you add it
   in the dashboard, use `bun run deploy:live` for later deploys so the config
   agrees.
7. **Send and receive a test email** on your rentid.online address before
   calling it done.

---

## Before cancelling Lovable

- **Export the waitlist.** The `interest_registrations` rows (everyone who filled
  in `/join`) live in the old Lovable database, not the new one. Export them as
  CSV from Lovable Cloud's database view, then import with Supabase Table Editor
  → `interest_registrations` → Insert → Import data from CSV.
- Keep the Lovable subscription one more month until the new site is verified.
- Never click **Remove Cloud** before the export is downloaded and opened.

## Later deploys

```bash
git pull && bun install && bun run deploy:live
bunx supabase db push        # only when a PR adds a migration
```

## Deploying without this PC (optional)

Workers & Pages → rentid → Settings → **Builds → Connect** the GitHub repo.
Build command `bun run build`, deploy command `npx wrangler deploy`, and add the
six `.env` values plus `DEPLOY_CUSTOM_DOMAIN=1` as **build variables**. After
that every push to `main` deploys itself — no home computer needed.
