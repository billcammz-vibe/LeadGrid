// Best-effort in-memory helpers shared by the paid API proxies (Places, Geocoding, socials).
// On Vercel these live only for the lifetime of a warm serverless instance, so they cut cost for
// repeated identical queries and blunt bursts from one user — they are NOT a hard, cross-instance
// guarantee. Swap the two Maps for a shared store (e.g. Upstash Redis) if you ever need that.

const store = new Map(); // key -> { value, expires }
const MAX_ENTRIES = 500;

async function cached(key, ttlMs, produce) {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expires > now) return hit.value;
  const value = await produce(); // a throw here propagates and is deliberately not cached
  store.set(key, { value, expires: now + ttlMs });
  if (store.size > MAX_ENTRIES) {
    // Oldest-first eviction — Map preserves insertion order, so the first keys are the stalest.
    for (const k of store.keys()) { store.delete(k); if (store.size <= MAX_ENTRIES - 100) break; }
  }
  return value;
}

const buckets = new Map(); // userId -> { tokens, updated }

// Token bucket per user: `capacity` requests available as a burst, refilling `refillPerSec`/sec.
// A LeadGrid area search fires ~9 Places calls at once, so the defaults leave room for a few
// back-to-back searches plus enrichment while still capping sustained abuse.
function rateLimit(userId, { capacity = 60, refillPerSec = 1 } = {}) {
  const now = Date.now();
  const b = buckets.get(userId) || { tokens: capacity, updated: now };
  b.tokens = Math.min(capacity, b.tokens + ((now - b.updated) / 1000) * refillPerSec);
  b.updated = now;
  if (b.tokens < 1) {
    buckets.set(userId, b);
    const retryAfterMs = Math.ceil(((1 - b.tokens) / refillPerSec) * 1000);
    throw Object.assign(new Error('Rate limit exceeded — please slow down'), { status: 429, retryAfterMs });
  }
  b.tokens -= 1;
  buckets.set(userId, b);
}

module.exports = { cached, rateLimit };
