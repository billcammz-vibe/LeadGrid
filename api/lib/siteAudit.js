// Server-side only: audits a business's website — mobile-friendliness, load speed, and HTTPS via
// Google's PageSpeed Insights API (which runs Lighthouse), plus a lightweight fetch-and-scan of
// the page for an online-booking link. Runs server-side because PSI calls take several seconds
// and the key (when set) must never reach the browser; the booking scan mirrors extractSocials.js.
const { cached } = require('./cache');

const AUDIT_TTL_MS = 24 * 60 * 60 * 1000; // a site's speed/mobile/https posture doesn't change hour to hour
const LIGHTHOUSE_POOR_SCORE = 50; // Lighthouse's own red/"poor" cutoff (0-100 scale)

const BOOKING_PATTERNS = new RegExp(
  '(book(?:ing)?[\\s-]*(?:an?[\\s-]*)?(?:appointment|now|online|table|visit)' +
  '|schedule[\\s-]*(?:an?[\\s-]*)?(?:appointment|visit|now|consult)' +
  '|online[\\s-]*booking' +
  '|calendly\\.com|acuityscheduling\\.com|squareup\\.com/appointments|zocdoc\\.com' +
  '|schedulicity\\.com|setmore\\.com|booksy\\.com|vagaro\\.com|mindbodyonline\\.com|appointy\\.com)',
  'i'
);

// null = couldn't tell (fetch failed) — never reported as "missing", since that would be a false
// positive gap, not a real absence.
async function fetchBookingSignal(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LeadGridBot/1.0)' },
      redirect: 'follow',
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    return BOOKING_PATTERNS.test(html);
  } catch {
    return null;
  }
}

async function runPageSpeed(url, key) {
  const params = new URLSearchParams({ url, strategy: 'mobile' });
  ['performance', 'seo', 'best-practices'].forEach((c) => params.append('category', c));
  if (key) params.set('key', key);
  const res = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${params}`, {
    signal: AbortSignal.timeout(28000), // Lighthouse runs take a while — this is the slow call
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw Object.assign(new Error((data.error && data.error.message) || `PageSpeed API ${res.status}`), { status: res.status });
  }
  const lh = data.lighthouseResult;
  if (!lh) throw Object.assign(new Error('PageSpeed returned no result — the site may block automated checks'), { status: 502 });
  const audits = lh.audits || {};
  const perf = lh.categories && lh.categories.performance ? Math.round(lh.categories.performance.score * 100) : null;
  // 'viewport' (has a responsive meta viewport tag) lives under the SEO category in Lighthouse,
  // and doubles as the standard mobile-friendliness signal; 'is-on-https' lives under best-practices.
  const mobileOk = audits.viewport ? audits.viewport.score === 1 : null;
  const httpsOk = audits['is-on-https'] ? audits['is-on-https'].score === 1 : null;
  return { speedScore: perf, mobileOk, httpsOk };
}

async function auditSite({ url } = {}) {
  const key = process.env.GOOGLE_PLACES_API_KEY || process.env.VITE_GOOGLE_API_KEY; // PSI is free but an API key raises the quota
  if (!url) throw Object.assign(new Error('Missing url'), { status: 400 });
  const norm = /^https?:\/\//i.test(url) ? url : 'https://' + url;

  return cached('siteaudit:' + norm.toLowerCase(), AUDIT_TTL_MS, async () => {
    const [psi, booking] = await Promise.allSettled([runPageSpeed(norm, key), fetchBookingSignal(norm)]);
    if (psi.status !== 'fulfilled') {
      throw psi.reason instanceof Error ? psi.reason : new Error('PageSpeed audit failed');
    }
    const { speedScore, mobileOk, httpsOk } = psi.value;
    const hasBooking = booking.status === 'fulfilled' ? booking.value : null;

    const issues = [];
    if (speedScore != null && speedScore < LIGHTHOUSE_POOR_SCORE) issues.push('slow load speed');
    if (mobileOk === false) issues.push('not mobile-friendly');
    if (httpsOk === false) issues.push('no HTTPS');
    if (hasBooking === false) issues.push('no online booking link');

    return { url: norm, speedScore, mobileOk, httpsOk, hasBooking, issues, checkedAt: new Date().toISOString() };
  });
}

module.exports = { auditSite };
