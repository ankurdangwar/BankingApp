const { OAuth2Client } = require('google-auth-library');
const crypto = require('crypto');
const { registerUser, sanitizeAccount, sanitizeUser } = require('./userService');
const User = require('../models/user');
const Account = require('../models/account');

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';

function getGoogleClient() {
  if (!GOOGLE_CLIENT_ID) {
    throw new Error('GOOGLE_CLIENT_ID is required');
  }

  return new OAuth2Client(GOOGLE_CLIENT_ID);
}

async function findUserByGoogleProfile(payload) {
  const googleSub = payload.sub;
  const email = String(payload.email || '').trim().toLowerCase();

  const user = await User.findOne({
    $or: [
      { googleSub },
      { email }
    ]
  });

  return user;
}

async function createGoogleUser(payload) {
  const email = String(payload.email || '').trim().toLowerCase();
  const name = String(payload.name || payload.given_name || email.split('@')[0] || 'Google User').trim();

  return registerUser({
    name,
    email,
    password: crypto.randomBytes(32).toString('hex'),
    initialDeposit: 0,
    currency: 'USD',
    provider: 'google',
    authProvider: 'google',
    googleSub: payload.sub
  });
}

async function ensureAccountForUser(userDoc, currency = 'USD') {
  if (userDoc.accountId) {
    const account = await Account.findById(userDoc.accountId);
    if (account) {
      return account;
    }
  }

  const account = await Account.create({
    ownerId: userDoc._id.toString(),
    balance: 0,
    currency,
    status: 'active'
  });

  userDoc.accountId = account._id.toString();
  await userDoc.save();

  return account;
}

async function verifyGoogleIdToken(idToken) {
  const client = getGoogleClient();
  const ticket = await client.verifyIdToken({
    idToken,
    audience: GOOGLE_CLIENT_ID
  });

  const payload = ticket.getPayload();
  if (!payload || !payload.email) {
    throw new Error('Google account did not return an email address');
  }

  if (payload.email_verified === false) {
    throw new Error('Google account email is not verified');
  }

  return payload;
}

async function signInWithGoogle(idToken) {
  const payload = await verifyGoogleIdToken(idToken);
  let user = await findUserByGoogleProfile(payload);

  if (!user) {
    const created = await createGoogleUser(payload);
    user = await User.findById(created.user.id);
  }

  if (!user.googleSub) {
    user.googleSub = payload.sub;
  }

  if (!user.authProvider) {
    user.authProvider = 'google';
  }

  if (!user.name && payload.name) {
    user.name = payload.name;
  }

  if (!user.email && payload.email) {
    user.email = String(payload.email).trim().toLowerCase();
  }

  if (!user.passwordHash || !user.passwordSalt) {
    user.passwordHash = 'google-oauth';
    user.passwordSalt = 'google-oauth';
  }

  await user.save();

  const account = await ensureAccountForUser(user, 'USD');

  return {
    user: sanitizeUser(user),
    account: sanitizeAccount(account),
    googleProfile: {
      email: payload.email,
      name: payload.name,
      picture: payload.picture,
      subject: payload.sub
    }
  };
}

module.exports = {
  signInWithGoogle,
  verifyGoogleIdToken
};
