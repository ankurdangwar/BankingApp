const mongoose = require('mongoose');
const Account = require('../models/account');
const Transaction = require('../models/transaction');
const IdempotencyKey = require('../models/idempotencyKey');
const AuditLog = require('../models/auditLog');
const { enqueueOutboxEvent } = require('./outboxService');

async function transferFunds({ fromAccountId, toAccountId, amount, currency = 'USD', userId, idempotencyKey }) {
  const session = await mongoose.startSession();
  session.startTransaction({
    writeConcern: { w: 'majority' }
  });

  try {
    // Idempotency check within the transaction
    let existing = await IdempotencyKey.findOne({ key: idempotencyKey }).session(session);
    if (existing && existing.status === 'completed') {
      await session.commitTransaction();
      session.endSession();
      return existing.response;
    }
    if (!existing) {
      await IdempotencyKey.create([{
        key: idempotencyKey,
        userId,
        route: 'POST:/transfer',
        status: 'in_progress',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 3600 * 1000)
      }], { session });
    }

    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      throw new Error('Amount must be a positive number');
    }

    // Debit from source atomically (ensure sufficient funds)
    const debit = await Account.updateOne(
      { _id: fromAccountId, currency, balance: { $gte: numericAmount } },
      { $inc: { balance: -numericAmount } },
      { session }
    );
    if (debit.matchedCount === 0) {
      throw new Error('Insufficient funds or account mismatch');
    }

    // Credit destination
    const credit = await Account.updateOne(
      { _id: toAccountId, currency },
      { $inc: { balance: numericAmount } },
      { session }
    );
    if (credit.matchedCount === 0) {
      throw new Error('Destination account missing or currency mismatch');
    }

    const txDocs = await Transaction.create([{
      type: 'transfer', fromAccount: fromAccountId, toAccount: toAccountId,
      amount: numericAmount, currency, status: 'committed', idempotencyKey, createdBy: userId
    }], { session });

    const tx = txDocs[0];

    // Mark idempotency complete
    await IdempotencyKey.updateOne({ key: idempotencyKey }, { $set: { status: 'completed', response: { txId: tx._id, status: 'committed' }, completedAt: new Date() } }, { session });

    // Append a simple audit log entry
    await AuditLog.recordEvent({
      txId: tx._id,
      requestId: idempotencyKey,
      actorId: userId,
      actorRole: 'customer',
      action: 'transfer',
      resourceType: 'Account',
      resourceId: fromAccountId.toString(),
      ipAddress: null,
      userAgent: null,
      before: null,
      after: null,
      metadata: { amount: numericAmount, currency },
      timestamp: new Date()
    }, { session });

    await enqueueOutboxEvent({
      session,
      aggregateType: 'Transaction',
      aggregateId: tx._id,
      eventType: 'transfer.committed',
      payload: {
        transactionId: tx._id.toString(),
        fromAccountId: fromAccountId.toString(),
        toAccountId: toAccountId.toString(),
        amount: numericAmount,
        currency,
        idempotencyKey
      }
    });

    await session.commitTransaction();
    session.endSession();
    return { txId: tx._id, status: 'committed' };
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    // best-effort mark idempotency failed outside of session
    try { await IdempotencyKey.updateOne({ key: idempotencyKey }, { $set: { status: 'failed' } }); } catch (e) {}
    throw err;
  }
}

module.exports = { transferFunds };
