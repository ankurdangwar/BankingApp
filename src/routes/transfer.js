const express = require('express');
const router = express.Router();
const idempotencyMiddleware = require('../middleware/idempotencyMiddleware');
const { transferFunds } = require('../services/transferService');

router.post('/', idempotencyMiddleware, async (req, res) => {
  try {
    const { fromAccountId, toAccountId, amount, currency } = req.body;
    const userId = req.headers['x-user-id'] || 'anonymous';
    const idempotencyKey = req.get('Idempotency-Key') || `${userId}:${Date.now()}`;

    const result = await transferFunds({ fromAccountId, toAccountId, amount, currency, userId, idempotencyKey });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
