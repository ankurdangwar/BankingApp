const express = require('express');
const Account = require('../models/account');

const router = express.Router();

router.get('/:id', async (req, res) => {
  try {
    const acc = await Account.findById(req.params.id).select('balance currency ownerId');
    if (!acc) return res.status(404).json({ error: 'Account not found' });
    return res.json({ balance: Number(acc.balance), currency: acc.currency, ownerId: acc.ownerId });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
