# Crest

Crest is a zero-based budgeting web app in the style of YNAB. You give every dollar a job: income lands in **Ready to Assign**, and you assign it to categories until nothing is left over.

- Budget by category or by category group, with targets, recurring bills and sinking funds
- Accounts, transactions and splits, credit cards, transfers, and tracking accounts
- Optional bank sync through [Plaid](https://plaid.com), with imported transactions waiting for your approval
- Auto-categorization rules and suggestions from your payee history
- Shared budgets: invite a partner or family member to the same plan with a link
- Installable on your phone, with push notifications for new transactions

Built with Next.js 15, Supabase (Postgres + auth), TypeScript and shadcn/ui. The design reference is [`docs/budgeting-app-architecture.md`](docs/budgeting-app-architecture.md).

## Running your own copy

Crest isn't a hosted service. Each person or household runs **their own copy** with their own database and their own bank connections, so nobody else can see your finances. Everything below has a free tier that's enough for personal use:

| Service | What it does | Cost |
| --- | --- | --- |
| [GitHub](https://github.com) | Holds your copy of the code | Free |
| [Supabase](https://supabase.com) | Database and logins | Free plan |
| [Vercel](https://vercel.com) | Hosts the website | Free Hobby plan (personal, non-commercial use) |
| [Plaid](https://plaid.com) | Connects to your bank (optional) | Free Trial plan, up to 10 bank connections |

Allow about 45 minutes. You never need to write code, but you'll copy a handful of keys between websites. Keep a notes file open and paste each value into it as you go. **Treat the keys marked 🔒 like passwords. Never post them or commit them to GitHub.**

> **Skipping the bank connection?** Leave out Part 4 and the Plaid keys. You can still enter transactions by hand or import them from a CSV. You'll still need the push-notification keys in Part 5.

### Part 1: Create a GitHub account and fork the repo

1. Go to [github.com/signup](https://github.com/signup) and create a free account. Skip this if you have one.
2. Open this repository's page on GitHub and click **Fork** (top right), then **Create fork**. You now have your own copy under your account.
3. Enable the automated workflows on your fork. GitHub turns them off on forks by default. Open the **Actions** tab and click **I understand my workflows, go ahead and enable them**.

### Part 2: Create the database (Supabase)

1. Sign up at [supabase.com](https://supabase.com) (**Sign in with GitHub** is easiest). **Use the same email address you'll use to log in to Crest.** Supabase's built-in email sender only delivers to people on your Supabase team, so this is what lets sign-up and password-reset emails reach you.
2. Click **New project**. Pick a name (for example `crest`) and a region near you.
3. Set a **database password** and save it in your notes. 🔒 Use the **Generate a password** button if you like. You'll need it in Part 3.
4. Click **Create new project** and wait a couple of minutes while it starts.
5. Collect these values. In the project, click the **Connect** button at the top, or open **Project Settings**:
   - **Project URL** looks like `https://abcdefghijkl.supabase.co`. The part before `.supabase.co` is your **project ref**.
   - **Publishable key** is under **Project Settings → API Keys**. It starts with `sb_publishable_`. If none exists yet, click **Create new API Keys**. This key is safe to expose.
   - **Secret key** is in the same place, in the **Secret keys** section. It starts with `sb_secret_`. 🔒 It bypasses all security rules, so only ever put it in Vercel.

   If your Supabase dashboard only shows the older **Legacy API Keys** tab, use the `anon` key as the publishable key and the `service_role` key as the secret key.
6. Create an **access token**. Click your avatar (bottom left), then **Account preferences → Access Tokens → Generate new token** (or visit [supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens)). Name it `crest`, then copy it. 🔒 It's shown only once.

### Part 3: Create the database tables (GitHub Actions)

Crest ships with a workflow that builds the whole database for you. It needs three secrets from Part 2.

1. In your fork on GitHub, go to **Settings → Secrets and variables → Actions → New repository secret**. Add these three, one at a time:

   | Name | Value |
   | --- | --- |
   | `SUPABASE_ACCESS_TOKEN` | The access token from step 6 |
   | `PRODUCTION_DB_PASSWORD` | The database password from step 3 |
   | `PRODUCTION_PROJECT_ID` | Your project ref (the part before `.supabase.co`) |

2. Open the **Actions** tab, click **Deploy Migrations to Production** in the left list, then **Run workflow → Run workflow**.
3. Wait for the run to finish with a green check. In Supabase, **Table Editor** should now list tables such as `accounts` and `transactions`. If the run is red, open it and read the error. A wrong password or project ref is the usual cause.

This workflow runs again automatically whenever you pull in new database changes (see [Getting updates](#getting-updates)).

### Part 4: Get Plaid keys (optional, for bank sync)

1. Sign up at [dashboard.plaid.com/signup](https://dashboard.plaid.com/signup).
2. Your keys are at [dashboard.plaid.com/developers/keys](https://dashboard.plaid.com/developers/keys) (**Developers → Keys**). You'll see a **client_id**, which is the same for every environment, and a separate **secret** for each environment (Sandbox and Production).
3. **Try it first in Sandbox.** The Sandbox secret works immediately and connects to fake banks only. In Link, pick any bank and log in with username `user_good` and password `pass_good`. This is a good way to confirm everything works before connecting a real bank.
4. **To connect real banks**, request production access from the Plaid dashboard (the **Get production access** link). New Plaid teams are put on the **Trial plan**, which is free and allows up to **10 real bank connections** (Items). Plaid counts each connected bank login as one Item. Disconnecting one doesn't give the slot back, so connect each bank once. Once production access is approved, the Production secret appears on the same Keys page.

Write down the `client_id`, the secret 🔒, and which environment it belongs to. Use `sandbox` or `production` as `PLAID_ENV`. Plaid's old `development` environment has been retired. The Plaid steps and limits change over time, so check [Plaid's docs](https://plaid.com/docs/) if anything here looks different.

### Part 5: Generate push-notification keys

Crest sends a notification when new bank transactions arrive. This needs a pair of keys that you generate yourself. They aren't tied to any account, but the app expects them to be set.

You need a terminal with Node.js for this. If you don't have one, GitHub provides one for free: on your fork, click **Code → Codespaces → Create codespace on main**, then run this in the terminal at the bottom:

```bash
npx web-push generate-vapid-keys
```

You'll get a **Public Key** and a **Private Key** 🔒. Save both. You can delete the codespace afterwards.

### Part 6: Deploy the website (Vercel)

1. Sign up at [vercel.com/signup](https://vercel.com/signup) with **Continue with GitHub** and choose the free **Hobby** plan.
2. Click **Add New… → Project**, find your `crest` fork under **Import Git Repository**, and click **Import**.
3. Open **Environment Variables** and add the following. Names must match exactly.

   | Name | Value |
   | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL` | Project URL from Part 2 |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable key from Part 2 |
   | `SUPABASE_SERVICE_ROLE_KEY` | Secret key from Part 2 (`sb_secret_…`) 🔒 |
   | `VAPID_PUBLIC_KEY` | Public key from Part 5 |
   | `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | The same public key again |
   | `VAPID_PRIVATE_KEY` | Private key from Part 5 🔒 |
   | `VAPID_SUBJECT` | `mailto:` followed by your email, e.g. `mailto:you@example.com` |
   | `PLAID_CLIENT_ID` | From Part 4 (skip all `PLAID_` rows if you're not using Plaid) |
   | `PLAID_SECRET` | From Part 4 🔒 |
   | `PLAID_ENV` | `sandbox` or `production` |

4. Click **Deploy** and wait for the confetti. Vercel shows your site address, such as `https://crest-yourname.vercel.app`. This is your **app URL**.
5. Add two more variables using that URL. In the project, go to **Settings → Environment Variables**:

   | Name | Value |
   | --- | --- |
   | `NEXT_PUBLIC_APP_URL` | Your app URL, e.g. `https://crest-yourname.vercel.app` (no trailing slash) |
   | `PLAID_WEBHOOK_URL` | Your app URL plus `/api/plaid/webhook` (skip if not using Plaid) |

6. Redeploy so the new values take effect. Go to **Deployments**, open the **⋯** menu on the latest one, and click **Redeploy**. Any time you change a variable, redeploy.

### Part 7: Tell Supabase your website address

Supabase only sends people back to addresses you've approved.

1. In Supabase, go to **Authentication → URL Configuration**.
2. Set **Site URL** to your app URL.
3. Under **Redirect URLs**, click **Add URL** and enter your app URL followed by `/**`, e.g. `https://crest-yourname.vercel.app/**`. Then save.

### Part 8: Create your account

Open your app URL, click **Sign up**, and use the **same email as your Supabase account**. Click the link in the confirmation email, log in, and you're in. From **Accounts** you can add accounts by hand or connect a bank.

On a phone, open the site in your browser and choose **Add to Home Screen** to install it like an app.

**Optional: stop strangers from signing up.** Your site is public, and anyone who finds the address could create an account. Once you and your household have signed up, go to Supabase **Authentication → Sign In / Providers** and turn off **Allow new users to sign up**. Switch it back on temporarily if you need someone new to create an account.

## Good to know

- **Free Supabase projects pause after a week of inactivity.** Your data is kept. Open the project in the Supabase dashboard and click **Restore project**. Using the app regularly avoids this.
- **Backups aren't included on the free plan.** Export your data now and then.
- **Real-bank limits.** Plaid's Trial plan allows 10 real connections, and some banks need extra Plaid approval or "OAuth" setup before they can connect. This copy of Crest hasn't been tested against every bank. If a specific bank won't connect, it's usually this. Smaller banks and credit unions tend to be easier.
- **Sharing one copy.** If your household shares a budget, you don't each need a copy. One person can run it and invite others from the **Members** page. Everyone shares the owner's 10 Plaid connections, though.

## Getting updates

When the original project gets improvements, open your fork on GitHub and click **Sync fork → Update branch**. Vercel redeploys automatically, and any new database changes are applied by the **Deploy Migrations to Production** workflow. Check the **Actions** tab to confirm it succeeded.

## Developing locally

You only need this if you want to change the code. Requires Node 22, [pnpm](https://pnpm.io), and the [Supabase CLI](https://supabase.com/docs/guides/cli) with Docker for a local database.

```bash
pnpm install
cp .env.example .env.local   # fill in the values described above
pnpm dev                     # http://localhost:3000
pnpm test                    # unit tests
pnpm lint
supabase test db             # database (pgTAP) tests
```

See [`CLAUDE.md`](CLAUDE.md) and [`docs/`](docs/) for architecture notes and conventions.
