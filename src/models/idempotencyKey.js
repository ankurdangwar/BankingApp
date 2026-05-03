const mongoose = require('mongoose');

const IdempotencyKeySchema = new mongoose.Schema({
  key: { type: String, required: true },
  userId: { type: String, required: true },
  route: { type: String, required: true },
  status: { type: String, enum: ['in_progress', 'completed', 'failed'], default: 'in_progress' },
  response: { type: mongoose.Schema.Types.Mixed },
  createdAt: { type: Date, default: Date.now },
  completedAt: { type: Date },
  expiresAt: { type: Date }
});

IdempotencyKeySchema.index({ key: 1, route: 1, userId: 1 }, { unique: true });
IdempotencyKeySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('IdempotencyKey', IdempotencyKeySchema);
