const Account = require('../models/account');

async function updateBalanceWithVersion({ accountId, expectedVersion, delta, minimumBalance = null, session }) {
  const filter = { _id: accountId, __v: expectedVersion };

  if (typeof minimumBalance === 'number') {
    filter.balance = { $gte: minimumBalance };
  }

  const result = await Account.updateOne(
    filter,
    {
      $inc: {
        balance: delta,
        __v: 1
      }
    },
    session ? { session } : undefined
  );

  if (result.matchedCount === 0) {
    throw new Error('Optimistic lock conflict');
  }

  return result;
}

async function readAccountSnapshot(accountId, session) {
  return Account.findById(accountId)
    .select('_id balance currency __v')
    .session(session || null);
}

module.exports = {
  updateBalanceWithVersion,
  readAccountSnapshot
};
