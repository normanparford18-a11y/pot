const { Pool, types } = require('pg');

// pg بترجع BIGINT كـ string افتراضياً، مما يكسر مقارنات === مع أرقام
// منحولها لـ Number لأن آيدي تيليجرام ضمن نطاق الأعداد الآمنة
types.setTypeParser(20, (val) => Number(val));
types.setTypeParser(1016, (val) => val ? val.split(',').map(Number) : []);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('railway')
    ? { rejectUnauthorized: false }
    : false,
});

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bots (
      id SERIAL PRIMARY KEY,
      owner_id BIGINT NOT NULL,
      name TEXT NOT NULL,
      runtime TEXT DEFAULT 'node',
      entry_file TEXT,
      folder_path TEXT,
      status TEXT DEFAULT 'draft',
      last_exit_code INTEGER,
      last_error TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(owner_id, name)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS bot_secrets (
      id SERIAL PRIMARY KEY,
      bot_id INTEGER REFERENCES bots(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      value_encrypted TEXT NOT NULL,
      iv TEXT NOT NULL,
      auth_tag TEXT NOT NULL,
      UNIQUE(bot_id, key)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS bot_logs (
      id SERIAL PRIMARY KEY,
      bot_id INTEGER REFERENCES bots(id) ON DELETE CASCADE,
      line TEXT,
      stream TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
}

async function createBot(ownerId, name) {
  const res = await pool.query(
    `INSERT INTO bots (owner_id, name, status) VALUES ($1, $2, 'draft') RETURNING *`,
    [ownerId, name]
  );
  return res.rows[0];
}

async function getBot(id) {
  const res = await pool.query(`SELECT * FROM bots WHERE id = $1`, [id]);
  return res.rows[0];
}

async function getBotByName(ownerId, name) {
  const res = await pool.query(`SELECT * FROM bots WHERE owner_id = $1 AND name = $2`, [ownerId, name]);
  return res.rows[0];
}

async function listBots(ownerId) {
  const res = await pool.query(`SELECT * FROM bots WHERE owner_id = $1 ORDER BY created_at DESC`, [ownerId]);
  return res.rows;
}

async function updateBot(id, fields) {
  const keys = Object.keys(fields);
  if (keys.length === 0) return;
  const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  const values = keys.map((k) => fields[k]);
  await pool.query(`UPDATE bots SET ${sets}, updated_at = NOW() WHERE id = $1`, [id, ...values]);
}

async function deleteBot(id) {
  await pool.query(`DELETE FROM bots WHERE id = $1`, [id]);
}

async function setSecret(botId, key, encrypted) {
  await pool.query(
    `INSERT INTO bot_secrets (bot_id, key, value_encrypted, iv, auth_tag)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (bot_id, key) DO UPDATE SET value_encrypted = $3, iv = $4, auth_tag = $5`,
    [botId, key, encrypted.value, encrypted.iv, encrypted.authTag]
  );
}

async function getSecrets(botId) {
  const res = await pool.query(`SELECT * FROM bot_secrets WHERE bot_id = $1`, [botId]);
  return res.rows;
}

async function deleteSecret(botId, key) {
  await pool.query(`DELETE FROM bot_secrets WHERE bot_id = $1 AND key = $2`, [botId, key]);
}

async function appendLog(botId, line, stream) {
  await pool.query(`INSERT INTO bot_logs (bot_id, line, stream) VALUES ($1, $2, $3)`, [botId, line, stream]);
}

async function getRecentLogs(botId, limit = 50) {
  const res = await pool.query(
    `SELECT * FROM bot_logs WHERE bot_id = $1 ORDER BY id DESC LIMIT $2`,
    [botId, limit]
  );
  return res.rows.reverse();
}

async function getBotsToAutoRestart() {
  const res = await pool.query(`SELECT * FROM bots WHERE status = 'running'`);
  return res.rows;
}

module.exports = {
  pool,
  init,
  createBot,
  getBot,
  getBotByName,
  listBots,
  updateBot,
  deleteBot,
  setSecret,
  getSecrets,
  deleteSecret,
  appendLog,
  getRecentLogs,
  getBotsToAutoRestart,
};
