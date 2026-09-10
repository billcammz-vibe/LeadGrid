import { defineConfig, loadEnv } from 'vite';
import { fetchSocialsFor } from './api/lib/extractSocials.js';
import { searchPlacesText } from './api/lib/placesSearch.js';
import { geocodeAddress } from './api/lib/geocode.js';
import { requireAuth } from './api/lib/requireAuth.js';
import { rateLimit } from './api/lib/cache.js';

function readJsonBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(raw || '{}')); } catch { resolve({}); }
    });
  });
}

// Mirrors api/socials.js and api/places-search.js (the Vercel serverless functions used in
// production) so `npm run dev` has working /api/* endpoints too, without needing `vercel dev`.
function backendApiPlugin() {
  return {
    name: 'leadgrid-backend-api',
    configureServer(server) {
      server.middlewares.use('/api/socials', async (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        let user;
        try {
          user = await requireAuth(req);
        } catch (err) {
          res.statusCode = err.status || 401;
          res.end(JSON.stringify({ error: err.message }));
          return;
        }
        const params = new URL(req.url, 'http://localhost').searchParams;
        const url = params.get('url') || '';
        const name = params.get('name') || '';
        const city = params.get('city') || '';
        try {
          rateLimit(user.id);
          const result = await fetchSocialsFor({ url, name, city });
          res.end(JSON.stringify(result));
        } catch (err) {
          res.statusCode = err.status || 500;
          res.end(JSON.stringify({ error: err.message }));
        }
      });

      server.middlewares.use('/api/places-search', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: 'POST only' }));
          return;
        }
        res.setHeader('Content-Type', 'application/json');
        let user;
        try {
          user = await requireAuth(req);
        } catch (err) {
          res.statusCode = err.status || 401;
          res.end(JSON.stringify({ error: err.message }));
          return;
        }
        const body = await readJsonBody(req);
        try {
          rateLimit(user.id);
          const places = await searchPlacesText(body);
          res.end(JSON.stringify({ places }));
        } catch (err) {
          res.statusCode = err.status || 500;
          res.end(JSON.stringify({ error: err.message }));
        }
      });

      server.middlewares.use('/api/geocode', async (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        let user;
        try {
          user = await requireAuth(req);
        } catch (err) {
          res.statusCode = err.status || 401;
          res.end(JSON.stringify({ error: err.message }));
          return;
        }
        const params = new URL(req.url, 'http://localhost').searchParams;
        try {
          rateLimit(user.id);
          const result = await geocodeAddress(params.get('address') || '');
          res.end(JSON.stringify(result));
        } catch (err) {
          res.statusCode = err.status || 500;
          res.end(JSON.stringify({ error: err.message }));
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // Node's own process.env isn't populated from .env.local by Vite automatically for anything
  // our server-side middleware reads — VITE_-prefixed vars only auto-reach import.meta.env in the
  // client bundle, and non-prefixed ones (deliberately server-only, must never reach the browser)
  // aren't auto-exposed anywhere. Both need an explicit loadEnv() copy into process.env here.
  const env = loadEnv(mode, process.cwd(), '');
  if (env.TAVILY_API_KEY) process.env.TAVILY_API_KEY = env.TAVILY_API_KEY;
  if (env.GOOGLE_PLACES_API_KEY) process.env.GOOGLE_PLACES_API_KEY = env.GOOGLE_PLACES_API_KEY;
  if (env.VITE_GOOGLE_API_KEY) process.env.VITE_GOOGLE_API_KEY = env.VITE_GOOGLE_API_KEY;
  if (env.VITE_SUPABASE_URL) process.env.VITE_SUPABASE_URL = env.VITE_SUPABASE_URL;
  if (env.VITE_SUPABASE_ANON_KEY) process.env.VITE_SUPABASE_ANON_KEY = env.VITE_SUPABASE_ANON_KEY;

  return {
    plugins: [backendApiPlugin()],
  };
});
