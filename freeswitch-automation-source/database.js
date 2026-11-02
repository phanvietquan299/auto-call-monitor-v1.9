const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

let db;

async function initDB() {
  db = await open({
    filename: './database.sqlite',
    driver: sqlite3.Database
  });

  // 1. Bảng quản lý 8 Node FreeSWITCH
  await db.exec(`
    CREATE TABLE IF NOT EXISTS nodes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      host TEXT NOT NULL,
      port INTEGER DEFAULT 8021,
      password TEXT DEFAULT 'REDACTED_PRIVATE_BACKUP_ONLY',
      status TEXT DEFAULT 'FULL_ONLINE', -- FULL_ONLINE | MANUAL_ONLY | MAINTENANCE
      health TEXT DEFAULT 'DISCONNECTED', -- CONNECTED | DISCONNECTED
      last_check TEXT
    );
  `);

  // 2. Bảng quản lý Pool SĐT
  await db.exec(`
    CREATE TABLE IF NOT EXISTS numbers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT NOT NULL UNIQUE,
      node_id TEXT NOT NULL,
      profile TEXT DEFAULT 'COLLECTION',
      status TEXT DEFAULT 'BACKUP', -- ACTIVE | BACKUP | BLOCKED
      priority INTEGER DEFAULT 1,
      updated_at TEXT,
      FOREIGN KEY (node_id) REFERENCES nodes(id)
    );
  `);

  // 3. Bảng Lịch sử đổi số (Audit Logs)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS swap_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      node_id TEXT NOT NULL,
      old_phone TEXT NOT NULL,
      new_phone TEXT NOT NULL,
      swap_type TEXT NOT NULL, -- AUTO | MANUAL
      operator TEXT DEFAULT 'System',
      created_at TEXT
    );
  `);

  // Khởi tạo sẵn 8 Node mặc định nếu chưa có
  const existingNodes = await db.all('SELECT * FROM nodes');
  if (existingNodes.length === 0) {
    const defaultNodes = [
      ['FS01', 'Node FS 01', '115.84.183.21', 8021],
      ['FS02', 'Node FS 02', '115.84.183.22', 8021],
      ['FS03', 'Node FS 03', '115.84.183.23', 8021],
      ['FS04', 'Node FS 04', '115.84.183.24', 8021],
      ['FS05', 'Node FS 05', '115.84.183.25', 8021],
      ['FS06', 'Node FS 06', '115.84.183.26', 8021],
      ['FS07', 'Node FS 07', '115.84.183.27', 8021],
      ['FS08', 'Node FS 08', '115.84.183.28', 8021]
    ];

    for (const [id, name, host, port] of defaultNodes) {
      await db.run(
        'INSERT INTO nodes (id, name, host, port) VALUES (?, ?, ?, ?)',
        [id, name, host, port]
      );
    }
    console.log('[DB] Đã khởi tạo 8 Node mặc định thành công!');
  }

  console.log('[DB] Database SQLite sẵn sàng!');
  return db;
}

function getDB() {
  return db;
}

module.exports = { initDB, getDB };
