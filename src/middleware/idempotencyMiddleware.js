const IdempotencyKey = require('../models/idempotencyKey');

async function idempotencyMiddleware(req, res, next) {
  const key = req.get('Idempotency-Key');
  if (!key) return next();

  const route = `${req.method}:${req.originalUrl.split('?')[0]}`;
  const userId = (req.user && req.user.id) || (req.headers['x-user-id']) || 'anonymous';

  try {
    // Try to create a record; unique index prevents duplicates
    await IdempotencyKey.create({ key, userId, route, status: 'in_progress', createdAt: new Date(), expiresAt: new Date(Date.now() + 24 * 3600 * 1000) });
  } catch (err) {
    const existing = await IdempotencyKey.findOne({ key, userId, route });
    if (!existing) return res.status(500).json({ error: 'Idempotency error' });
    if (existing.status === 'completed') {
      return res.status(existing.response && existing.response.statusCode ? existing.response.statusCode : 200).json(existing.response && existing.response.body ? existing.response.body : existing.response);
    }
    // If in_progress, inform client it's being processed
    return res.status(202).json({ status: 'in_progress' });
  }

  // capture send to persist response
  const _send = res.send.bind(res);
  res.send = async function (body) {
    try {
      await IdempotencyKey.updateOne({ key, userId, route }, { $set: { status: 'completed', response: { statusCode: res.statusCode, body }, completedAt: new Date() } });
    } catch (e) {
      // ignore best-effort
    }
    return _send(body);
  };

  next();
}

module.exports = idempotencyMiddleware;
