const { generateEmailDraft } = require('./lib/generateEmail');
const { requireAuth } = require('./lib/requireAuth');
const { rateLimit } = require('./lib/cache');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }
  let user;
  try {
    user = await requireAuth(req);
  } catch (err) {
    res.status(err.status || 401).json({ error: err.message });
    return;
  }
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  try {
    rateLimit(user.id, { capacity: 20, refillPerSec: 0.5 }); // Claude calls cost real money
    const draft = await generateEmailDraft(body || {});
    res.status(200).json(draft);
  } catch (err) {
    if (err.retryAfterMs) res.setHeader('Retry-After', Math.ceil(err.retryAfterMs / 1000));
    res.status(err.status || 500).json({ error: err.message });
  }
};
