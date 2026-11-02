const esl = require('modesl');
const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

// Khai báo biến đếm lỗi toàn cục để không bị crash
const failCounters = {};


// 1. CẤU HÌNH HỆ THỐNG
const GOOGLE_WEBAPP_URL = "https://script.google.com/macros/s/AKfycbzPe_fnORVztfBmiNL3l8mD8hpx6Md8onIbmUTC-iuugbFEBuSP0I_Y0TnOzAxg0Oin/exec";
// const TELEGRAM_BOT_TOKEN = "REDACTED_PRIVATE_BACKUP_ONLY";
// const TELEGRAM_CHAT_ID = "-5572124414";


// ==========================================
// CẤU HÌNH TELEGRAM BOT
// ==========================================
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || 'REDACTED_PRIVATE_BACKUP_ONLY';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '-5572124414';

/**
 * Hàm gửi tin nhắn chung sang Telegram
 */
async function sendTelegramAlert(message) {
  if (!TELEGRAM_BOT_TOKEN || TELEGRAM_BOT_TOKEN.includes('REDACTED_PRIVATE_BACKUP_ONLY')) {
    console.log('[TELEGRAM] Bỏ qua gửi tin nhắn do chưa cấu hình BOT_TOKEN');
    return;
  }

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  try {
    await axios.post(url, {
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: 'HTML'
    });
    console.log('[TELEGRAM] Gửi thông báo thành công!');
  } catch (err) {
    console.error('[TELEGRAM ERROR] Không thể gửi tin nhắn:', err.message);
  }
}

/**
 * Báo động khẩn cấp khi hết số BACKUP
 */
async function sendTelegramUrgent(nodeName, blockedPhone) {
  const msg = 
`🚨 <b>[URGENT ALERT - HẾT SỐ BACKUP]</b>
➖➖➖➖➖➖➖➖➖➖
🏢 <b>Node:</b> <code>${nodeName || 'N/A'}</code>
🚫 <b>Số vừa bị khóa:</b> <code>${blockedPhone}</code>
⚠️ <b>Cảnh báo:</b> Không tìm thấy số BACKUP khả dụng để thay thế! Vui lòng bổ sung quỹ số khẩn cấp.
⏰ <b>Thời gian:</b> <code>${new Date().toLocaleString('vi-VN')}</code>`;

  await sendTelegramAlert(msg);
}


// ==========================================
// 3. LOGIC BÓC SỐ MỚI VÀ ĐỒNG BỘ (AUTO SWAP)
// ==========================================
async function triggerAutoSwap(blockedPhone, nodeName, cause) {
  console.log(`[ACTION] Executing Auto Swap for ${blockedPhone} on ${nodeName}...`);

  // TODO: Query lấy số BACKUP khả dụng từ Postgres/Redis local
  const newBackupPhone = "0968293765"; // Giả lập số mới bóc được từ DB

  if (newBackupPhone === "11111111111" || !newBackupPhone) {
    await sendTelegramUrgent(nodeName, blockedPhone);
    return;
  }

  // A. Bắn Webhook đồng bộ ngược lên Google Apps Script
  try {
    await axios.post(GOOGLE_WEBAPP_URL, {
      event: 'AUTO_SWAP',
      node: nodeName,
      oldPhone: blockedPhone,
      newPhone: newBackupPhone,
      profile: 'TELESALES',
      reason: `AUTO_BLOCKED (${cause})`
    });
    console.log("[Sync Google Sheet] Thành công!");
  } catch (err) {
    console.error("[Sync Error] Failed to update Google Sheet:", err.message);
  }

  // B. Bắn thông báo Telegram cho Auto Swap
  const autoMsg = 
`🤖 <b>[AUTO SWAP ALERT]</b>
➖➖➖➖➖➖➖➖➖➖
🏢 <b>Node:</b> <code>${nodeName || 'N/A'}</code>
🚫 <b>Số bị khóa (BLOCKED):</b> <code>${blockedPhone}</code>
✅ <b>Số mới kích hoạt (ACTIVE):</b> <code>${newBackupPhone}</code>
⚠️ <b>Lý do:</b> <code>AUTO_BLOCKED (${cause})</code>
⏰ <b>Thời gian:</b> <code>${new Date().toLocaleString('vi-VN')}</code>`;

  await sendTelegramAlert(autoMsg);
}


// ==========================================
// 4. API NHẬN LỆNH ĐỔI BẰNG TAY TỪ GOOGLE SHEET
// ==========================================
app.post('/api/manual-swap', async (req, res) => {
  console.log('[MANUAL SWAP RECEIVED]', req.body);

  const { phone, newPhone, node, operator } = req.body;
  if (!phone) {
    return res.status(400).json({ status: 'error', message: 'Thiếu SĐT bị khóa' });
  }

  const activePhone = newPhone || "0909999888";

  // Reset bộ đếm lỗi an toàn
  failCounters[phone] = 0;

  // Gửi thông báo Telegram cho Manual Swap
  const manualMsg = 
`🛠 <b>[MANUAL SWAP ALERT]</b>
➖➖➖➖➖➖➖➖➖➖
🏢 <b>Node:</b> <code>${node || 'N/A'}</code>
🚫 <b>Số bị khóa (BLOCKED):</b> <code>${phone}</code>
✅ <b>Số mới kích hoạt (ACTIVE):</b> <code>${activePhone}</code>
👤 <b>Người thực hiện:</b> <code>${operator || 'Unknown'}</code>
⏰ <b>Thời gian:</b> <code>${new Date().toLocaleString('vi-VN')}</code>`;

  // Chờ gửi Telegram để bắt log lỗi trực tiếp trên terminal
  try {
    await sendTelegramAlert(manualMsg);
  } catch (err) {
    console.error("[TELEGRAM ERROR]:", err.message);
  }

  return res.json({
    status: 'success',
    oldPhone: phone,
    newPhone: activePhone
  });
});




// ROUTE TEST GIẢ LẬP BẮN DỮ LIỆU SANG GOOGLE SHEET
app.get('/test-auto-swap', async (req, res) => {
  try {
    await triggerAutoSwap('0968291275', 'FS-TEST', 'TEST_BLOCKED_CAUSE');
    res.json({ status: 'success', message: 'Đã bắn thử dữ liệu sang Google Sheet!' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});
app.listen(5000, () => console.log('App Engine running on port 5000'));
