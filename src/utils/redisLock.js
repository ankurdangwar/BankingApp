const { randomUUID } = require('crypto');

// acquireLock: returns lockValue (string) when acquired, or null
async function acquireLock(redis, key, ttl = 10000) {
  const value = randomUUID();
  const ok = await redis.set(key, value, 'PX', ttl, 'NX');
  if (ok === 'OK') return value;
  return null;
}

// releaseLock: only deletes key if value matches (safe release)
async function releaseLock(redis, key, value) {
  const lua = `if redis.call("get",KEYS[1]) == ARGV[1] then return redis.call("del",KEYS[1]) else return 0 end`;
  const res = await redis.eval(lua, 1, key, value);
  return res === 1;
}

module.exports = { acquireLock, releaseLock };
