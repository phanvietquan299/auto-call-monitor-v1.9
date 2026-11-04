/* Durable preview/commit import. This module only writes its SQLite inventory, never telephony nodes. */
const crypto = require('crypto');
const Policy = require('./phone-import-policy');
function createExcelImport(connection, { now = Date.now, notify = () => {}, assertImportAllowed = () => {} } = {}) {
  const get = (sql, params = []) => new Promise((resolve, reject) => connection.get(sql, params, (e, row) => e ? reject(e) : resolve(row)));
  const all = (sql, params = []) => new Promise((resolve, reject) => connection.all(sql, params, (e, rows) => e ? reject(e) : resolve(rows)));
  const run = (sql, params = []) => new Promise((resolve, reject) => connection.run(sql, params, function(e) { e ? reject(e) : resolve({ changes: this.changes }); }));
  const ready = (async () => {
    await run('CREATE TABLE IF NOT EXISTS excel_import_previews (id TEXT PRIMARY KEY, owner TEXT NOT NULL, payload TEXT NOT NULL, expires_at INTEGER NOT NULL)');
    await run('CREATE TABLE IF NOT EXISTS excel_import_results (preview_id TEXT NOT NULL, fs TEXT NOT NULL, owner TEXT NOT NULL, result TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY(preview_id,fs))');
  })();
  let queue = Promise.resolve();
  function exclusive(task) {
    const work = queue.then(() => ready).then(task);
    queue = work.catch(() => {});
    return work;
  }
  // Existing numbers are skipped globally, without moving them between nodes/profiles.
  function pending(batch, numbers) {
    const existing = new Set(numbers.map(n => String(n.phone)));
    return batch.phones.filter(phone => !existing.has(phone));
  }
  async function inventory() {
    return { nodes: await all('SELECT id,host,profile FROM nodes'), numbers: await all('SELECT phone,node_id,profile,status FROM numbers') };
  }
  async function preview(owner, message) {
    if (!owner) throw Error('Phiên đăng nhập không hợp lệ');
    if (!['coll','tls','both'].includes(message.selectedSheet) || !Array.isArray(message.entries) || !message.entries.length || message.entries.length > 10000 || JSON.stringify(message.entries).length > 250000) throw Error('Danh sách nạp không hợp lệ hoặc quá lớn');
    const sheets = message.selectedSheet === 'both' ? { coll: [], tls: [] } : { [message.selectedSheet]: [] };
    for (const [index, entry] of message.entries.entries()) {
      if (!entry || typeof entry.phone !== 'string' || typeof entry.publicIp !== 'string') throw Error('Dòng số/IP không hợp lệ');
      const target = Policy.targets.find(t => t.publicIp === entry.publicIp.trim());
      if (!target) throw Error('IP public chưa được map: ' + entry.publicIp);
      const sheet = message.selectedSheet === 'both' ? target.profile === 'COLLECTION' ? 'coll' : 'tls' : message.selectedSheet;
      sheets[sheet].push({ row: index + 1, values: [entry.phone, entry.publicIp] });
    }
    const plan = Policy.prepare(sheets, message.selectedSheet);
    if (plan.errors.length) throw Error(plan.errors.slice(0,20).join('\n'));
    const data = await inventory(), batches = [], groups = [];
    for (const batch of plan.batches) {
      Policy.validateTarget(batch, data.nodes);
      const missing = pending(batch, data.numbers);
      groups.push({ fs: batch.fs, count: missing.length, existing: batch.phones.length - missing.length, total: batch.phones.length, pendingIndexes: missing.map(phone => batch.phones.indexOf(phone)) });
      batches.push({ ...batch, phones: missing });
    }
    const at = now(), id = crypto.randomUUID(), expiresAt = at + 600000;
    await run('DELETE FROM excel_import_previews WHERE expires_at < ?', [at]);
    await run('DELETE FROM excel_import_results WHERE at < ?', [at - 86400000]);
    if ((await get('SELECT count(*) AS count FROM excel_import_previews')).count >= 100) throw Error('Có quá nhiều bảng xem trước; chờ bảng cũ hết hạn');
    await run('INSERT INTO excel_import_previews (id,owner,payload,expires_at) VALUES (?,?,?,?)', [id, owner, JSON.stringify({ batches, selectedSheet: plan.selectedSheet }), expiresAt]);
    return { ok: true, phoneImport: { previewId: id, selectedSheet: plan.selectedSheet, expiresAt, groups } };
  }
  async function execute(owner, message) {
    assertImportAllowed();
    if (!owner || typeof message.previewId !== 'string' || typeof message.fs !== 'string') throw Error('Lượt nạp không hợp lệ');
    const receipt = await get('SELECT result FROM excel_import_results WHERE preview_id=? AND fs=? AND owner=?', [message.previewId, message.fs, owner]);
    if (receipt) return JSON.parse(receipt.result);
    const saved = await get('SELECT payload,expires_at FROM excel_import_previews WHERE id=? AND owner=?', [message.previewId, owner]);
    if (!saved || now() > saved.expires_at) throw Error('Bảng xem trước đã hết hạn hoặc không thuộc phiên này; chọn lại file');
    const batch = JSON.parse(saved.payload).batches.find(b => b.fs === message.fs);
    if (!batch) throw Error('FS không thuộc bảng xem trước đã xác nhận');
    await run('BEGIN IMMEDIATE');
    let result;
    try {
      const data = await inventory();
      Policy.validateTarget(batch, data.nodes);
      const phones = pending(batch, data.numbers);
      for (const phone of phones) await run('INSERT INTO numbers (phone,node_id,profile,status) VALUES (?,?,?,\'BACKUP\')', [phone, batch.fs, batch.profile]);
      const checked = await all('SELECT phone,node_id,profile,status FROM numbers WHERE node_id=?', [batch.fs]);
      if (phones.some(phone => !checked.some(n => String(n.phone) === phone && n.node_id === batch.fs && n.profile === batch.profile))) throw Error('Chưa xác minh đủ số mới trên đúng FS');
      result = { ok: true, phoneImport: { fs: batch.fs, added: phones.length, existing: batch.phones.length - phones.length, verified: true } };
      await run('INSERT INTO excel_import_results (preview_id,fs,owner,result,at) VALUES (?,?,?,?,?)', [message.previewId, batch.fs, owner, JSON.stringify(result), now()]);
      await run('COMMIT');
    } catch (error) {
      await run('ROLLBACK').catch(() => {});
      throw error;
    }
    try { notify(); } catch (_) { /* UI delivery must not turn a committed import into a retry. */ }
    return result;
  }
  return { handle(owner, message) { return exclusive(() => message.type === 'PHONE_IMPORT_PREVIEW' ? preview(owner, message) : message.type === 'PHONE_IMPORT_EXECUTE' ? execute(owner, message) : Promise.reject(Error('Lệnh nạp không hợp lệ'))); } };
}
module.exports = { createExcelImport };
