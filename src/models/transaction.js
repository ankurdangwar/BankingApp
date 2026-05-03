const mongoose = require('mongoose');

const TransactionSchema = new mongoose.Schema({
  type: { type: String, required: true },
  fromAccount: { type: mongoose.Schema.Types.ObjectId, ref: 'Account' },
  toAccount: { type: mongoose.Schema.Types.ObjectId, ref: 'Account' },
  amount: { type: mongoose.Schema.Types.Decimal128, required: true },
  currency: { type: String, required: true },
  status: { type: String, enum: ['pending', 'committed', 'failed'], required: true },
  idempotencyKey: { type: String, index: true },
  createdBy: { type: String }
}, { timestamps: true });

module.exports = mongoose.model('Transaction', TransactionSchema);
