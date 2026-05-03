const { MongoClient } = require('mongodb');

const uri = process.env.MONGO_URI || 'mongodb://mongo:27017/?replicaSet=rs0';
const intervalMs = parseInt(process.env.WAIT_INTERVAL_MS || '3000', 10);

async function checkPrimary(client) {
  const admin = client.db().admin();
  const res = await admin.command({ hello: 1 });
  // older servers return ismaster, newer return isWritablePrimary
  return !!(res.isWritablePrimary || res.ismaster || res.primary);
}

async function waitForPrimary() {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 2000 });
  while (true) {
    try {
      await client.connect();
      const ok = await checkPrimary(client);
      if (ok) {
        console.log('MongoDB primary is available');
        await client.close();
        return;
      }
      console.log('MongoDB connected but not primary yet, retrying...');
      await client.close();
    } catch (err) {
      console.log('Waiting for MongoDB primary:', err.message);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

waitForPrimary().catch((err) => {
  console.error('Error while waiting for MongoDB primary:', err);
  process.exit(1);
});
