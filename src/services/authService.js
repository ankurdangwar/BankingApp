const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const RefreshToken = require('../models/refreshToken');

const ACCESS_TOKEN_EXP = process.env.ACCESS_TOKEN_EXP || '15m';
const REFRESH_TOKEN_TTL_DAYS = Number(process.env.REFRESH_TOKEN_TTL_DAYS || 30);
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret';

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function generateAccessToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXP });
}

async function generateRefreshToken(userId, deviceId) {
  const plain = crypto.randomBytes(48).toString('hex');
  const tokenHash = hashToken(plain);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + REFRESH_TOKEN_TTL_DAYS * 24 * 3600 * 1000);

  await RefreshToken.create({ tokenHash, userId, deviceId, expiresAt });
  return plain;
}

// Rotate refresh token: accept plain token, revoke old, issue new one
async function rotateRefreshToken(plainToken, deviceId) {
  const tokenHash = hashToken(plainToken);
  const existing = await RefreshToken.findOne({ tokenHash });
  if (!existing || existing.revoked) throw new Error('Invalid refresh token');
  if (existing.expiresAt && existing.expiresAt < new Date()) throw new Error('Refresh token expired');

  // Revoke existing
  existing.revoked = true;
  await existing.save();

  // Issue new refresh token
  const newPlain = await generateRefreshToken(existing.userId, deviceId || existing.deviceId);
  return { userId: existing.userId, refreshToken: newPlain };
}

async function revokeRefreshTokenByHash(plainToken) {
  const tokenHash = hashToken(plainToken);
  await RefreshToken.updateOne({ tokenHash }, { $set: { revoked: true } });
}

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  rotateRefreshToken,
  revokeRefreshTokenByHash,
  hashToken
};
