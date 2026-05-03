const mongoose = require('mongoose');
const crypto = require('crypto');

function stableStringify(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  const keys = Object.keys(value).sort();
  return `{${keys.map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function hashPayload(payload) {
  return crypto.createHash('sha256').update(stableStringify(payload)).digest('hex');
}

const AuditLogSchema = new mongoose.Schema({
  txId: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction', index: true },
  requestId: { type: String, index: true },
  actorId: { type: String, required: true, index: true },
  actorRole: { type: String },
  action: { type: String, required: true },
  resourceType: { type: String, required: true, index: true },
  resourceId: { type: String, required: true, index: true },
  ipAddress: { type: String },
  userAgent: { type: String },
  before: { type: mongoose.Schema.Types.Mixed },
  after: { type: mongoose.Schema.Types.Mixed },
  metadata: { type: mongoose.Schema.Types.Mixed },
  timestamp: { type: Date, default: Date.now, immutable: true },
  prevHash: { type: String, immutable: true },
  hash: { type: String, immutable: true }
}, {
  versionKey: false,
  timestamps: { createdAt: 'createdAt', updatedAt: false }
});

AuditLogSchema.index({ resourceType: 1, resourceId: 1, createdAt: -1 });
AuditLogSchema.index({ createdAt: -1 });
AuditLogSchema.index({ hash: 1 }, { unique: true });

AuditLogSchema.pre(['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'deleteOne', 'deleteMany'], function blockMutations() {
  throw new Error('Audit log is append-only');
});

AuditLogSchema.statics.recordEvent = async function recordEvent(payload, options = {}) {
  const previous = await this.findOne({
    resourceType: payload.resourceType,
    resourceId: payload.resourceId
  })
    .sort({ createdAt: -1 })
    .select('hash')
    .session(options.session || null);

  const prevHash = previous ? previous.hash : null;
  const hash = hashPayload({ prevHash, ...payload });

  return this.create([{
    ...payload,
    prevHash,
    hash
  }], options.session ? { session: options.session } : undefined);
};

module.exports = mongoose.model('AuditLog', AuditLogSchema);
