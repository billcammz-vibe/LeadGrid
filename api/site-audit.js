const { auditSite } = require('./lib/siteAudit');
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
    rateLimit(user.id, { capacity: 30, refillPerSec: 1 }); // PSI is slow per-call but cheap to burst-request
    const audit = await auditSite(body || {});
    res.status(200).json(audit);
  } catch (err) {
    if (err.retryAfterMs) res.setHeader('Retry-After', Math.ceil(err.retryAfterMs / 1000));
    res.status(err.status || 500).json({ error: err.message });
  }
};
