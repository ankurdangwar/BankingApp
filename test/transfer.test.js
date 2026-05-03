const mongoose = require('mongoose');
const request = require('supertest');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const express = require('express');
const crypto = require('crypto');
const cookieParser = require('cookie-parser');

process.env.GOOGLE_CLIENT_ID = 'test-google-client-id';

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

let mongod;
let app;

beforeAll(async () => {
  mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const uri = mongod.getUri();
  await mongoose.connect(uri, { dbName: 'test' });

  // build app
  app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/auth', require('../src/routes/auth'));
  const transferRouter = require('../src/routes/transfer');
  app.use('/transfer', transferRouter);
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

test('transfer is transactional and idempotent', async () => {
  const Account = require('../src/models/account');

  // Create two accounts
  const a1 = await Account.create({ ownerId: 'u1', balance: 100, currency: 'USD' });
  const a2 = await Account.create({ ownerId: 'u2', balance: 10, currency: 'USD' });

  const payload = { fromAccountId: a1._id.toString(), toAccountId: a2._id.toString(), amount: 25, currency: 'USD' };
  const key = 'test-key-123';

  const res1 = await request(app).post('/transfer').set('Idempotency-Key', key).set('x-user-id', 'u1').send(payload);
  expect(res1.status).toBe(200);
  expect(res1.body.status).toBe('committed');

  // call again with same key
  const res2 = await request(app).post('/transfer').set('Idempotency-Key', key).set('x-user-id', 'u1').send(payload);
  // middleware returns 200 with same response
  expect([200, 202]).toContain(res2.status);

  // verify balances
  const freshA1 = await Account.findById(a1._id);
  const freshA2 = await Account.findById(a2._id);
  expect(freshA1.balance).toBe(75);
  expect(freshA2.balance).toBe(35);
});

test('audit logs are append-only and hash chained', async () => {
  const AuditLog = require('../src/models/auditLog');

  const firstPayload = {
    actorId: 'u1',
    actorRole: 'customer',
    action: 'transfer',
    resourceType: 'Account',
    resourceId: 'acct-1',
    metadata: { amount: 25, currency: 'USD' }
  };

  const first = await AuditLog.recordEvent(firstPayload);
  const firstDoc = first[0];

  expect(firstDoc.prevHash).toBeNull();
  expect(firstDoc.hash).toBe(hashPayload({ prevHash: null, ...firstPayload }));

  const secondPayload = {
    actorId: 'u1',
    actorRole: 'customer',
    action: 'transfer',
    resourceType: 'Account',
    resourceId: 'acct-1',
    metadata: { amount: 50, currency: 'USD' }
  };

  const second = await AuditLog.recordEvent(secondPayload);
  const secondDoc = second[0];

  expect(secondDoc.prevHash).toBe(firstDoc.hash);
  expect(secondDoc.hash).toBe(hashPayload({ prevHash: firstDoc.hash, ...secondPayload }));
  expect(secondDoc.hash).not.toBe(firstDoc.hash);

  await expect(
    AuditLog.updateOne({ _id: secondDoc._id }, { $set: { action: 'tamper' } })
  ).rejects.toThrow('Audit log is append-only');
});

test('optimistic locking rejects stale account versions', async () => {
  const Account = require('../src/models/account');
  const { updateBalanceWithVersion, readAccountSnapshot } = require('../src/services/optimisticConcurrencyService');

  const account = await Account.create({ ownerId: 'u-opt', balance: 50, currency: 'USD' });
  const snapshot = await readAccountSnapshot(account._id);

  await Account.updateOne(
    { _id: account._id },
    { $inc: { balance: 10, __v: 1 } }
  );

  await expect(
    updateBalanceWithVersion({
      accountId: account._id,
      expectedVersion: snapshot.__v,
      delta: -20,
      minimumBalance: 20
    })
  ).rejects.toThrow('Optimistic lock conflict');
});

test('transfer writes an outbox event in the same transaction', async () => {
  const Account = require('../src/models/account');
  const OutboxEvent = require('../src/models/outboxEvent');

  const source = await Account.create({ ownerId: 'u-outbox-1', balance: 120, currency: 'USD' });
  const destination = await Account.create({ ownerId: 'u-outbox-2', balance: 30, currency: 'USD' });

  const transferRouter = require('../src/routes/transfer');
  const localApp = express();
  localApp.use(express.json());
  localApp.use('/transfer', transferRouter);

  const res = await request(localApp)
    .post('/transfer')
    .set('Idempotency-Key', 'outbox-key-1')
    .set('x-user-id', 'u-outbox-1')
    .send({
      fromAccountId: source._id.toString(),
      toAccountId: destination._id.toString(),
      amount: 20,
      currency: 'USD'
    });

  expect(res.status).toBe(200);

  const outboxEvents = await OutboxEvent.find({
    aggregateType: 'Transaction',
    eventType: 'transfer.committed',
    'payload.idempotencyKey': 'outbox-key-1'
  });
  expect(outboxEvents).toHaveLength(1);
  expect(outboxEvents[0].status).toBe('pending');
  expect(outboxEvents[0].payload.amount).toBe(20);
});

test('saga compensates a transfer when a downstream step fails', async () => {
  const Account = require('../src/models/account');
  const Transaction = require('../src/models/transaction');
  const OutboxEvent = require('../src/models/outboxEvent');
  const { runTransferSaga } = require('../src/services/sagaService');

  const source = await Account.create({ ownerId: 'u-saga-1', balance: 200, currency: 'USD' });
  const destination = await Account.create({ ownerId: 'u-saga-2', balance: 15, currency: 'USD' });

  const result = await runTransferSaga({
    fromAccountId: source._id.toString(),
    toAccountId: destination._id.toString(),
    amount: 40,
    currency: 'USD',
    userId: 'u-saga-1',
    idempotencyKey: 'saga-key-1',
    simulateDownstreamFailure: true
  });

  expect(result.status).toBe('rolled_back_via_compensation');
  expect(result.compensation.status).toBe('compensated');

  const freshSource = await Account.findById(source._id);
  const freshDestination = await Account.findById(destination._id);
  expect(freshSource.balance).toBe(200);
  expect(freshDestination.balance).toBe(15);

  const transactionTypes = await Transaction.find({
    idempotencyKey: { $in: ['saga-key-1', 'saga-key-1:compensation'] }
  }).sort({ createdAt: 1 });

  expect(transactionTypes.map(tx => tx.type)).toEqual(['transfer', 'transfer_compensation']);

  const outboxEvents = await OutboxEvent.find({
    $or: [
      { 'payload.idempotencyKey': 'saga-key-1' },
      { 'payload.originalTransactionId': result.transfer.txId }
    ]
  }).sort({ createdAt: 1 });

  expect(outboxEvents.map(event => event.eventType)).toEqual(['transfer.committed', 'transfer.compensated']);
});

test('signup creates a user and bank account, and login works by email or name', async () => {
  const User = require('../src/models/user');
  const Account = require('../src/models/account');

  const signupResponse = await request(app)
    .post('/auth/signup')
    .send({
      name: 'Ada Lovelace',
      email: 'ada@gmail.com',
      password: 'secret123',
      initialDeposit: 250,
      currency: 'USD'
    });

  expect(signupResponse.status).toBe(201);
  expect(signupResponse.body.user.email).toBe('ada@gmail.com');
  expect(signupResponse.body.account.balance).toBe(250);
  expect(signupResponse.body.account.ownerId).toBe(signupResponse.body.user.id);

  const user = await User.findOne({ email: 'ada@gmail.com' });
  expect(user).not.toBeNull();
  expect(user.accountId).toBeTruthy();

  const linkedAccount = await Account.findById(user.accountId);
  expect(linkedAccount).not.toBeNull();
  expect(linkedAccount.balance).toBe(250);

  const emailLogin = await request(app)
    .post('/auth/login')
    .send({ identifier: 'ada@gmail.com', password: 'secret123' });

  expect(emailLogin.status).toBe(200);
  expect(emailLogin.body.user.name).toBe('Ada Lovelace');
  expect(emailLogin.body.account.id).toBe(user.accountId);

  const nameLogin = await request(app)
    .post('/auth/login')
    .send({ identifier: 'Ada Lovelace', password: 'secret123' });

  expect(nameLogin.status).toBe(200);
  expect(nameLogin.body.user.email).toBe('ada@gmail.com');
});

test('google oauth sign-in creates or reuses a user account', async () => {
  const User = require('../src/models/user');
  const { OAuth2Client } = require('google-auth-library');

  const verifySpy = jest.spyOn(OAuth2Client.prototype, 'verifyIdToken').mockResolvedValue({
    getPayload: () => ({
      sub: 'google-sub-123',
      email: 'newton@gmail.com',
      email_verified: true,
      name: 'Isaac Newton',
      picture: 'https://example.com/avatar.png'
    })
  });

  const response = await request(app)
    .post('/auth/google')
    .send({ credential: 'fake-google-id-token' });

  verifySpy.mockRestore();

  expect(response.status).toBe(200);
  expect(response.body.user.email).toBe('newton@gmail.com');
  expect(response.body.user.authProvider).toBe('google');
  expect(response.body.googleProfile.email).toBe('newton@gmail.com');

  const user = await User.findOne({ email: 'newton@gmail.com' });
  expect(user).not.toBeNull();
  expect(user.googleSub).toBe('google-sub-123');
});
