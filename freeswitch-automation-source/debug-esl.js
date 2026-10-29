const net = require('net');

// Cấu hình Node cần soi log (FS02)
const TARGET_NODE = {
  id: 'FS02',
  host: '10.10.101.170',
  port: 8021,
  pass: process.env.ESL_PASSWORD
};

console.log(`[DEBUG TOOL] Connecting to ${TARGET_NODE.id} (${TARGET_NODE.host}:${TARGET_NODE.port})...`);

const client = new net.Socket();

client.connect(TARGET_NODE.port, TARGET_NODE.host, () => {
  console.log(`[DEBUG TOOL] TCP Connected. Waiting for Auth Request...`);
});

client.on('data', (data) => {
  const str = data.toString();

  if (str.includes('auth/request')) {
    console.log(`[DEBUG TOOL] Sending Auth...`);
    client.write(`auth ${TARGET_NODE.pass}\n\n`);
    return;
  }

  if (str.includes('+OK accepted')) {
    console.log(`[DEBUG TOOL] ✅ AUTH SUCCESS! Subscribing to CHANNEL_HANGUP_COMPLETE...\n`);
    console.log(`>>> BÂY GIỜ ANH HÃY THỰC HIỆN 1 CUỘC GỌI TEST QUA NODE FS02 (10.10.101.170) <<<\n`);
    // Đăng ký nghe riêng sự kiện kết thúc cuộc gọi
    client.write('event plain CHANNEL_HANGUP_COMPLETE\n\n');
    return;
  }

  if (str.includes('Event-Name: CHANNEL_HANGUP_COMPLETE')) {
    console.log(`\n=================== [RAW EVENT FROM ${TARGET_NODE.id}] ===================`);
    console.log(str);
    console.log(`======================================================================\n`);
  }
});

client.on('error', (err) => console.error('[DEBUG ERROR]', err.message));
client.on('close', () => console.log('[DEBUG TOOL] Connection closed.'));
