const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const multer = require('multer');
const xlsx = require('xlsx');
const net = require('net');
const fs = require('fs');
const { Client } = require('ssh2');
const session = require('express-session');
const axios = require('axios');
const { exec } = require('child_process'); // THƯ VIỆN ĐỂ CHẠY LỆNH REDIS-CLI

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.set('etag', false);
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// CẤU HÌNH TELEGRAM BOT
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// CACHE SSH PRIVATE KEY (Tránh đọc disk lặp lại ở mỗi lần swap)
const SSH_KEY_PATH = process.env.SSH_KEY_PATH || '/root/.ssh/id_rsa';
let cachedSshKey = null;
try {
  if (fs.existsSync(SSH_KEY_PATH)) {
    cachedSshKey = fs.readFileSync(SSH_KEY_PATH);
  }
} catch (e) {
  console.warn(`[SSH INIT] Không thể đọc SSH key từ ${SSH_KEY_PATH}:`, e.message);
}

// QUẢN LÝ TÀI KHOẢN (MẶC ĐỊNH ADMIN / 123456)
let ADMIN_USER = process.env.ADMIN_USER;
let ADMIN_PASS = process.env.ADMIN_PASS;

function requireAuth(req, res, next) {
  if (req.session && req.session.loggedIn) {
    return next();
  }
  return res.status(401).json({ error: 'Chưa đăng nhập!' });
}

app.use(express.static(path.join(__dirname, 'public')));

// BẢNG CẤU HÌNH IN-MEMORY (ĐƯỢC NẠP TỪ DATABASE SQLITE KHI BOOT)
let AUTO_SWAP_CONFIG_MAP = {
  DEFAULT: {
    maxErrors: 40,
    timeWindowSec: 15,
    sipCodes: ['480'],
    maxSetupTimeSec: 0.5
  }
};

function getConfigForNode(nodeId) {
  return AUTO_SWAP_CONFIG_MAP[nodeId] || AUTO_SWAP_CONFIG_MAP.DEFAULT;
}

// Mảng lưu vết mốc thời gian lỗi trong RAM theo từng Node
const nodeErrorTimestamps = {};
const isSwappingNode = {}; // Cờ khóa chống trùng lặp swap đồng thời

const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 5003;

const db = new sqlite3.Database(path.join(__dirname, 'automation_dev.db'));

// Promise hoá SQLite Helper
const dbGet = (sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
});
const dbAll = (sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
});
const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function(err) {
    if (err) return reject(err);
    resolve(this);
  });
});

const eslSockets = {};
const nodeHealthStatus = {};

// KHỞI TẠO BẢNG VÀ NẠP CẤU HÌNH AUTO SWAP TỪ DATABASE
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS nodes (
    id TEXT PRIMARY KEY, host TEXT, port INTEGER, password TEXT, status TEXT DEFAULT 'FULL_ONLINE', type TEXT DEFAULT 'FS'
  )`);

  db.run(`ALTER TABLE nodes ADD COLUMN profile TEXT DEFAULT 'COLLECTION'`, () => {});
  db.run(`ALTER TABLE nodes ADD COLUMN type TEXT DEFAULT 'FS'`, () => {});

  db.run(`CREATE TABLE IF NOT EXISTS numbers (
    id INTEGER PRIMARY KEY AUTOINCREMENT, phone TEXT UNIQUE, node_id TEXT, profile TEXT, status TEXT DEFAULT 'BACKUP'
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS swap_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, node_id TEXT, old_phone TEXT, new_phone TEXT, swap_type TEXT, operator TEXT, created_at DATETIME DEFAULT (datetime('now', '+7 hours'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS node_configs (
    node_id TEXT PRIMARY KEY,
    max_errors INTEGER DEFAULT 40,
    time_window_sec INTEGER DEFAULT 15,
    max_setup_time_sec REAL DEFAULT 0.5,
    sip_codes TEXT DEFAULT '["480"]',
    updated_at DATETIME DEFAULT (datetime('now', '+7 hours'))
  )`);

  db.get("SELECT COUNT(*) as count FROM node_configs", [], (err, row) => {
    if (!err && row && row.count === 0) {
      const initialConfigs = [
        ['DEFAULT', 40, 15, 0.5, JSON.stringify(['480'])],
        ['FS01', 50, 15, 0.5, JSON.stringify(['480'])],
        ['FS02', 40, 10, 1.0, JSON.stringify(['480', '503'])],
        ['FS09', 20, 10, 1.0, JSON.stringify(['480', '503'])],
        ['FS10', 20, 10, 1.0, JSON.stringify(['480', '503'])]
      ];
      const stmt = db.prepare('INSERT OR REPLACE INTO node_configs (node_id, max_errors, time_window_sec, max_setup_time_sec, sip_codes) VALUES (?, ?, ?, ?, ?)');
      initialConfigs.forEach(c => stmt.run(c[0], c[1], c[2], c[3], c[4]));
      stmt.finalize(() => {
        loadConfigsFromDatabase();
      });
    } else {
      loadConfigsFromDatabase();
    }
  });

  const defaultNodes = [
    ['FS01', '10.10.101.176', 8021, 'ClueCon', 'COLLECTION', 'FS'],
    ['FS02', '10.10.101.170', 8021, 'ClueCon', 'COLLECTION', 'FS'],
    ['FS03', '10.10.101.184', 8021, 'ClueCon', 'COLLECTION', 'FS'],
    ['FS04', '10.10.101.180', 8021, 'ClueCon', 'COLLECTION', 'FS'],
    ['FS05', '10.10.101.58', 8021, 'ClueCon', 'TELESALE', 'FS'],
    ['FS06', '10.10.101.87', 8021, 'ClueCon', 'TELESALE', 'FS'],
    ['FS07', '10.10.101.88', 8021, 'ClueCon', 'TELESALE', 'FS'],
    ['FS08', '10.10.101.171', 8021, 'ClueCon', 'CS + UW', 'FS'],
    ['FS09', '10.10.101.89', 8021, 'ClueCon', 'TELESALE', 'FS'],
    ['FS10', '10.10.101.90', 8021, 'ClueCon', 'TELESALE', 'FS']
  ];

  const stmt = db.prepare('INSERT OR IGNORE INTO nodes (id, host, port, password, profile, status, type) VALUES (?, ?, ?, ?, ?, "FULL_ONLINE", ?)');
  defaultNodes.forEach(n => stmt.run(n[0], n[1], n[2], n[3], n[4], n[5]));
  stmt.finalize();
});

function loadConfigsFromDatabase() {
  db.all('SELECT * FROM node_configs', [], (err, rows) => {
    if (err || !rows) return;
    rows.forEach(r => {
      let codes = ['480'];
      try { codes = JSON.parse(r.sip_codes); } catch (e) {}
      AUTO_SWAP_CONFIG_MAP[r.node_id] = {
        maxErrors: r.max_errors,
        timeWindowSec: r.time_window_sec,
        maxSetupTimeSec: r.max_setup_time_sec,
        sipCodes: codes
      };
    });
    console.log('[CONFIG] Đã nạp thành công cấu hình Auto-Swap từ SQLite vào RAM.');
  });
}

setTimeout(() => {
  console.log('[DB] Starting Dynamic Engine...');
  initESLMonitors();
}, 1000);

function checkOpenSipsHealth(node) {
  const url = `http://${node.host}:${node.port || 8888}/metrics/`;
  axios.get(url, {
    timeout: 3000,
    headers: { 'Accept': 'text/plain, */*' },
    validateStatus: () => true
  })
  .then(() => {
    if (nodeHealthStatus[node.id] !== 'UP') {
      nodeHealthStatus[node.id] = 'UP';
      io.emit('node_health_updated', { nodeId: node.id, health: 'UP' });
    }
  })
  .catch(() => {
    if (nodeHealthStatus[node.id] !== 'DOWN') {
      nodeHealthStatus[node.id] = 'DOWN';
      io.emit('node_health_updated', { nodeId: node.id, health: 'DOWN' });
    }
  });
}

function initESLMonitors() {
  db.all('SELECT * FROM nodes', [], (err, rows) => {
    if (err || !rows) return;
    rows.forEach(node => {
      if (node.type === 'OPENSIPS') {
        checkOpenSipsHealth(node);
        setInterval(() => checkOpenSipsHealth(node), 10000); 
      } else {
        connectToNodeESL(node);
      }
    });
  });
}

function connectToNodeESL(node) {
  if (eslSockets[node.id]) {
    try {
      eslSockets[node.id].removeAllListeners();
      eslSockets[node.id].destroy();
    } catch (e) {}
    delete eslSockets[node.id];
  }

  nodeHealthStatus[node.id] = 'CONNECTING';
  const client = new net.Socket();
  let buffer = '';

  client.connect(node.port, node.host, () => {});

  client.on('data', (data) => {
    buffer += data.toString();

    if (buffer.includes('auth/request')) {
      client.write(`auth ${node.password || 'ClueCon'}\n\n`);
      buffer = '';
      return;
    }

    if (buffer.includes('+OK accepted')) {
      if (nodeHealthStatus[node.id] !== 'UP') {
        nodeHealthStatus[node.id] = 'UP';
        io.emit('node_health_updated', { nodeId: node.id, health: 'UP' });
      }
      client.write("event plain CHANNEL_HANGUP_COMPLETE\n\n");
      buffer = '';
      return;
    }

    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop() || '';

    for (const rawEvent of events) {
      if (rawEvent.includes('CHANNEL_HANGUP_COMPLETE')) {
        processHangupEvent(node.id, rawEvent);
      }
    }
  });

  const handleDisconnect = () => {
    if (nodeHealthStatus[node.id] !== 'DOWN') {
      nodeHealthStatus[node.id] = 'DOWN';
      io.emit('node_health_updated', { nodeId: node.id, health: 'DOWN' });
    }
    client.removeAllListeners();
    delete eslSockets[node.id];

    setTimeout(() => {
      db.get('SELECT id FROM nodes WHERE id = ?', [node.id], (err, row) => {
        if (row && row.type !== 'OPENSIPS') connectToNodeESL(row);
      });
    }, 10000);
  };

  client.on('error', handleDisconnect);
  client.on('close', handleDisconnect);

  eslSockets[node.id] = client;
}

// ==========================================
// HÀM LÕI ĐẾM LỖI & KÍCH HOẠT AUTO SWAP (DÙNG CHUNG)
// ==========================================
function processErrorMetrics(nodeId, callerNumber, destinationNumber, cleanSipCode, setupTimeSec) {
  const config = getConfigForNode(nodeId);
  const isBlockedSipCode = config.sipCodes.some(code => cleanSipCode.includes(code));
  const isImmediateFail = setupTimeSec <= config.maxSetupTimeSec;

  if (isBlockedSipCode && isImmediateFail && callerNumber) {
    const now = Date.now();

    io.emit('new_sip_error', {
      node_id: nodeId,
      phone: callerNumber,
      destination: destinationNumber,
      sip_code: cleanSipCode,
      setup_time: setupTimeSec,
      created_at: new Date().toISOString()
    });

    if (isSwappingNode[nodeId]) return;

    if (!nodeErrorTimestamps[nodeId]) {
      nodeErrorTimestamps[nodeId] = [];
    }

    nodeErrorTimestamps[nodeId].push(now);

    const windowMs = config.timeWindowSec * 1000;
    nodeErrorTimestamps[nodeId] = nodeErrorTimestamps[nodeId].filter(ts => (now - ts) <= windowMs);

    const currentErrorCount = nodeErrorTimestamps[nodeId].length;
    
    const logTime = new Date().toLocaleTimeString('vi-VN', { hour12: false });
    console.log(`[${logTime}] [METRICS] Node ${nodeId}: ${currentErrorCount}/${config.maxErrors} lỗi (mã ${cleanSipCode}, setup ${setupTimeSec}s) trong ${config.timeWindowSec}s`);

    if (currentErrorCount >= config.maxErrors) {
      console.log(`🚨 [AUTO SWAP TRIGGERED] Node ${nodeId} đạt ${currentErrorCount}/${config.maxErrors} lỗi trong ${config.timeWindowSec}s!`);

      isSwappingNode[nodeId] = true;
      nodeErrorTimestamps[nodeId] = [];

      const reason = `Auto Swap: Phát hiện ${currentErrorCount} cuộc gọi lỗi SIP trong ${config.timeWindowSec}s`;

      executeSwapOperation({
        nodeId,
        phone: callerNumber,
        type: 'AUTO',
        operator: 'SlidingWindow_Engine',
        reason
      }).catch(err => {
        console.error(`[AUTO SWAP FAILED] Lỗi khi swap Node ${nodeId}:`, err.message);
      }).finally(() => {
        setTimeout(() => {
          isSwappingNode[nodeId] = false;
        }, 15000);
      });
    }
  }
}

function processHangupEvent(nodeId, eventRawText) {
  const callerNumber = getHeaderValue(eventRawText, 'variable_effective_caller_id_number') || 
                       getHeaderValue(eventRawText, 'variable_effective_caller_id_name') || 
                       getHeaderValue(eventRawText, 'Caller-Caller-ID-Number');

  const destinationNumber = getHeaderValue(eventRawText, 'Caller-Destination-Number');
  
  const rawSipCode = getHeaderValue(eventRawText, 'variable_proto_specific_hangup_cause') || 
                     getHeaderValue(eventRawText, 'variable_sip_user_agent_response_code') ||
                     getHeaderValue(eventRawText, 'variable_last_bridge_hangup_cause') || '';

  let sipCode = '';
  if (rawSipCode) {
    try { sipCode = decodeURIComponent(rawSipCode); } catch (e) { sipCode = rawSipCode; }
  }

  const matched = sipCode.match(/\b\d{3}\b/);
  const cleanSipCode = matched ? matched[0] : (sipCode || 'N/A');

  const startUEpoch = parseFloat(getHeaderValue(eventRawText, 'variable_start_uepoch') || 0);
  const progressUEpoch = parseFloat(getHeaderValue(eventRawText, 'variable_progress_media_uepoch') || getHeaderValue(eventRawText, 'variable_progress_uepoch') || 0);
  const endUEpoch = parseFloat(getHeaderValue(eventRawText, 'variable_end_uepoch') || 0);
  
  let setupTimeSec = 0;
  if (startUEpoch > 0) {
    const endPoint = progressUEpoch > 0 ? progressUEpoch : (endUEpoch > 0 ? endUEpoch : startUEpoch);
    setupTimeSec = parseFloat(((endPoint - startUEpoch) / 1000000).toFixed(2));
    if (setupTimeSec < 0) setupTimeSec = 0;
  }

  // Chuyển dữ liệu vào bộ đếm chung
  processErrorMetrics(nodeId, callerNumber, destinationNumber, cleanSipCode, setupTimeSec);
}

function getHeaderValue(rawText, headerName) {
  if (!rawText) return null;
  const match = rawText.match(new RegExp(`^${headerName}:\\s*(.*)$`, 'im'));
  return match ? match[1].trim() : null;
}

async function executeSwapOperation({ nodeId, phone, type = 'MANUAL', operator = 'System', reason = '' }) {
  const node = await dbGet('SELECT * FROM nodes WHERE id = ?', [nodeId]);
  if (!node) throw new Error(`Không tìm thấy node: ${nodeId}`);
  if (node.status === 'DISABLED') throw new Error(`Node ${nodeId} đang bị DISABLED.`);
  if (type === 'AUTO' && node.status === 'MANUAL_ONLY') throw new Error(`Node ${nodeId} đang ở chế độ MANUAL_ONLY.`);

  await dbRun('BEGIN IMMEDIATE TRANSACTION');
  try {
    const backupNum = await dbGet(
      'SELECT * FROM numbers WHERE node_id = ? AND status = "BACKUP" ORDER BY id ASC LIMIT 1',
      [nodeId]
    );

    if (!backupNum) {
      await dbRun('ROLLBACK');
      throw new Error(`Không còn số BACKUP khả dụng trên Node ${nodeId}!`);
    }

    const newPhone = backupNum.phone;

    if (phone) {
      await dbRun('UPDATE numbers SET status = "BLOCKED" WHERE phone = ?', [phone]);
    }
    await dbRun('UPDATE numbers SET status = "ACTIVE" WHERE phone = ?', [newPhone]);

    await dbRun(
      "INSERT INTO swap_logs (node_id, old_phone, new_phone, swap_type, operator, created_at) VALUES (?, ?, ?, ?, ?, datetime('now', '+7 hours'))",
      [nodeId, phone || 'UNKNOWN', newPhone, type, operator]
    );

    await dbRun('COMMIT');
    
    // --- THỰC THI GÁN SỐ XUỐNG HẠ TẦNG ---
    if (node.type === 'OPENSIPS') {
      const cmd = `redis-cli -h ${node.host} -p 6379 SET callerid "${newPhone}"`;
      
      exec(cmd, (error, stdout, stderr) => {
        if (error) {
          console.error(`[REDIS ERROR] Không thể cập nhật số cho Node ${nodeId}:`, error.message);
        } else {
          console.log(`[REDIS SUCCESS] -> Đã cập nhật số ${newPhone} cho Node ${nodeId} (${node.host}). Phản hồi: ${stdout.trim()}`);
        }
      });
    } else {
      updateLuaFileViaSSH(nodeId, newPhone);
    }
    // ------------------------------------
	
    sendSwapAlertTelegram({
      nodeId,
      oldPhone: phone,
      newPhone,
      operator,
      swapType: type
    });

    io.emit('number_swapped', { nodeId, oldPhone: phone, newPhone });
    return { success: true, oldPhone: phone, newPhone };
  } catch (err) {
    try { await dbRun('ROLLBACK'); } catch (rbErr) {}
    throw err;
  }
}

// ==========================================
// CÁC API QUẢN LÝ CẤU HÌNH NGƯỠNG AUTO-SWAP
// ==========================================
app.get('/api/config/auto-swap', requireAuth, (req, res) => {
  res.json(AUTO_SWAP_CONFIG_MAP);
});

app.get('/api/config/auto-swap/:nodeId', requireAuth, (req, res) => {
  const nodeId = req.params.nodeId.toUpperCase();
  const config = AUTO_SWAP_CONFIG_MAP[nodeId] || AUTO_SWAP_CONFIG_MAP.DEFAULT;
  res.json({ nodeId, config, isDefault: !AUTO_SWAP_CONFIG_MAP[nodeId] });
});

app.post('/api/config/auto-swap', requireAuth, async (req, res) => {
  const { nodeId, maxErrors, timeWindowSec, sipCodes, maxSetupTimeSec } = req.body;
  const targetKey = nodeId ? nodeId.toUpperCase() : 'DEFAULT';

  const baseConfig = AUTO_SWAP_CONFIG_MAP[targetKey] || AUTO_SWAP_CONFIG_MAP.DEFAULT;
  const newMaxErrors = maxErrors ? parseInt(maxErrors, 10) : baseConfig.maxErrors;
  const newTimeWindowSec = timeWindowSec ? parseInt(timeWindowSec, 10) : baseConfig.timeWindowSec;
  const newMaxSetupTimeSec = maxSetupTimeSec !== undefined ? parseFloat(maxSetupTimeSec) : baseConfig.maxSetupTimeSec;
  const newSipCodes = Array.isArray(sipCodes) ? sipCodes : baseConfig.sipCodes;

  AUTO_SWAP_CONFIG_MAP[targetKey] = {
    maxErrors: newMaxErrors,
    timeWindowSec: newTimeWindowSec,
    sipCodes: newSipCodes,
    maxSetupTimeSec: newMaxSetupTimeSec
  };

  try {
    await dbRun(
      `INSERT INTO node_configs (node_id, max_errors, time_window_sec, max_setup_time_sec, sip_codes, updated_at) 
       VALUES (?, ?, ?, ?, ?, datetime('now', '+7 hours'))
       ON CONFLICT(node_id) DO UPDATE SET 
         max_errors = excluded.max_errors,
         time_window_sec = excluded.time_window_sec,
         max_setup_time_sec = excluded.max_setup_time_sec,
         sip_codes = excluded.sip_codes,
         updated_at = excluded.updated_at`,
      [targetKey, newMaxErrors, newTimeWindowSec, newMaxSetupTimeSec, JSON.stringify(newSipCodes)]
    );

    io.emit('node_config_updated', { nodeId: targetKey, config: AUTO_SWAP_CONFIG_MAP[targetKey] });

    res.json({
      success: true,
      message: `Đã lưu cấu hình ngưỡng cho Node ${targetKey} thành công!`,
      config: AUTO_SWAP_CONFIG_MAP[targetKey]
    });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi lưu cấu hình vào database: ' + err.message });
  }
});

function updateLuaFileViaSSH(nodeId, activePhone) {
  db.get('SELECT host FROM nodes WHERE id = ?', [nodeId], (err, node) => {
    if (err || !node) return console.error(`[SSH ERROR] Không tìm thấy IP của Node ${nodeId}`);

    const sshHost = node.host;
    const remotePath = `/usr/share/freeswitch/scripts/rand_caller_id-vtel-vbn-vtel.lua`;

    const luaContent = `-- File tu dong cap nhat tu Web App Automation\n` +
      `number = "${activePhone}"\n\n` + 
      `session:setVariable("effective_caller_id_name", number)\n` + 
      `session:consoleLog("info", "Set effective_caller_id_name " .. number .. "\\n")\n\n` + 
      `session:setVariable("effective_caller_id_number", number)\n` + 
      `session:consoleLog("info", "Set effective_caller_id_number " .. number .. "\\n")\n`;

    if (!cachedSshKey) {
      console.error(`[SSH ERROR] SSH private key chưa sẵn sàng!`);
      return;
    }

    const conn = new Client();
    conn.on('ready', () => {
      const cmd = `cat << 'EOF' > ${remotePath}\n${luaContent}EOF\n`;
      conn.exec(cmd, (err, stream) => {
        if (err) {
          console.error(`[SSH ERROR] Lỗi thực thi trên Node ${nodeId}:`, err.message);
          return conn.end();
        }
        stream.on('close', () => {
          console.log(`[SSH SUCCESS] -> Đã cập nhật số ${activePhone} trên Node ${nodeId} (${sshHost})`);
          conn.end();
        }).on('data', () => {}).stderr.on('data', () => {});
      });
    }).on('error', (err) => {
      console.error(`[SSH CONNECT ERROR] Không thể SSH tới Node ${nodeId} (${sshHost}):`, err.message);
    }).connect({
      host: sshHost,
      port: 22,
      username: 'root',
      privateKey: cachedSshKey,
      readyTimeout: 7000
    });
  });
}

function checkAndSendLowBackupAlert(nodeId) {
  if (!TELEGRAM_BOT_TOKEN || TELEGRAM_BOT_TOKEN.includes('YOUR_TELEGRAM_BOT')) return;

  db.all('SELECT status FROM numbers WHERE node_id = ?', [nodeId], async (err, rows) => {
    if (err || !rows) return;

    const total = rows.length;
    const backupCount = rows.filter(r => r.status === 'BACKUP').length;
    const backupRatio = total > 0 ? parseFloat(((backupCount / total) * 100).toFixed(1)) : 0;

    if (backupRatio < 20.0) {
      const alertMsg = `🚨 CẢNH BÁO KHO SỐ BACKUP (FS NODE: ${nodeId}) 🚨\n\n` +
        `• Tỷ lệ Backup còn lại: ${backupRatio}% (Dưới ngưỡng 20%)\n` +
        `• Số Backup khả dụng: ${backupCount} / ${total}\n` +
        `👉 Hành động: Vui lòng nạp bổ sung đầu số Backup vào ngay!`;

      try {
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
          chat_id: TELEGRAM_CHAT_ID,
          text: alertMsg
        });
      } catch (e) {
        console.error('[TELEGRAM ERROR] Lỗi gửi cảnh báo kho số:', e.message);
      }
    }
  });
}

async function sendSwapAlertTelegram({ nodeId, oldPhone, newPhone, operator, swapType }) {
  if (!TELEGRAM_BOT_TOKEN || TELEGRAM_BOT_TOKEN.includes('YOUR_TELEGRAM_BOT')) return;

  db.all('SELECT status FROM numbers WHERE node_id = ?', [nodeId], async (err, rows) => {
    if (err || !rows) return;

    const total = rows.length;
    const backupCount = rows.filter(r => r.status === 'BACKUP').length;
    const backupRatio = total > 0 ? ((backupCount / total) * 100).toFixed(1) : 0;

    const now = new Date();
    const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')} ${now.getDate()}/${now.getMonth() + 1}/${now.getFullYear()}`;

    const tagType = swapType === 'AUTO' ? 'AUTO SWAP ALERT' : 'MANUAL SWAP ALERT';

    let message = `🛠 [${tagType}]\n` +
      `➖➖➖➖➖➖➖➖➖➖\n` +
      `🏢 Node: ${nodeId}\n` +
      `🚫 Số bị khóa (BLOCKED): ${oldPhone || 'N/A'}\n` +
      `✅ Số mới kích hoạt (ACTIVE): ${newPhone}\n` +
      `👤 Người thực hiện: ${operator || 'System'}\n` +
      `⏰ Thời gian: ${timeStr}`;

    if (parseFloat(backupRatio) < 20.0) {
      message += `\n\n🚨 CẢNH BÁO KHO SỐ BACKUP (FS NODE: ${nodeId}) 🚨\n\n` +
        `• Tỷ lệ Backup còn lại: ${backupRatio}% (Dưới ngưỡng 20%)\n` +
        `• Số Backup khả dụng: ${backupCount} / ${total}\n` +
        `👉 Hành động: Vui lòng nạp bổ sung đầu số Backup vào ngay!`;
    }

    try {
      await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        chat_id: TELEGRAM_CHAT_ID,
        text: message
      });
    } catch (e) {
      console.error('[TELEGRAM ERROR] Lỗi gửi tin nhắn Telegram:', e.message);
    }
  });
}

// API AUTHENTICATION
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    req.session.loggedIn = true;
    req.session.user = username;
    return res.json({ success: true });
  }
  return res.status(401).json({ error: 'Tên đăng nhập hoặc mật khẩu không đúng!' });
});

app.post('/api/change-password', requireAuth, (req, res) => {
  const { oldPassword, newPassword } = req.body;
  if (oldPassword !== ADMIN_PASS) {
    return res.status(400).json({ error: 'Mật khẩu cũ không chính xác!' });
  }
  ADMIN_PASS = newPassword;
  res.json({ success: true });
});

app.get('/api/check-auth', (req, res) => {
  if (req.session && req.session.loggedIn) {
    return res.json({ loggedIn: true, user: req.session.user });
  }
  return res.json({ loggedIn: false });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// ENDPOINT NHẬN KẾT QUẢ BÁO LỖI TỪ OPENSIPS VÀ ĐƯA VÀO BỘ ĐẾM AUTO-SWAP
app.post('/api/webhook/sip-error', (req, res) => {
  const { nodeId, phone, destination, sipCode, setupTime } = req.body;
  const logTime = new Date().toLocaleTimeString('vi-VN', { hour12: false });

  console.log(`[${logTime}] 📥 [OPENSIPS EVENT] Node: ${nodeId} | Phone: ${phone} -> ${destination} | SIP: ${sipCode} | Setup: ${setupTime}s`);

  // Đẩy thẳng vào bộ đếm Auto-Swap của hệ thống
  processErrorMetrics(nodeId, phone, destination, sipCode || '480', setupTime || 0.1);

  res.json({ status: 'SUCCESS', received: true });
});

// CÁC API DỮ LIỆU
app.get('/api/nodes', requireAuth, (req, res) => {
  const query = `
    SELECT n.*, 
      COUNT(num.id) as total_num,
      SUM(CASE WHEN num.status = 'ACTIVE' THEN 1 ELSE 0 END) as active_num,
      SUM(CASE WHEN num.status = 'BACKUP' THEN 1 ELSE 0 END) as backup_num,
      SUM(CASE WHEN num.status = 'BLOCKED' THEN 1 ELSE 0 END) as blocked_num
    FROM nodes n
    LEFT JOIN numbers num ON n.id = num.node_id
    GROUP BY n.id
    ORDER BY n.id ASC
  `;

  db.all(query, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const data = rows.map(r => ({
      ...r,
      health: nodeHealthStatus[r.id] || 'DOWN',
      active_num: r.active_num || 0,
      backup_num: r.backup_num || 0,
      blocked_num: r.blocked_num || 0,
      total_num: r.total_num || 0
    }));
    res.json(data);
  });
});

app.post('/api/nodes/add', requireAuth, (req, res) => {
  // 1. Nhận thêm biến 'type' từ Frontend gửi lên
  const { id, host, port, password, profile, type } = req.body;
  if (!id || !host) return res.status(400).json({ error: 'Thiếu thông tin Node!' });

  const nodeType = type || 'FS';
  const nodePort = port || (nodeType === 'OPENSIPS' ? 8888 : 8021);
  const nodePass = password || 'ClueCon';
  const nodeProf = profile || 'COLLECTION';

  // 2. Lưu trường type vào bảng nodes trong SQLite
  db.run(
    'INSERT INTO nodes (id, host, port, password, profile, status, type) VALUES (?, ?, ?, ?, ?, "FULL_ONLINE", ?)',
    [id.toUpperCase(), host, nodePort, nodePass, nodeProf, nodeType],
    function(err) {
      if (err) return res.status(500).json({ error: 'Lỗi thêm Node: ' + err.message });

      const newNode = { 
        id: id.toUpperCase(), 
        host, 
        port: nodePort, 
        password: nodePass, 
        profile: nodeProf, 
        type: nodeType 
      };

      // 3. Phân luồng giám sát: OpenSIPS dùng HTTP check, FreeSWITCH dùng ESL
      if (nodeType === 'OPENSIPS' || nodeType === 'KAMAILIO') {
        checkOpenSipsHealth(newNode);
        setInterval(() => checkOpenSipsHealth(newNode), 10000);
      } else {
        connectToNodeESL(newNode);
      }

      io.emit('node_health_updated');
      res.json({ success: true });
    }
  );
});

app.post('/api/nodes/delete', requireAuth, (req, res) => {
  const { nodeId } = req.body;
  if (!nodeId) return res.status(400).json({ error: 'Thiếu Node ID' });

  if (eslSockets[nodeId]) {
    try {
      eslSockets[nodeId].removeAllListeners();
      eslSockets[nodeId].destroy();
    } catch (e) {}
    delete eslSockets[nodeId];
  }
  delete nodeHealthStatus[nodeId];
  delete nodeErrorTimestamps[nodeId];
  delete isSwappingNode[nodeId];

  db.serialize(() => {
    db.run('DELETE FROM nodes WHERE id = ?', [nodeId]);
    db.run('DELETE FROM numbers WHERE node_id = ?', [nodeId]);
    db.run('DELETE FROM node_configs WHERE node_id = ?', [nodeId]);
  });

  io.emit('node_health_updated');
  io.emit('number_swapped');
  res.json({ success: true });
});

app.post('/api/nodes/update-status', requireAuth, (req, res) => {
  const { nodeId, status } = req.body;
  db.run('UPDATE nodes SET status = ? WHERE id = ?', [status, nodeId], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    io.emit('node_status_changed', { nodeId, status });
    res.json({ success: true });
  });
});

app.get('/api/numbers', requireAuth, (req, res) => {
  const query = `
    SELECT * FROM numbers 
    ORDER BY 
      CASE status 
        WHEN 'ACTIVE' THEN 1 
        WHEN 'BACKUP' THEN 2 
        WHEN 'BLOCKED' THEN 3 
        ELSE 4 
      END ASC,
      node_id ASC,
      id ASC
  `;
  db.all(query, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/numbers/add', requireAuth, (req, res) => {
  const { nodeId, profile, phones } = req.body;
  if (!nodeId || !Array.isArray(phones) || phones.length === 0) return res.status(400).json({ error: 'Dữ liệu không hợp lệ' });

  db.get('SELECT profile FROM nodes WHERE id = ?', [nodeId], (err, node) => {
    const targetProfile = profile || (node ? node.profile : 'COLLECTION');
    const stmt = db.prepare('INSERT OR IGNORE INTO numbers (phone, node_id, profile, status) VALUES (?, ?, ?, "BACKUP")');
    
    phones.forEach(phone => {
      const cleanPhone = phone.trim();
      if (cleanPhone) stmt.run(cleanPhone, nodeId, targetProfile);
    });

    stmt.finalize(() => {
      io.emit('number_swapped');
      checkAndSendLowBackupAlert(nodeId);
      res.json({ success: true });
    });
  });
});

app.post('/api/numbers/upload-excel', requireAuth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Chưa chọn file Excel!' });

  try {
    const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const rows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

    db.all('SELECT id, profile FROM nodes', [], (err, nodesList) => {
      const nodeProfileMap = {};
      if (nodesList) nodesList.forEach(n => nodeProfileMap[n.id] = n.profile);

      const stmt = db.prepare('INSERT OR IGNORE INTO numbers (phone, node_id, profile, status) VALUES (?, ?, ?, "BACKUP")');
      let importedCount = 0;

      rows.forEach(row => {
        const phone = String(row['SĐT'] || row['Phone'] || row['phone'] || row['SDT'] || '').trim();
        const nodeId = String(row['Node'] || row['NODE'] || row['node_id'] || '').trim().toUpperCase();
        let profile = String(row['Profile'] || row['PROFILE'] || row['profile'] || '').trim().toUpperCase();

        if (!profile && nodeId) profile = nodeProfileMap[nodeId] || 'COLLECTION';

        if (phone && nodeId) {
          stmt.run(phone, nodeId, profile);
          importedCount++;
        }
      });

      stmt.finalize(() => {
        io.emit('number_swapped');
        res.json({ success: true, count: importedCount });
      });
    });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi đọc file Excel: ' + err.message });
  }
});

app.post('/api/numbers/delete', requireAuth, (req, res) => {
  const { phone } = req.body;
  db.get('SELECT node_id FROM numbers WHERE phone = ?', [phone], (err, row) => {
    const nodeId = row ? row.node_id : null;
    db.run('DELETE FROM numbers WHERE phone = ?', [phone], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      io.emit('number_swapped');
      if (nodeId) checkAndSendLowBackupAlert(nodeId);
      res.json({ success: true });
    });
  });
});

app.post('/api/numbers/bulk-delete', requireAuth, (req, res) => {
  const { nodeId, status } = req.body;
  let sql = 'DELETE FROM numbers WHERE 1=1';
  const params = [];

  if (nodeId && nodeId !== 'ALL') {
    sql += ' AND node_id = ?';
    params.push(nodeId);
  }
  if (status && status !== 'ALL') {
    sql += ' AND status = ?';
    params.push(status);
  }

  db.run(sql, params, function(err) {
    if (err) return res.status(500).json({ error: err.message });
    io.emit('number_swapped');
    if (nodeId && nodeId !== 'ALL') checkAndSendLowBackupAlert(nodeId);
    res.json({ success: true, deleted: this.changes });
  });
});

// CẬP NHẬT TRẠNG THÁI SỐ (HỖ TRỢ THAO TÁC THỦ CÔNG)
app.post('/api/numbers/update-status', requireAuth, async (req, res) => {
  const { phone, status, operator } = req.body;
  const currentOperator = operator || (req.session && req.session.user) || 'Web_Admin';

  try {
    const currentNum = await dbGet('SELECT * FROM numbers WHERE phone = ?', [phone]);
    if (!currentNum) {
      return res.status(404).json({ error: 'Không tìm thấy số điện thoại!' });
    }

    const nodeId = currentNum.node_id;

    if (currentNum.status === 'ACTIVE' && status === 'BLOCKED') {
      const result = await executeSwapOperation({
        nodeId,
        phone,
        type: 'MANUAL',
        operator: currentOperator
      });
      return res.json(result);
    } else {
      await dbRun('UPDATE numbers SET status = ? WHERE phone = ?', [status, phone]);
      io.emit('number_swapped');
      checkAndSendLowBackupAlert(nodeId);
      return res.json({ success: true });
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// API SWAP SỐ THỦ CÔNG / EXTERNAL WEBHOOK
app.post('/api/swap', async (req, res) => {
  const { nodeId, phone, type, operator, reason } = req.body;
  const currentOperator = operator || (req.session && req.session.user) || 'Admin_Web';

  try {
    const result = await executeSwapOperation({
      nodeId,
      phone,
      type: type || 'MANUAL',
      operator: currentOperator,
      reason
    });
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

// BÁO CÁO THỐNG KÊ
app.get('/api/reports/summary', requireAuth, (req, res) => {
  const nodeReportSql = `
    SELECT 
      n.id as node_id,
      n.profile,
      n.status as node_status,
      COUNT(num.id) as total_numbers,
      SUM(CASE WHEN num.status = 'ACTIVE' THEN 1 ELSE 0 END) as active_count,
      SUM(CASE WHEN num.status = 'BACKUP' THEN 1 ELSE 0 END) as backup_count,
      SUM(CASE WHEN num.status = 'BLOCKED' THEN 1 ELSE 0 END) as blocked_count
    FROM nodes n
    LEFT JOIN numbers num ON n.id = num.node_id
    GROUP BY n.id, n.profile, n.status
    ORDER BY n.id ASC
  `;

  const profileReportSql = `
    SELECT 
      num.profile,
      COUNT(num.id) as total_numbers,
      SUM(CASE WHEN num.status = 'ACTIVE' THEN 1 ELSE 0 END) as active_count,
      SUM(CASE WHEN num.status = 'BACKUP' THEN 1 ELSE 0 END) as backup_count,
      SUM(CASE WHEN num.status = 'BLOCKED' THEN 1 ELSE 0 END) as blocked_count
    FROM numbers num
    GROUP BY num.profile
  `;

  db.all(nodeReportSql, [], (err, nodeRows) => {
    if (err) return res.status(500).json({ error: err.message });

    db.all(profileReportSql, [], (err2, profileRows) => {
      if (err2) return res.status(500).json({ error: err2.message });

      const nodesSummary = (nodeRows || []).map(r => {
        const total = r.total_numbers || 0;
        const backup = r.backup_count || 0;
        const backupRatio = total > 0 ? ((backup / total) * 100).toFixed(1) : "0.0";
        return {
          ...r,
          active_count: r.active_count || 0,
          backup_count: backup,
          blocked_count: r.blocked_count || 0,
          backup_ratio: parseFloat(backupRatio),
          is_low_backup: parseFloat(backupRatio) < 20.0
        };
      });

      const profilesSummary = (profileRows || []).map(p => {
        const total = p.total_numbers || 0;
        const backup = p.backup_count || 0;
        return {
          ...p,
          active_count: p.active_count || 0,
          backup_count: backup,
          blocked_count: p.blocked_count || 0,
          backup_ratio: total > 0 ? parseFloat(((backup / total) * 100).toFixed(1)) : 0.0
        };
      });

      res.json({
        nodes_summary: nodesSummary,
        profiles_summary: profilesSummary
      });
    });
  });
});

// XUẤT EXCEL BÁO CÁO
app.get('/api/reports/export-excel', requireAuth, (req, res) => {
  const { fromDate, toDate } = req.query;

  let logsSql = "SELECT node_id, old_phone, new_phone, swap_type, operator, datetime(created_at) as created_at FROM swap_logs WHERE 1=1";
  const params = [];

  if (fromDate) {
    logsSql += " AND created_at >= ?";
    params.push(fromDate);
  }
  if (toDate) {
    logsSql += " AND created_at <= ?";
    params.push(toDate + ' 23:59:59');
  }
  logsSql += " ORDER BY id DESC";

  db.all(logsSql, params, (err, logsRows) => {
    if (err) return res.status(500).json({ error: err.message });

    db.all("SELECT * FROM numbers ORDER BY node_id, status ASC", [], (err2, numRows) => {
      if (err2) return res.status(500).json({ error: err2.message });

      const wb = xlsx.utils.book_new();

      const logsSheetData = (logsRows || []).map(l => ({
        "Thời Gian": l.created_at,
        "Node ID": l.node_id,
        "Số Bị Khóa (BLOCKED)": l.old_phone,
        "Số Kích Hoạt (ACTIVE)": l.new_phone,
        "Loại Swap": l.swap_type,
        "Người Thực Hiện": l.operator || 'System'
      }));
      const wsLogs = xlsx.utils.json_to_sheet(logsSheetData);
      xlsx.utils.book_append_sheet(wb, wsLogs, "Lịch Sử Đổi Số");

      const numSheetData = (numRows || []).map(n => ({
        "SĐT": n.phone,
        "Node ID": n.node_id,
        "Profile": n.profile,
        "Trạng Thái": n.status
      }));
      const wsNum = xlsx.utils.json_to_sheet(numSheetData);
      xlsx.utils.book_append_sheet(wb, wsNum, "Kho Số Hiện Tại");

      const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename=Bao_Cao_FreeSWITCH_${Date.now()}.xlsx`);
      res.send(buffer);
    });
  });
});

app.get('/api/logs', requireAuth, (req, res) => {
  db.all("SELECT id, node_id, old_phone, new_phone, swap_type, operator, datetime(created_at) as created_at FROM swap_logs ORDER BY id DESC LIMIT 50", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

server.listen(PORT, () => console.log(`[SERVER] Ready at http://localhost:${PORT}`));