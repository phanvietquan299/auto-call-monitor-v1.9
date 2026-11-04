/* Preview instances can inspect their own database without controlling telephony infrastructure. */
function createRuntimeMode(env = process.env) {
  const readOnly = env.PREVIEW_READ_ONLY === '1';
  const importAllowed = !readOnly || env.PREVIEW_ALLOW_IMPORT === '1' && !!env.DB_PATH;
  const deleteAllowed = !readOnly || env.PREVIEW_ALLOW_DELETE === '1' && !!env.DB_PATH;
  function assertDeleteAllowed() { if (!deleteAllowed) throw new Error('Bản thử chưa được bật xóa trong database riêng.'); }
  function assertImportAllowed() {
    if (!importAllowed) throw new Error('Bản thử chưa được bật nạp Excel vào database riêng.');
  }
  function assertWritable() {
    if (readOnly) throw new Error('Bản thử chỉ đọc: không đổi số hoặc ghi xuống hạ tầng.');
  }
  function middleware(req, res, next) {
    const read = ['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    const session = req.method === 'POST' && ['/api/login', '/api/logout'].includes(req.path);
    const preview = req.method === 'POST' && req.path === '/api/numbers/import/preview';
    const commit = req.method === 'POST' && req.path === '/api/numbers/import/execute' && importAllowed;
    const deletion = req.method === 'POST' && ['/api/numbers/delete-selected'].includes(req.path) && deleteAllowed;
    const monitorSelection = readOnly && req.method === 'POST' && ['/api/monitor/nodes','/api/monitor/number-status','/api/monitor/control'].includes(req.path);
    if (readOnly && !monitorSelection && !read && !session && !preview && !commit && !deletion) return res.status(403).json({ error: 'Bản thử chỉ đọc: thao tác thay đổi đã được tắt.' });
    next();
  }
  return Object.freeze({ readOnly, importAllowed, deleteAllowed, assertWritable, assertImportAllowed, assertDeleteAllowed, middleware });
}
module.exports = { createRuntimeMode };
