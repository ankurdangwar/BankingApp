const mongoose = require('mongoose');

const AccountSchema = new mongoose.Schema({
  ownerId: { type: String, required: true, index: true },
  balance: { type: Number, required: true, default: 0 },
  currency: { type: String, required: true, default: 'USD' },
  status: { type: String, default: 'active' },
}, { timestamps: true });

AccountSchema.set('optimisticConcurrency', true);

module.exports = mongoose.model('Account', AccountSchema);
