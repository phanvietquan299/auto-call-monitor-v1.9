import os
from flask import Flask, request, jsonify
import paramiko
import requests
import logging

app = Flask(__name__)

# Cấu hình
SECRET_TOKEN = os.environ.get("SECRET_TOKEN", "")  # Phải trùng với SECRET_TOKEN trong Apps Script
TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID = os.environ.get("TELEGRAM_CHAT_ID", "")
SSH_USER = "root"
SSH_KEY_PATH = "/root/.ssh/id_rsa"

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")


def send_telegram(msg):
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    payload = {"chat_id": TELEGRAM_CHAT_ID, "text": msg, "parse_mode": "HTML"}
    try:
        response = requests.post(url, json=payload, timeout=5)
        res_data = response.json()
        if not res_data.get("ok"):
            logging.error(f"❌ Lỗi Telegram API: {res_data.get('description')}")
        else:
            logging.info("✅ Bắn Telegram thành công!")
    except Exception as e:
        logging.error(f"❌ Lỗi kết nối Telegram: {e}")

def execute_ssh_change_number(host, old_number, new_number):
    """Giả lập/Thực thi nạp file Lua qua SSH lên FreeSWITCH"""
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        ssh.connect(host, username=SSH_USER, key_filename=SSH_KEY_PATH, timeout=10)
        
        # --- ĐIỀN LỆNH LUA SSH CỦA BẠN VÀO ĐÂY ---
        # sftp = ssh.open_sftp()
        # sftp.put('/local/path/file.lua', '/remote/path/file.lua')
        # sftp.close()
        
        ssh.close()
        return True, "SSH & Cập nhật file Lua thành công"
    except Exception as e:
        return False, str(e)

@app.route('/webhook', methods=['POST'])
def handle_webhook():
    data = request.json or {}
    
    # Check Token bảo mật
    if data.get("secret_token") != SECRET_TOKEN:
        return jsonify({"status": "error", "message": "Unauthorized"}), 401
    
    fusion_node = data.get("fusion_node")
    host = data.get("host")
    old_number = data.get("old_number")
    new_number = data.get("new_number")
    
    logging.info(f"-> Nhận Webhook đổi số [{fusion_node}]: {old_number} ➔ {new_number}")
    
    # Thực hiện SSH Đổi số
    success, detail = execute_ssh_change_number(host, old_number, new_number)
    
    if success:
        msg = (
            f"⚡ <b>[WEBHOOK - ĐỔI SỐ THÀNH CÔNG]</b>\n\n"
            f"• <b>Node:</b> {fusion_node} ({host})\n"
            f"• <b>Số cũ (Blocked):</b> <code>{old_number}</code>\n"
            f"• <b>Số mới (Active):</b> <code>{new_number}</code>\n"
            f"• <b>Tốc độ:</b> Xử lý tức thì ( duoi 1s)"
        )
        send_telegram(msg)
        return jsonify({"status": "success", "message": "Switched number successfully"}), 200
    else:
        msg = f"❌ <b>[LỖI SSH ĐỔI SỐ]</b> Node {fusion_node}: {detail}"
        send_telegram(msg)
        return jsonify({"status": "error", "message": detail}), 500

if __name__ == '__main__':
    # Chạy Webserver tại Port 5000
    app.run(host='0.0.0.0', port=5001)
