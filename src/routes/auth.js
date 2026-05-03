const express = require('express');
const { authenticateUser, registerUser } = require('../services/userService');
const { signInWithGoogle } = require('../services/googleAuthService');
const {
  generateAccessToken,
  generateRefreshToken,
  rotateRefreshToken
} = require('../services/authService');

const router = express.Router();
const REFRESH_COOKIE_NAME = 'refresh_token';
const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  path: '/auth/refresh'
};

function setRefreshCookie(res, refreshToken) {
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, {
    ...REFRESH_COOKIE_OPTIONS,
    maxAge: 30 * 24 * 60 * 60 * 1000
  });
}

function issueAccessToken(user) {
  return generateAccessToken({
    sub: user.id,
    email: user.email,
    name: user.name
  });
}

async function createSessionResponse(res, user, deviceId, extra = {}) {
  const accessToken = issueAccessToken(user);
  const refreshToken = await generateRefreshToken(user.id, deviceId);

  setRefreshCookie(res, refreshToken);

  return res.status(extra.statusCode || 200).json({
    accessToken,
    tokenType: 'Bearer',
    expiresIn: process.env.ACCESS_TOKEN_EXP || '15m',
    user,
    account: extra.account || null,
    ...extra.payload
  });
}

router.post('/signup', async (req, res) => {
  try {
    const { name, email, password, initialDeposit, currency, deviceId } = req.body;
    const { user, account } = await registerUser({
      name,
      email,
      password,
      initialDeposit,
      currency
    });

    return createSessionResponse(res, user, deviceId, {
      statusCode: 201,
      account
    });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

router.post(['/login', '/signin'], async (req, res) => {
  const { userId, identifier, password, deviceId } = req.body;

  if (identifier || password) {
    try {
      const { user, account } = await authenticateUser({ identifier, password });
      return createSessionResponse(res, user, deviceId, { account });
    } catch (error) {
      return res.status(401).json({ error: error.message });
    }
  }

  if (!userId) {
    return res.status(400).json({ error: 'userId or identifier is required' });
  }

  const accessToken = generateAccessToken({ sub: userId });
  const refreshToken = await generateRefreshToken(userId, deviceId);

  setRefreshCookie(res, refreshToken);

  return res.status(200).json({
    accessToken,
    tokenType: 'Bearer',
    expiresIn: process.env.ACCESS_TOKEN_EXP || '15m',
    user: { id: userId },
    account: null
  });
});

router.post('/google', async (req, res) => {
  try {
    const { credential, deviceId } = req.body;

    if (!credential) {
      return res.status(400).json({ error: 'Google credential is required' });
    }

    const { user, account, googleProfile } = await signInWithGoogle(credential);
    return createSessionResponse(res, user, deviceId, {
      account,
      payload: { googleProfile }
    });
  } catch (error) {
    return res.status(401).json({ error: error.message });
  }
});

router.post('/refresh', async (req, res) => {
  const refreshToken = req.cookies && req.cookies[REFRESH_COOKIE_NAME];

  if (!refreshToken) {
    return res.status(401).json({ error: 'Missing refresh token cookie' });
  }

  try {
    const { userId, refreshToken: rotatedRefreshToken } = await rotateRefreshToken(
      refreshToken,
      req.body.deviceId
    );

    const newAccessToken = generateAccessToken({ sub: userId });

    res.cookie(REFRESH_COOKIE_NAME, rotatedRefreshToken, {
      ...REFRESH_COOKIE_OPTIONS,
      maxAge: 30 * 24 * 60 * 60 * 1000
    });

    return res.status(200).json({
      accessToken: newAccessToken,
      tokenType: 'Bearer',
      expiresIn: process.env.ACCESS_TOKEN_EXP || '15m'
    });
  } catch (error) {
    res.clearCookie(REFRESH_COOKIE_NAME, {
      ...REFRESH_COOKIE_OPTIONS,
      maxAge: undefined
    });

    return res.status(401).json({ error: error.message });
  }
});

router.post('/logout', async (req, res) => {
  res.clearCookie(REFRESH_COOKIE_NAME, REFRESH_COOKIE_OPTIONS);
  return res.status(204).send();
});

module.exports = router;
