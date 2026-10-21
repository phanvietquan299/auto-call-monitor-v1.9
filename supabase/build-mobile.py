"""Build mobile shell using the actual desktop UI and validated flows."""
import json,re
from pathlib import Path
root=Path(__file__).resolve().parent.parent
out=root/'mobile-app'
version=json.loads((root/'manifest.json').read_text())['version']
config=json.loads((root/'supabase-config.js').read_text().split('=',1)[1].strip().rstrip(';'))
(out/'config.js').write_text('globalThis.MobileConfig='+json.dumps({'anonKey':config['anonKey']})+';\n')
for name in ['dashboard.js','dashboard-fs-switch.js','fs-switch.js','history-export.js']:(out/name).write_text((root/name).read_text())
s=(root/'dashboard.html').read_text().replace('<html lang="en">','<html lang="vi">')
s=s.replace('<title>Auto Call Monitor</title>','<title>Auto Call Monitor</title><link rel="manifest" href="manifest.webmanifest"><meta name="theme-color" content="#0d172b"><meta name="apple-mobile-web-app-capable" content="yes"><link rel="icon" href="icon.svg"><link rel="apple-touch-icon" href="icon-192.png">')
s=s.replace('<body>','''<body>
<div id="mobile-login" style="position:fixed;inset:0;z-index:100;background:#0d172b;display:grid;place-items:center;padding:24px"><div style="max-width:400px;text-align:center"><h1>AUTO CALL MONITOR</h1><p>Nhập mật khẩu để quản lý từ xa.</p><form id="mobile-password-login-form" style="display:grid;gap:10px"><label for="mobile-login-password">Mật khẩu</label><input id="mobile-login-password" type="password" required autocomplete="current-password" placeholder="Mật khẩu app" style="padding:12px;border-radius:10px;border:1px solid #3a4a62;background:#1b2940;color:white"><button id="mobile-password-login-submit" class="on" type="submit">Đăng nhập</button></form><p id="mobile-password-login-error" class="bad" role="status"></p><details style="margin-top:16px"><summary>Đăng nhập bằng liên kết</summary><a href="https://t.me/CallCenter16725bot?start=app" style="display:inline-block;background:#39d98a;color:#07130d;padding:14px 20px;border-radius:12px;text-decoration:none;font-weight:700">Mở bot · gửi /app</a><form id="mobile-login-form" style="display:grid;gap:10px;margin-top:20px"><label for="mobile-login-link">Hoặc dán liên kết từ bot</label><input id="mobile-login-link" type="password" required autocomplete="off" placeholder="Liên kết /app" style="padding:12px;border-radius:10px;border:1px solid #3a4a62;background:#1b2940;color:white"><button class="on" type="submit">Đăng nhập</button></form><p id="mobile-login-error" class="bad"></p></details><p class="muted" style="font-size:12px">Đặt mật khẩu một lần tại nút Mật khẩu app trên tool hoặc sau khi đăng nhập bằng liên kết.</p><p class="muted" style="font-size:12px">Safari → Chia sẻ → Thêm vào Màn hình chính</p></div></div>
<div class="mobile-session-bar"><span id="mobile-connection" class="muted">Đang kết nối…</span><span id="mobile-version">v__VERSION__</span><button id="mobile-update" class="secondary" style="font-size:12px;padding:6px 10px">Cập nhật app</button><button id="mobile-logout" class="secondary" style="font-size:12px;padding:6px 10px">Đăng xuất</button></div>''')
s=s.replace('<script src="fs-switch.js">','<script src="config.js"></script><script src="adapter.js"></script><script src="fs-switch.js">')
s=s.replace('<div class="fs-switch-inline">','<details class="mobile-advanced"><summary>Ngưỡng BACKUP &amp; đặt trước FS</summary><div class="fs-switch-inline">',1)
s=s.replace('    </div>\n  </div>\n</header>','</details>\n    </div>\n  </div>\n</header>',1)
s=s.replace('<div id="mobile-link-controls">' ,'<div id="mobile-link-controls" hidden>')
s=s.replace('</style>','''#mobile-login[hidden]{display:none!important}
.mobile-session-bar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:8px max(12px,env(safe-area-inset-right)) 8px max(12px,env(safe-area-inset-left));font-size:12px}
#mobile-connection{flex:1 1 180px;min-width:0;overflow-wrap:anywhere}#mobile-version{margin-left:auto;white-space:nowrap}
.mobile-advanced{grid-column:1/-1;width:100%;min-width:0}.mobile-advanced>summary{padding:12px 0;cursor:pointer;font-size:13px;color:var(--muted)}
#mobile-login{overflow-y:auto;align-items:safe center!important}#mobile-login>div{width:100%;max-height:100%}
@media (pointer:coarse){header{position:static}header h1{font-size:22px}}
@media (orientation:landscape) and (max-height:600px){header h1,#mobile-login h1{font-size:20px}.mobile-advanced>summary{padding:8px 0}.mobile-session-bar{padding-top:5px;padding-bottom:5px}#mobile-login{padding:12px!important}#mobile-login p{margin:8px 0}}

@media(max-width:600px){header{padding:14px 12px}.toolbar-row{gap:10px}.toolbar-row button{min-height:44px}.table-wrap{scrollbar-width:thin}#groups table{min-width:850px}dialog{padding:18px}.fs-preset-row select{min-height:42px}main{padding:12px}.card{padding:14px}}
</style>''')
s=s.replace('__VERSION__',version)
s=re.sub(r'<script src="([^"]+\.js)"',lambda m:'<script src="'+m.group(1)+'?v='+version+'"',s)
(out/'index.html').write_text(s)
sw=(out/'sw.js').read_text()
sw=re.sub(r"const CACHE='[^']+';","const CACHE='monitor-mobile-"+version+"';",sw)
(out/'sw.js').write_text(sw)
print('Mobile app built from desktop dashboard; public anon key only.')
