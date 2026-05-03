const mongoose = require('mongoose');
const { transferFunds } = require('./transferService');
const { enqueueOutboxEvent } = require('./outboxService');
const Transaction = require('../models/transaction');
const Account = require('../models/account');

async function compensateTransfer({ originalTransfer, userId, reason }) {
  const session = await mongoose.startSession();
  session.startTransaction({ writeConcern: { w: 'majority' } });

  try {
    const reverseAmount = Number(originalTransfer.amount);
    if (!Number.isFinite(reverseAmount) || reverseAmount <= 0) {
      throw new Error('Invalid transfer amount to compensate');
    }

    const debit = await Account.updateOne(
      { _id: originalTransfer.toAccountId, currency: originalTransfer.currency, balance: { $gte: reverseAmount } },
      { $inc: { balance: -reverseAmount } },
      { session }
    );
    if (debit.matchedCount === 0) {
      throw new Error('Cannot compensate: destination account has insufficient funds');
    }

    const credit = await Account.updateOne(
      { _id: originalTransfer.fromAccountId, currency: originalTransfer.currency },
      { $inc: { balance: reverseAmount } },
      { session }
    );
    if (credit.matchedCount === 0) {
      throw new Error('Cannot compensate: source account missing');
    }

    const [compensationTx] = await Transaction.create([{
      type: 'transfer_compensation',
      fromAccount: originalTransfer.toAccountId,
      toAccount: originalTransfer.fromAccountId,
      amount: reverseAmount,
      currency: originalTransfer.currency,
      status: 'committed',
      idempotencyKey: `${originalTransfer.idempotencyKey}:compensation`,
      createdBy: userId,
      metadata: { compensatesTransactionId: originalTransfer.transactionId, reason }
    }], { session });

    await enqueueOutboxEvent({
      session,
      aggregateType: 'Transaction',
      aggregateId: compensationTx._id,
      eventType: 'transfer.compensated',
      payload: {
        originalTransactionId: originalTransfer.transactionId,
        compensationTransactionId: compensationTx._id.toString(),
        reason
      }
    });

    await session.commitTransaction();
    session.endSession();

    return {
      compensationTransactionId: compensationTx._id.toString(),
      status: 'compensated'
    };
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
}

async function runTransferSaga({ fromAccountId, toAccountId, amount, currency, userId, idempotencyKey, simulateDownstreamFailure = false }) {
  const transferResult = await transferFunds({ fromAccountId, toAccountId, amount, currency, userId, idempotencyKey });

  if (simulateDownstreamFailure) {
    const originalTransfer = {
      transactionId: transferResult.txId,
      fromAccountId,
      toAccountId,
      amount,
      currency,
      idempotencyKey
    };

    const compensation = await compensateTransfer({
      originalTransfer,
      userId,
      reason: 'Downstream notification failed'
    });

    return {
      transfer: transferResult,
      compensation,
      status: 'rolled_back_via_compensation'
    };
  }

  return {
    transfer: transferResult,
    status: 'committed'
  };
}

module.exports = {
  compensateTransfer,
  runTransferSaga
};
