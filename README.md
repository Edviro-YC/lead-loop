# LeadLoop

Open-source, self-hosted, human-in-the-loop email outreach copilot for Gmail.

LeadLoop helps you write better outreach emails and follow up consistently — without ever sending anything automatically. You stay in control. LeadLoop suggests, you decide.

## What it does

- **Insert templates** into compose windows with variable substitution (name, company, etc.)
- **Enhance drafts** with AI-powered rewrites
- **Suggest replies** based on thread context and your past successful outreach
- **Track threads** and schedule follow-up reminders
- **Manage leads, templates, and workflows** from a dashboard

Everything happens inside Gmail. LeadLoop never sends emails on your behalf.

## Architecture

```
Gmail Add-on (Apps Script)  ←→  Cloudflare Worker (API)  ←→  Supabase (DB + Auth)
                                        ↓
                                   OpenAI (AI)
                                        ↓
Dashboard (Next.js on Cloudflare Workers)  ←→  Cloudflare Worker
                                        ↑
AI agents (MCP clients: Cursor, Claude, …)  ←→  /mcp endpoint
```

| Component | Tech | Purpose |
|-----------|------|---------|
| `apps/gmail-addon/` | Google Apps Script | Thin Gmail sidebar UI |
| `leadloop-worker/` | Cloudflare Workers + Hono | API, business logic, queue consumers, cron jobs |
| `apps/leadloop-dashboard/` | Next.js 16, React 19, Tailwind (on Cloudflare Workers via OpenNext) | Management dashboard |
| `supabase/migrations/` | PostgreSQL + pgvector | Database schema, RLS policies, vector search |

## Prerequisites

You'll need accounts (all have free tiers sufficient for personal use):

- [Supabase](https://supabase.com) — database and auth
- [Cloudflare](https://cloudflare.com) — API Worker + dashboard hosting, queues, cron
- [OpenAI](https://platform.openai.com) — AI generation and embeddings
- [Google Cloud Console](https://console.cloud.google.com) — OAuth client for Gmail
- [Node.js](https://nodejs.org) 18+ (npm workspaces are used, no other package manager needed)

## Setup

### 1. Clone and install

```bash
git clone https://github.com/YOUR_USERNAME/leadloop.git
cd leadloop
npm install
```

### 2. Supabase

Create a new Supabase project, then:

```bash
npm install -g supabase
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

This runs the migrations in `supabase/migrations/` which create all tables, RLS policies, and the vector search function.

In the Supabase dashboard:

1. Go to **Authentication > Providers > Google** and enable it.
2. Enter your Google OAuth client ID and secret (see step 4 below).
3. Copy the callback URL Supabase gives you — you'll need it for Google Cloud Console.
4. Go to **Authentication > URL Configuration**:
   - Set **Site URL** to your dashboard URL (e.g. `https://leadloop-dashboard.YOUR_SUBDOMAIN.workers.dev`)
   - Add `https://leadloop-dashboard.YOUR_SUBDOMAIN.workers.dev/auth/callback` to **Redirect URLs**
   - For local dev, also add `http://localhost:3000/auth/callback`

Note down your **Project URL**, **anon key**, and **service role key** from **Settings > API**.

### 3. Cloudflare Worker

```bash
cd leadloop-worker
```

Edit `wrangler.jsonc` and fill in your Supabase URL, anon key, and dashboard URL in the `vars` section.

Set up secrets:

```bash
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
wrangler secret put OPENAI_API_KEY
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET
wrangler secret put ADDON_API_KEY
wrangler secret put MCP_API_KEY
```

For `ADDON_API_KEY`, generate any random string (e.g. `openssl rand -hex 32`). This is a shared secret between the Gmail add-on and the Worker. `MCP_API_KEY` works the same way but for AI agents connecting to the [MCP server](#mcp-server-ai-agents) — use a different random string.

For local development, copy the example env file:

```bash
cp .dev.vars.example .dev.vars
# Fill in your values
npm run dev
```

Deploy:

```bash
npm run deploy
```

Note the Worker URL (e.g. `https://leadloop-worker.YOUR_SUBDOMAIN.workers.dev`).

### 4. Google OAuth client

1. Go to [Google Cloud Console](https://console.cloud.google.com) and create a new project (or use an existing one).
2. Go to **APIs & Services > OAuth consent screen**. Configure it for **External** users (or Internal if you have a Workspace org). Add the Gmail API scopes:
   - `https://www.googleapis.com/auth/gmail.readonly`
   - `https://www.googleapis.com/auth/gmail.compose`
   - `https://www.googleapis.com/auth/gmail.modify`
3. Go to **APIs & Services > Credentials** and create an **OAuth 2.0 Client ID** (Web application).
4. Under **Authorized redirect URIs**, add the Supabase callback URL from step 2.
5. Under **Authorized JavaScript origins**, add your dashboard URL (e.g. `https://leadloop-dashboard.YOUR_SUBDOMAIN.workers.dev`).
6. Copy the **Client ID** and **Client Secret** — these go into both Supabase (step 2) and the Worker secrets (step 3).

If your OAuth app is in **Testing** mode, add your email as a test user.

### 5. Dashboard

```bash
cd apps/leadloop-dashboard
cp .env.local.example .env.local
# Fill in your Supabase URL, anon key, and Worker URL
```

The dashboard runs on Cloudflare Workers via the [OpenNext adapter](https://opennext.js.org/cloudflare). The `NEXT_PUBLIC_*` variables are inlined at build time from `.env.local`, so make sure they're filled in before deploying.

Deploy:

```bash
npm run deploy
```

Note the dashboard URL (e.g. `https://leadloop-dashboard.YOUR_SUBDOMAIN.workers.dev`). Set it as the `DASHBOARD_URL` variable on the API Worker (Cloudflare dashboard > leadloop-worker > Settings > Variables) so CORS allows the dashboard origin, and use it in the Supabase and Google OAuth settings from steps 2 and 4.

For local development:

```bash
npm run dev:dashboard   # Next.js dev server
npm run preview:dashboard   # build + preview in the Workers runtime
```

### 6. Gmail Add-on

Install the Google Apps Script CLI:

```bash
npm install -g @google/clasp
clasp login
```

Create and push the add-on:

```bash
cd apps/gmail-addon
clasp create --type standalone --title "LeadLoop"
clasp push
```

Configure the add-on:

1. Open the script in the Apps Script editor: `clasp open`
2. Go to **Project Settings > Script Properties** and add:
   - `WORKER_URL` = your deployed Worker URL (e.g. `https://leadloop-worker.YOUR_SUBDOMAIN.workers.dev`)
3. To install as a Gmail add-on for testing:
   - In the Apps Script editor, click **Deploy > Test deployments**
   - Click **Install** next to the Gmail add-on entry
4. Open Gmail — the LeadLoop sidebar should appear when you open a message.
5. Click **Settings** in the add-on and paste the same `ADDON_API_KEY` value you set in the Worker.

## Usage

### Dashboard

- **Templates** — Create reusable email templates with `{{name}}`, `{{company}}`, etc. placeholders.
- **Leads** — Add contacts manually or import them. Leads are auto-matched when you compose to their email.
- **Threads** — View all threads you've added to LeadLoop and their sync status.
- **Follow-ups** — See scheduled follow-up reminders and manage rules.
- **Examples** — Curate successful outreach examples for AI-powered reply suggestions. Group them into **sequences** (ordered multi-touch arcs: cold email → bump → breakup); assign a thread to a sequence and follow-up drafts are personalized around the current step's example. "Save as Sequence" on a thread captures every sent message as ordered steps.
- **Settings** — Copy your add-on API key.

### Gmail Add-on

When reading an email:
- **Add to LeadLoop** — Start tracking this thread. Syncs messages for context.
- **Set Follow-up** — Schedule a follow-up reminder (in days).
- **Suggest Reply** — Get an AI-suggested reply based on thread context and your outreach examples.

When composing:
- **Templates** — Pick a template to insert. Placeholders are auto-filled from lead data.
- **Enhance Draft** — Paste a draft and get an AI-improved version.

### MCP server (AI agents)

**Live now:** `https://leadloop-worker.tanujsiripurapu.workers.dev/mcp` — deployed, tested, waiting on one secret. Agents (Cursor, Claude, etc.) can read and write your templates, outreach examples, and watched threads. Data stays in Supabase.

Connect an agent (~3 minutes):

1. Set the secret (once): `cd leadloop-worker && npx wrangler secret put MCP_API_KEY` — paste any random string (`openssl rand -hex 32` makes one)
2. Paste into `.cursor/mcp.json`, swapping in your key and your Gmail:

```json
{
  "mcpServers": {
    "leadloop": {
      "url": "https://leadloop-worker.tanujsiripurapu.workers.dev/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_MCP_API_KEY",
        "X-User-Email": "you@example.com"
      }
    }
  }
}
```

3. Ask the agent to run `list_templates`. Success = a JSON list. 401 or 403 = wrong key; "User not found" = `X-User-Email` doesn't match the `gmail_email` on your profile.

Claude Code instead of Cursor:

```bash
claude mcp add --transport http leadloop \
  https://leadloop-worker.tanujsiripurapu.workers.dev/mcp \
  --header "Authorization: Bearer YOUR_MCP_API_KEY" \
  --header "X-User-Email: you@example.com"
```

The 24 tools:

- **Templates** — `list_templates`, `get_template`, `create_template`, `update_template`, `delete_template`. `{{variable}}` placeholders auto-detected on create/update.
- **Examples** — `list_examples`, `search_examples` (semantic, pgvector), `create_example`, `update_example`, `delete_example`. Writes auto-embed; searchable within seconds. Examples can be placed in a sequence via `sequence_id` + `step_number`.
- **Sequences** — `list_sequences`, `get_sequence`, `create_sequence`, `update_sequence`, `delete_sequence` (steps revert to standalone examples), `set_sequence_steps` (set/reorder steps from an ordered list of example ids).
- **Watched threads** — `list_watched_threads`, `get_thread_messages`, `watch_thread` (upserts + syncs from Gmail), `update_watched_thread` (status, lead link, sequence assignment + step), `sync_thread`.
- **Follow-ups** — `schedule_follow_up` (start the rule + first pending follow-up on a thread), `preview_follow_up_draft` (dry run: exact OpenAI prompt + generated body, no side effects), `trigger_follow_up` (run the pending scheduled follow-up now instead of waiting).

Local test (needs `MCP_API_KEY` in `.dev.vars`): run `npm run dev` in `leadloop-worker/`, then:

```bash
npx @modelcontextprotocol/inspector --cli http://localhost:8787/mcp \
  --transport http --method tools/list \
  --header "Authorization: Bearer YOUR_MCP_API_KEY" \
  --header "X-User-Email: you@example.com"
```

## Project structure

```
leadloop/
├── apps/
│   ├── gmail-addon/          # Google Apps Script add-on
│   │   └── src/
│   │       ├── main.gs       # Entry points and action handlers
│   │       ├── ui.gs         # Card UI builders
│   │       └── api.gs        # Worker API client
│   └── leadloop-dashboard/   # Next.js dashboard
│       └── app/
│           ├── (dashboard)/  # Authenticated pages
│           └── login/        # Auth flow
├── leadloop-worker/          # Cloudflare Worker API
│   └── src/
│       ├── routes/           # API endpoints
│       ├── mcp/              # MCP server + agent tools
│       ├── jobs/             # Queue consumers
│       ├── services/         # Gmail, OpenAI, retrieval
│       ├── middleware/       # Auth, CORS
│       └── lib/              # Types, Supabase client
├── supabase/
│   └── migrations/           # Database schema
└── packages/                 # Shared code (future)
```

## Development

From the repo root:

```bash
# Start the Worker locally
npm run dev:worker

# Start the dashboard locally
npm run dev:dashboard

# Deploy the Worker
npm run deploy:worker

# Deploy the dashboard
npm run deploy:dashboard

# Push add-on changes
cd apps/gmail-addon && clasp push
```

## How it works

1. **Auth**: Users sign in with Google via Supabase Auth. The OAuth flow captures a Gmail refresh token, enabling the Worker to fetch emails on their behalf.
2. **Gmail Add-on**: A thin Apps Script client that renders Cards in the Gmail sidebar. All business logic lives in the Worker — the add-on just makes API calls.
3. **Thread tracking**: When you "Add to LeadLoop", the Worker queues a sync job that fetches the full thread from Gmail and stores messages in Supabase.
4. **Follow-ups**: A cron job checks every minute for due follow-ups and queues draft creation. The Worker creates a Gmail draft (never sends) so you can review and send manually.
5. **AI suggestions**: Reply suggestions use thread context + similar outreach examples (pgvector cosine similarity) to generate contextual responses via OpenAI. Threads assigned to a sequence get follow-up drafts modeled on the sequence's current step example (personalized, never copied); the step advances each time a draft is created, and an exhausted sequence dismisses the follow-up instead of silently drafting generic content.
6. **Security**: All tables use Row Level Security. The add-on authenticates via a shared API key + user email header. The dashboard uses Supabase JWT auth. The MCP endpoint uses its own bearer API key + user email header, and every tool query is scoped to that user.

## License

[MIT](LICENSE)
