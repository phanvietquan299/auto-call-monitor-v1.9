const esl = require('modesl');
const { getDB } = require('./database');

class NodeManager {
  // Thực thi lệnh ESL trực tiếp tới Node FreeSWITCH
  async executeEslCommand(node, command) {
    return new Promise((resolve, reject) => {
      const conn = new esl.Connection(node.host, node.port, node.password, () => {
        conn.api(command, (response) => {
          const resText = response.getBody();
          conn.disconnect();
          resolve({ success: true, response: resText });
        });
      });

      conn.on('error', (err) => {
        reject(new Error(`ESL Error [${node.id}]: ${err.message}`));
      });
    });
  }

  // Hàm xử lý ĐỔI SỐ core
  async swapNumber(nodeId, oldPhone, swapType = 'MANUAL', operator = 'Admin') {
    const db = getDB();
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

    // 1. Kiểm tra trạng thái Node
    const node = await db.get('SELECT * FROM nodes WHERE id = ?', [nodeId]);
    if (!node) throw new Error(`Node ${nodeId} không tồn tại!`);

    if (node.status === 'MAINTENANCE') {
      throw new Error(`Node ${nodeId} đang BẢO TRÌ HOÀN TOÀN (MAINTENANCE).`);
    }

    if (swapType === 'AUTO' && node.status !== 'FULL_ONLINE') {
      console.log(`[AUTO BLOCKED] Node ${nodeId} đang ở chế độ ${node.status}. Bỏ qua Auto Swap!`);
      return { status: 'IGNORED', reason: 'NODE_NOT_FULL_ONLINE' };
    }

    // 2. Tìm số BACKUP khả thi đầu tiên của Node này
    const backupItem = await db.get(
      'SELECT * FROM numbers WHERE node_id = ? AND status = "BACKUP" ORDER BY id ASC LIMIT 1',
      [nodeId]
    );

    if (!backupItem) {
      throw new Error(`⚠️ HẾT SỐ BACKUP CHO NODE ${nodeId}!`);
    }

    const newPhone = backupItem.phone;

    // 3. Thực thi đổi số trên FreeSWITCH via ESL (Nếu cần rescan/reload)
    try {
      await this.executeEslCommand(node, 'sofia profile external rescan');
    } catch (eslErr) {
      console.warn(`[ESL WARN] Không thể reload ESL Node ${nodeId}: ${eslErr.message}`);
    }

    // 4. Update trạng thái trong DB (Transaction)
    await db.run('UPDATE numbers SET status = "BLOCKED", updated_at = ? WHERE phone = ?', [now, oldPhone]);
    await db.run('UPDATE numbers SET status = "ACTIVE", updated_at = ? WHERE phone = ?', [now, newPhone]);

    // 5. Ghi log
    await db.run(
      'INSERT INTO swap_logs (node_id, old_phone, new_phone, swap_type, operator, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [nodeId, oldPhone, newPhone, swapType, operator, now]
    );

    console.log(`[SWAP SUCCESS] [${nodeId}] (${swapType}) ${oldPhone} -> ${newPhone} | Op: ${operator}`);

    return {
      status: 'SUCCESS',
      nodeId,
      oldPhone,
      newPhone,
      operator,
      time: now
    };
  }
}

module.exports = new NodeManager();
