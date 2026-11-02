/* Preview instances can inspect their own database without controlling telephony infrastructure. */
function createRuntimeMode(env = process.env) {
  const readOnly = env.PREVIEW_READ_ONLY === '1';
  function assertWritable() {
    if (readOnly) throw new Error('Bản thử chỉ đọc: không đổi số hoặc ghi xuống hạ tầng.');
  }
  function middleware(req, res, next) {
    const read = ['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    const session = req.method === 'POST' && ['/api/login', '/api/logout'].includes(req.path);
    if (readOnly && !read && !session) return res.status(403).json({ error: 'Bản thử chỉ đọc: thao tác thay đổi đã được tắt.' });
    next();
  }
  return Object.freeze({ readOnly, assertWritable, middleware });
}
module.exports = { createRuntimeMode };
