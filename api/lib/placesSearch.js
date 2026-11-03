// Server-side only: proxies Google Places Text Search so the Places-capable API key never has
// to be sent to the browser (unlike the Maps JavaScript API key, which is unavoidably client-side
// since it loads as a <script> tag). Prefers a dedicated GOOGLE_PLACES_API_KEY if one is set —
// a server-only key scoped to just the Places API, never exposed client-side — falling back to
// the same key the Maps JS API already uses so this works without provisioning a new key first.
const { cached } = require('./cache');

const FIELD_MASK = 'places.id,places.displayName,places.formattedAddress,places.addressComponents,places.location,places.rating,places.userRatingCount,places.nationalPhoneNumber,places.websiteUri,places.googleMapsUri,places.types,places.businessStatus';
const PLACES_TTL_MS = 6 * 60 * 60 * 1000; // business listings shift slowly; 6h keeps repeat searches cheap without going stale

async function searchPlacesText({ textQuery, near } = {}) {
  const key = process.env.GOOGLE_PLACES_API_KEY || process.env.VITE_GOOGLE_API_KEY;
  if (!key) throw Object.assign(new Error('No Google API key configured on the server'), { status: 500 });
  if (!textQuery) throw Object.assign(new Error('Missing textQuery'), { status: 400 });

  // No regionCode here on purpose — it biases results toward one country, and this app is no
  // longer Canada-only. The free-text query already names the area ("dentists in Muscat, Oman"),
  // which Google resolves fine without a conflicting region hint. languageCode is set so city/
  // address fields come back in English (e.g. "Muscat" not "مسقط") for a consistent CRM across
  // regions — business names stay whatever the owner listed, often already bilingual.
  const body = { textQuery, maxResultCount: 20, languageCode: 'en' };
  if (near && near.lat != null && near.lng != null && near.radius) {
    body.locationBias = { circle: { center: { latitude: near.lat, longitude: near.lng }, radius: near.radius } };
  }
  const cacheKey = 'places:' + JSON.stringify(body);

  return cached(cacheKey, PLACES_TTL_MS, async () => {
    const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': FIELD_MASK,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw Object.assign(new Error((data.error && data.error.message) || `Places API ${res.status}`), { status: res.status });
    }
    return data.places || [];
  });
}

module.exports = { searchPlacesText };
