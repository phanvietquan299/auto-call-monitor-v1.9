/* Delete only explicitly selected inventory IDs, in a separate SQLite transaction. */
function createNumberDelete(connection, { assertDeleteAllowed = () => {}, notify = () => {} } = {}) {
  const all = (sql, params) => new Promise((resolve, reject) => connection.all(sql, params, (e, rows) => e ? reject(e) : resolve(rows)));
  const run = (sql, params = []) => new Promise((resolve, reject) => connection.run(sql, params, function(e) { e ? reject(e) : resolve(this.changes); }));
  let queue = Promise.resolve();
  return { remove(values) {
    const task = queue.then(async () => {
      assertDeleteAllowed();
      if (!Array.isArray(values) || !values.length || values.length > 10000 || values.some(id => !Number.isSafeInteger(id) || id <= 0)) throw Error('Chọn từ 1 đến 10.000 số hợp lệ để xóa');
      const ids = [...new Set(values)];
      await run('BEGIN IMMEDIATE');
      let deleted = 0;
      try {
        for (let start = 0; start < ids.length; start += 200) {
          const chunk = ids.slice(start, start + 200), placeholders = chunk.map(() => '?').join(',');
          const rows = await all('SELECT id FROM numbers WHERE id IN (' + placeholders + ')', chunk);
          if (rows.length) deleted += await run('DELETE FROM numbers WHERE id IN (' + placeholders + ')', chunk);
        }
        await run('COMMIT');
      } catch (error) { await run('ROLLBACK').catch(() => {}); throw error; }
      try { notify(); } catch (_) { /* A committed deletion remains successful. */ }
      return { success: true, deleted, missing: ids.length - deleted };
    });
    queue = task.catch(() => {});
    return task;
  } };
}
module.exports = { createNumberDelete };
