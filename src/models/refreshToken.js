const mongoose = require('mongoose');

const RefreshTokenSchema = new mongoose.Schema({
  tokenHash: { type: String, required: true, index: true },
  userId: { type: String, required: true, index: true },
  deviceId: { type: String },
  revoked: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date }
});

module.exports = mongoose.model('RefreshToken', RefreshTokenSchema);
