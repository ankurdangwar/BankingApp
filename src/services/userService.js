const crypto = require('crypto');
const mongoose = require('mongoose');
const User = require('../models/user');
const Account = require('../models/account');

const PASSWORD_ITERATIONS = 120000;
const PASSWORD_KEYLEN = 64;
const PASSWORD_DIGEST = 'sha512';

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function normalizeName(name) {
  return String(name || '').trim();
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const passwordHash = crypto.pbkdf2Sync(
    String(password),
    salt,
    PASSWORD_ITERATIONS,
    PASSWORD_KEYLEN,
    PASSWORD_DIGEST
  ).toString('hex');

  return { salt, passwordHash };
}

function verifyPassword(password, user) {
  const expected = Buffer.from(user.passwordHash, 'hex');
  const actual = Buffer.from(
    crypto.pbkdf2Sync(
      String(password),
      user.passwordSalt,
      PASSWORD_ITERATIONS,
      PASSWORD_KEYLEN,
      PASSWORD_DIGEST
    ).toString('hex'),
    'hex'
  );

  if (expected.length !== actual.length) {
    return false;
  }

  return crypto.timingSafeEqual(expected, actual);
}

function sanitizeUser(user) {
  if (!user) {
    return null;
  }

  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    authProvider: user.authProvider,
    accountId: user.accountId,
    status: user.status
  };
}

function sanitizeAccount(account) {
  if (!account) {
    return null;
  }

  return {
    id: account._id.toString(),
    ownerId: account.ownerId,
    balance: Number(account.balance),
    currency: account.currency,
    status: account.status
  };
}

async function registerUser({
  name,
  email,
  password,
  initialDeposit = 0,
  currency = 'USD',
  authProvider = 'local',
  googleSub = null
}) {
  const normalizedName = normalizeName(name);
  const normalizedEmail = normalizeEmail(email);
  const numericDeposit = Number(initialDeposit);

  if (!normalizedName) {
    throw new Error('Name is required');
  }

  if (!normalizedEmail) {
    throw new Error('Email is required');
  }

  if (!password || String(password).length < 6) {
    throw new Error('Password must be at least 6 characters');
  }

  if (!Number.isFinite(numericDeposit) || numericDeposit < 0) {
    throw new Error('Initial deposit must be zero or a positive number');
  }

  const session = await mongoose.startSession();
  session.startTransaction({ writeConcern: { w: 'majority' } });

  try {
    const existing = await User.findOne({ $or: [{ email: normalizedEmail }, { name: normalizedName }] }).session(session);
    if (existing) {
      throw new Error('User already exists');
    }

    const { salt, passwordHash } = hashPassword(password);
    const userDocs = await User.create([{
      name: normalizedName,
      email: normalizedEmail,
      authProvider,
      googleSub,
      passwordSalt: salt,
      passwordHash,
      status: 'active'
    }], { session });

    const user = userDocs[0];

    const accountDocs = await Account.create([{
      ownerId: user._id.toString(),
      balance: numericDeposit,
      currency,
      status: 'active'
    }], { session });

    const account = accountDocs[0];
    user.accountId = account._id.toString();
    await user.save({ session });

    await session.commitTransaction();
    session.endSession();

    return {
      user: sanitizeUser(user),
      account: sanitizeAccount(account)
    };
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
}

async function authenticateUser({ identifier, password }) {
  const rawIdentifier = normalizeName(identifier);
  const normalizedEmail = normalizeEmail(identifier);

  if (!rawIdentifier) {
    throw new Error('Identifier is required');
  }

  if (!password) {
    throw new Error('Password is required');
  }

  const query = rawIdentifier.includes('@')
    ? { email: normalizedEmail }
    : { $or: [{ name: rawIdentifier }, { email: normalizedEmail }] };

  const user = await User.findOne(query);
  if (!user || !verifyPassword(password, user)) {
    throw new Error('Invalid credentials');
  }

  const account = user.accountId ? await Account.findById(user.accountId) : null;

  return {
    user: sanitizeUser(user),
    account: sanitizeAccount(account)
  };
}

module.exports = {
  authenticateUser,
  hashPassword,
  normalizeEmail,
  normalizeName,
  registerUser,
  sanitizeAccount,
  sanitizeUser,
  verifyPassword
};
