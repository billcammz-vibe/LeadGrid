const { runHuntStage } = require('../server/hunter');
const { requireAuth } = require('../server/requireAuth');
const { rateLimit } = require('../server/cache');

// Client Hunter: one stage of the pipeline per call (see api/lib/hunter.js). The browser drives
// the stages in order, so each call stays inside the serverless time limit.
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
    // One hunt fires ~50 Claude calls (8 scouts, teardown, 3 judges, 12 votes, 12+ final checks…)
    rateLimit(user.id, { capacity: 120, refillPerSec: 1 });
    const out = await runHuntStage(body || {});
    res.status(200).json(out);
  } catch (err) {
    if (err.retryAfterMs) res.setHeader('Retry-After', Math.ceil(err.retryAfterMs / 1000));
    res.status(err.status || 500).json({ error: err.message });
  }
};
