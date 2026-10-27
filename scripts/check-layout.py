"""Validate Chrome/PWA entry paths and generated assets without contacting live services."""
import ast
import json
import re
import subprocess
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent.parent
errors = []
checks = 0


# Tác dụng: Đếm một phép kiểm tra và gom lỗi để báo cáo tổng hợp cuối lượt.
def check(condition, message):
    global checks
    checks += 1
    if not condition:
        errors.append(message)


# Tác dụng: Kiểm tra liên kết asset tương đối tồn tại trong project; bỏ qua URL bên ngoài.
def local_file(base, reference):
    parsed = urlsplit(reference)
    if parsed.scheme or parsed.netloc or not parsed.path:
        return
    target = (base / parsed.path).resolve()
    check(target.is_relative_to(ROOT) and target.is_file(), f'Missing local asset: {base.relative_to(ROOT)}/{reference}')


manifest = json.loads((ROOT / 'manifest.json').read_text())
worker = ROOT / manifest['background']['service_worker']
check(worker.is_file(), 'Missing extension worker')
for content in manifest.get('content_scripts', []):
    for script in content.get('js', []):
        local_file(ROOT, script)
for options in [manifest.get('action', {}), manifest.get('options_ui', {})]:
    for key in ['default_popup', 'page']:
        if key in options:
            local_file(ROOT, options[key])

# importScripts resolves URLs against the worker entry URL, including nested imports.
for script in (ROOT / 'src/background').glob('*.js'):
    text = script.read_text()
    for args in re.findall(r'importScripts\(([^)]*)\)', text):
        for reference in re.findall(r'["\']([^"\']+)["\']', args):
            local_file(worker.parent, reference)
    for reference in re.findall(r'getURL\(["\']([^"\']+)["\']\)', text):
        local_file(ROOT, reference)
for html in [*(ROOT / 'src/ui').glob('*.html'), ROOT / 'mobile-app/index.html']:
    for reference in re.findall(r'(?:src|href)=["\']([^"\']+)["\']', html.read_text()):
        local_file(html.parent, reference)

mobile = ROOT / 'mobile-app'
for name, folder in [('dashboard.js', 'ui'), ('dashboard-fs-switch.js', 'ui'), ('fs-switch.js', 'core'), ('history-export.js', 'core')]:
    check((mobile / name).read_bytes() == (ROOT / 'src' / folder / name).read_bytes(), f'Outdated mobile asset: {name}; run scripts/build-mobile.py')
for name in ['adapter.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png']:
    check((mobile / name).read_bytes() == (ROOT / 'src/mobile' / name).read_bytes(), f'Outdated PWA source: {name}')
sw = (mobile / 'sw.js').read_text()
check('monitor-mobile-' + manifest['version'] in sw, 'Service worker cache version differs from manifest')
check('v' + manifest['version'] in (mobile / 'index.html').read_text(), 'Mobile UI version differs from manifest')
for reference in ast.literal_eval(re.search(r'const FILES=(\[[^;]+\]);', sw).group(1)):
    local_file(mobile, './index.html' if reference == './' else reference)
for icon in json.loads((mobile / 'manifest.webmanifest').read_text()).get('icons', []):
    local_file(mobile, icon['src'])

# Public builds must never contain a management token, history credential, or private key.
for file in mobile.iterdir():
    if file.suffix in ['.js', '.html', '.json']:
        check(not re.search(rb'sbp_[A-Za-z0-9]{10,}|sb_secret_[A-Za-z0-9]+|historyToken|-----BEGIN [A-Z ]*PRIVATE KEY', file.read_bytes()), f'Private credential pattern in {file.relative_to(ROOT)}')
ignored = subprocess.run(['git', 'check-ignore', '-q', 'config/supabase-config.js'], cwd=ROOT)
check(ignored.returncode == 0, 'Local Supabase config must be ignored by Git')
check(not list(ROOT.glob('*.js')), 'Production JS belongs under src/, not the root')
check(not (ROOT / 'supabase-config.js').exists(), 'Legacy root config should have moved to config/')
if errors:
    for error in errors:
        print(error)
    raise SystemExit(f'Layout: {checks - len(errors)} passed, {len(errors)} failed')
print(f'Layout: {checks} passed, 0 failed')
