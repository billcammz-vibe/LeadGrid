const { geocodeAddress } = require('./lib/geocode');
const { requireAuth } = require('./lib/requireAuth');
const { rateLimit } = require('./lib/cache');

module.exports = async (req, res) => {
  let user;
  try {
    user = await requireAuth(req);
  } catch (err) {
    res.status(err.status || 401).json({ error: err.message });
    return;
  }
  const address = (req.query && req.query.address) || '';
  try {
    rateLimit(user.id);
    const result = await geocodeAddress(address);
    res.status(200).json(result);
  } catch (err) {
    if (err.retryAfterMs) res.setHeader('Retry-After', Math.ceil(err.retryAfterMs / 1000));
    res.status(err.status || 500).json({ error: err.message });
  }
};
