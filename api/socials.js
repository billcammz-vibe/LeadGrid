const { fetchSocialsFor } = require('./lib/extractSocials');
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
  const { url, name, city } = req.query || {};
  if (!url && !name) {
    res.status(400).json({ error: 'Missing url or name parameter' });
    return;
  }
  try {
    rateLimit(user.id);
    const result = await fetchSocialsFor({ url: url || '', name: name || '', city: city || '' });
    res.status(200).json(result);
  } catch (err) {
    if (err.retryAfterMs) res.setHeader('Retry-After', Math.ceil(err.retryAfterMs / 1000));
    res.status(err.status || 500).json({ error: err.message });
  }
};
