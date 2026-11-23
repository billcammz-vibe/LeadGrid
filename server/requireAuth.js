// Server-side only: gates the Places/socials/geocode proxies behind a logged-in LeadGrid user,
// so the owner's paid API keys can't be spent by anyone who just has the URL. Validates the
// bearer token against Supabase Auth using the anon key — no service-role key needed, since
// auth.getUser(jwt) checks the token itself, not the key used to create the client.
const { createClient } = require('@supabase/supabase-js');

async function requireAuth(req) {
  const header = req.headers.authorization || req.headers.Authorization || '';
  const token = header.replace(/^Bearer\s+/i, '').trim();
  if (!token) throw Object.assign(new Error('Not authenticated'), { status: 401 });

  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw Object.assign(new Error('Supabase not configured on the server'), { status: 500 });

  const supabase = createClient(url, key);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data || !data.user) throw Object.assign(new Error('Not authenticated'), { status: 401 });
  return data.user;
}

module.exports = { requireAuth };
