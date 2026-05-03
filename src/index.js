const express = require('express');
const cookieParser = require('cookie-parser');
const authRouter = require('./routes/auth');
const transferRouter = require('./routes/transfer');
const { connectDatabase } = require('./config/database');

async function start() {
  await connectDatabase();
  const app = express();
  app.use(express.json());
  app.use(cookieParser());

  app.use('/auth', authRouter);
  app.use('/transfer', transferRouter);
  const accountsRouter = require('./routes/accounts');
  app.use('/accounts', accountsRouter);

  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`Server listening on ${port}`));
}

start().catch(err => {
  console.error('Failed to start app', err);
  process.exit(1);
});
