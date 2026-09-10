# LeadGrid — local setup

A client-finding pipeline: **Find** local businesses with a gap you can pitch (no website, low
rating, few reviews, odd status) via Google Places → **Enrich** and score them → **Engage** with
AI-drafted outreach → **Track** them through the pipeline to won/lost.

Markup lives in `index.html`, styles in `styles.css`, app logic in ES modules under `src/`
(entry: `src/main.js`), bundled by Vite. Data persists to Supabase (Postgres + Auth). The paid
Google/Tavily calls are proxied through `api/` so no third-party key ever reaches the browser.

```bash
npm install
npm run dev     # open the printed http://localhost:5173
npm run build   # static bundle in dist/
npm run lint
```

## Credentials — copy `.env.example` to `.env.local` and fill in

### Supabase
Project Settings → API for `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` (anon key is public by
design — every table is RLS-gated to "authenticated only"). Apply the schema with
`supabase link --project-ref <ref>` then `supabase db push` (or paste `supabase/schema.sql` into
the SQL editor). For local dev, create one confirmed Auth user and set `VITE_DEV_EMAIL` /
`VITE_DEV_PASSWORD` so the app signs in silently and skips the login screen.

### Google (server-side only — one key)
In [console.cloud.google.com](https://console.cloud.google.com): create a project, **enable
billing**, and enable **Places API (New)** + **Geocoding API**. Create an API key with **no**
application/referrer restriction (server-to-server calls can't send one), API-restricted to those
two. Put it in `GOOGLE_PLACES_API_KEY`. There is no client-side map, so no Maps JavaScript API
key or Map ID is required.

### Tavily
`TAVILY_API_KEY` from [tavily.com](https://tavily.com) — social-link enrichment only.

## Deploy
`npx vercel` (the `api/` handlers are Vercel serverless functions; `vite.config.js` mirrors them
for `npm run dev`). Set the same env vars in the Vercel project.

## Files
- `index.html` — markup + login / drawer / modal shells
- `styles.css` — all styling
- `src/` — `main.js` (entry), `state.js` (shared state), then one module per feature: `crm.js`,
  `finder.js`, `calendar.js`, `reps.js`, `drawer.js`, `outreach.js`, `assistant.js`,
  `dashboard.js`, plus `router.js`, `data.js` (Supabase layer), `sb.js`, `helpers.js`, `icons.js`
- `api/` — auth-gated proxies: `places-search.js`, `geocode.js`, `socials.js` (+ `lib/`)
- `supabase/` — `schema.sql` and incremental `migrations/`
