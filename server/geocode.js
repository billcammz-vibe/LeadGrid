// Server-side only: proxies Google Geocoding so typing a place name (e.g. "London, ON") in the
// map's Location field can be turned into coordinates without the Maps JS key needing the
// Geocoding API enabled — reuses the same server-only key as the Places search proxy.
const { cached } = require('./cache');

const GEOCODE_TTL_MS = 24 * 60 * 60 * 1000; // a place name → coordinate mapping is effectively static

async function geocodeAddress(address) {
  const key = process.env.GOOGLE_PLACES_API_KEY || process.env.VITE_GOOGLE_API_KEY;
  if (!key) throw Object.assign(new Error('No Google API key configured on the server'), { status: 500 });
  if (!address) throw Object.assign(new Error('Missing address'), { status: 400 });

  return cached('geo:' + address.trim().toLowerCase(), GEOCODE_TTL_MS, async () => {
    const url = 'https://maps.googleapis.com/maps/api/geocode/json?address=' + encodeURIComponent(address) + '&key=' + key;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    const data = await res.json().catch(() => ({}));
    if (data.status !== 'OK' || !data.results || !data.results[0]) {
      const msg = data.status === 'ZERO_RESULTS' ? 'not found' : (data.error_message || data.status || 'geocoding failed');
      throw Object.assign(new Error(msg), { status: data.status === 'ZERO_RESULTS' ? 404 : 502 });
    }
    const r = data.results[0];
    return {
      lat: r.geometry.location.lat,
      lng: r.geometry.location.lng,
      viewport: r.geometry.viewport || null,
      formattedAddress: r.formatted_address || address,
    };
  });
}

module.exports = { geocodeAddress };
