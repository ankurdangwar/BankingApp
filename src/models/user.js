const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, index: true },
  email: { type: String, required: true, trim: true, lowercase: true, unique: true, index: true },
  authProvider: { type: String, default: 'local', index: true },
  googleSub: { type: String, default: null, sparse: true, index: true },
  passwordHash: { type: String, required: true },
  passwordSalt: { type: String, required: true },
  accountId: { type: String, default: null, index: true },
  status: { type: String, default: 'active' }
}, { timestamps: true });

module.exports = mongoose.model('User', UserSchema);
