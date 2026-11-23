// Server-side only: finds a business's real Instagram/Facebook links two ways —
// 1) scraping their own website's HTML (when they have one), and
// 2) falling back to a Tavily web search by name/city (when they don't, or the site had nothing).
// Runs server-side because most business sites don't set CORS headers that would allow a
// client-side fetch from the app's origin, and Tavily's key must never reach the browser.
// Never guesses a handle — returns null for anything it can't actually find.

const { cached } = require('./cache');

const SOCIALS_TTL_MS = 24 * 60 * 60 * 1000; // a business's Instagram/Facebook rarely changes day to day

const INSTAGRAM_SKIP = new Set(['explore', 'accounts', 'p', 'reel', 'reels', 'stories', 'direct', 'about', 'legal', 'developer']);
const FACEBOOK_SKIP = new Set(['sharer', 'share', 'plugins', 'tr', 'dialog', 'login', 'help', 'policies', 'privacy', 'l.php']);

function extractFromHtml(html, host, skip, keepQuery) {
  // Facebook's numeric-ID profiles are /profile.php?id=... — the query string is the whole
  // identity there, so it has to be captured too, not just the path segment before it. Instagram
  // has no such case — its query strings are just noise like ?hl=en, never part of the handle.
  const re = new RegExp(`https?://(?:www\\.)?${host}/([A-Za-z0-9_.\\-]+)(\\?[^\\s"'<>]*)?`, 'gi');
  let m;
  while ((m = re.exec(html))) {
    const path = m[1].replace(/\/$/, '');
    if (!path || skip.has(path.toLowerCase())) continue;
    return path + (keepQuery ? m[2] || '' : '');
  }
  return null;
}

function extractFromUrl(rawUrl, host, skip, keepQuery) {
  try {
    const u = new URL(rawUrl);
    if (u.hostname.replace(/^www\./, '').toLowerCase() !== host) return null;
    // Only check the *first* path segment against the skip-list (e.g. instagram.com/reel/XYZ
    // would otherwise slip through since 'reel/xyz' as a whole string isn't in the skip set).
    const handle = u.pathname.split('/').filter(Boolean)[0];
    if (!handle || skip.has(handle.toLowerCase())) return null;
    return handle + (keepQuery ? u.search || '' : '');
  } catch {
    return null;
  }
}

async function searchTavily(query) {
  const key = process.env.TAVILY_API_KEY;
  if (!key) return [];
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ query, max_results: 5, search_depth: 'basic', topic: 'general' }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.results || []).filter((r) => r && r.url);
  } catch {
    return [];
  }
}

const NAME_STOPWORDS = new Set(['and', 'the', 'of', 'a', 'an', '&']);
function significantTokens(name) {
  return (name || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !NAME_STOPWORDS.has(w));
}
// Requires every distinctive word from OUR business name to appear in the candidate result's
// title — plain "sounds similar" isn't enough. "9 Nails and Spa" and "9 Natural Nails & Spa" are
// two different real businesses; a loose/symmetric similarity score treats them as a near-match
// (they share 3 of 4 words) and would wrongly attach one business's Facebook page to the other.
// Asymmetric full-containment catches this: "natural" is missing from the wrong business's title.
function titleMatchesName(title, name) {
  const targetTokens = significantTokens(name);
  if (!targetTokens.length) return false;
  const titleNorm = ' ' + (title || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ') + ' ';
  return targetTokens.every((t) => titleNorm.includes(' ' + t + ' '));
}

async function searchSocialPlatform(name, city, platform, host, skip, keepQuery) {
  const query = `"${name}" ${city || ''} ${platform}`.trim();
  const results = await searchTavily(query);
  for (const r of results) {
    if (!titleMatchesName(r.title, name)) continue; // don't attach another business's page to this one
    const found = extractFromUrl(r.url, host, skip, keepQuery);
    if (found) return found;
  }
  return null;
}

async function fetchSocialsFor(args = {}) {
  const { url, name, city } = args;
  return cached('socials:' + [url || '', name || '', city || ''].join('|').toLowerCase(), SOCIALS_TTL_MS, () => resolveSocials({ url, name, city }));
}

async function resolveSocials({ url, name, city } = {}) {
  let instagram = null, facebook = null, siteFailed = false;
  let instagramSource = null, facebookSource = null;

  if (url) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LeadGridBot/1.0)' },
        redirect: 'follow',
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const html = await res.text();
        instagram = extractFromHtml(html, 'instagram.com', INSTAGRAM_SKIP, false);
        facebook = extractFromHtml(html, 'facebook.com', FACEBOOK_SKIP, true);
        if (instagram) instagramSource = 'site';
        if (facebook) facebookSource = 'site';
      } else {
        siteFailed = true;
      }
    } catch {
      siteFailed = true;
    }
  }

  // Fall back to a web search for whichever platform the site scrape didn't turn up —
  // this is the only path that can find socials at all for businesses with no website.
  // Search-matched results are a best-effort name match, not a confirmed identity like a
  // direct site-scrape is, so they're flagged 'search' rather than 'site' for the UI to caveat.
  const searchable = Boolean(process.env.TAVILY_API_KEY && name);
  if (!instagram && searchable) { instagram = await searchSocialPlatform(name, city, 'instagram', 'instagram.com', INSTAGRAM_SKIP, false); if (instagram) instagramSource = 'search'; }
  if (!facebook && searchable) { facebook = await searchSocialPlatform(name, city, 'facebook', 'facebook.com', FACEBOOK_SKIP, true); if (facebook) facebookSource = 'search'; }

  const out = {
    instagram: instagram ? '@' + instagram : null,
    facebook: facebook ? '/' + facebook : null,
    instagramSource,
    facebookSource,
  };
  if (!instagram && !facebook) {
    if (siteFailed && !searchable) out.error = 'Could not reach their site, and no search configured to look them up another way';
    else if (!url && !searchable) out.error = 'No website on file, and no search configured (set TAVILY_API_KEY) to look them up another way';
  }
  return out;
}

module.exports = { fetchSocialsFor };
