const mongoose = require('mongoose');

const OutboxEventSchema = new mongoose.Schema({
  aggregateType: { type: String, required: true, index: true },
  aggregateId: { type: String, required: true, index: true },
  eventType: { type: String, required: true, index: true },
  payload: { type: mongoose.Schema.Types.Mixed, required: true },
  status: { type: String, enum: ['pending', 'published', 'failed'], default: 'pending', index: true },
  attempts: { type: Number, default: 0 },
  availableAt: { type: Date, default: Date.now, index: true },
  publishedAt: { type: Date }
}, { timestamps: true });

OutboxEventSchema.index({ status: 1, availableAt: 1, createdAt: 1 });

module.exports = mongoose.model('OutboxEvent', OutboxEventSchema);
