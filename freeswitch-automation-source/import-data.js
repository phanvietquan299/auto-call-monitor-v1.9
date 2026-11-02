const { initDB, getDB } = require('./database');

async function seedData() {
  const db = await initDB();

  // Mẫu dữ liệu hiện tại của bạn từ FS01
  const initialNumbers = [
    { phone: '0968289545', node: 'FS01', profile: 'COLLECTION', status: 'BLOCKED' },
    { phone: '0968291275', node: 'FS01', profile: 'COLLECTION', status: 'BLOCKED' },
    { phone: '0968293765', node: 'FS01', profile: 'COLLECTION', status: 'BLOCKED' },
    { phone: '0869890590', node: 'FS01', profile: 'COLLECTION', status: 'ACTIVE' },
    { phone: '0869890660', node: 'FS01', profile: 'COLLECTION', status: 'BACKUP' },
    { phone: '0862119519', node: 'FS01', profile: 'COLLECTION', status: 'BACKUP' }
  ];

  for (let item of initialNumbers) {
    await db.run(
      `INSERT OR REPLACE INTO numbers (phone, node_id, profile, status, updated_at) VALUES (?, ?, ?, ?, DATETIME('now'))`,
      [item.phone, item.node, item.profile, item.status]
    );
  }

  console.log('✅ Đã nạp dữ liệu mẫu SĐT vào Database!');
}

seedData();
