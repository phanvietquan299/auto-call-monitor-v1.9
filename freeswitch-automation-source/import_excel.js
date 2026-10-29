const xlsx = require('xlsx');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const filePath = process.argv[2];
if (!filePath) {
  console.log(" Vui lòng truyền đường dẫn file: node import_excel.js /path/to/file.xlsx");
  process.exit(1);
}

const db = new sqlite3.Database(path.join(__dirname, 'automation.db'));
const workbook = xlsx.readFile(filePath);
const sheetName = workbook.SheetNames[0];
const rows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

db.serialize(() => {
  const stmt = db.prepare('INSERT OR IGNORE INTO numbers (phone, node_id, profile, status) VALUES (?, ?, ?, "BACKUP")');
  let count = 0;

  rows.forEach(row => {
    // Tự động nhận diện tên cột trong file Excel (viết hoa/thường)
    const phone = String(row['SDT'] || row['Phone'] || row['phone'] || '').trim();
    const nodeId = String(row['Node'] || row['NODE'] || row['node_id'] || '').trim();
    const profile = String(row['Profile'] || row['PROFILE'] || row['profile'] || '').trim();

    if (phone && nodeId) {
      stmt.run(phone, nodeId, profile || 'COLLECTION');
      count++;
    }
  });

  stmt.finalize(() => {
    console.log(` Import thành công ${count} số điện thoại vào Phone Pool!`);
  });
});
