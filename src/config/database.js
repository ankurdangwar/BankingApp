const mongoose = require('mongoose');

async function connectDatabase() {
  const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/vibe?replicaSet=rs0';
  const dbName = process.env.MONGO_DB_NAME || 'vibe';

  mongoose.set('strictQuery', true);
  mongoose.set('autoIndex', process.env.NODE_ENV !== 'production');

  await mongoose.connect(mongoUri, {
    dbName,
    serverSelectionTimeoutMS: 5000,
    maxPoolSize: 10
  });

  return mongoose.connection;
}

module.exports = { connectDatabase };
