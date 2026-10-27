"""Deploy public mobile assets to an isolated Vercel preview; never upload repo secrets."""
import argparse, base64, json, re, urllib.error, urllib.parse, urllib.request
from pathlib import Path

root = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser()
parser.add_argument('--project')
parser.add_argument('--team-id')
parser.add_argument('--dry-run', action='store_true')
args = parser.parse_args()
allowed = ['adapter.js', 'config.js', 'dashboard.js', 'dashboard-fs-switch.js',
           'fs-switch.js', 'history-export.js', 'index.html', 'sw.js', 'manifest.webmanifest',
           'icon.svg', 'icon-192.png', 'icon-512.png']
files = []
for name in allowed:
    path = root / 'mobile-app' / name
    if path.is_symlink():
        raise SystemExit('Symlink not allowed: ' + name)
    content = path.read_bytes()
    if re.search(rb'\bsbp_[A-Za-z0-9]{10,}|\b(?:ghp_|github_pat_)[A-Za-z0-9_]{15,}|\b\d{6,12}:[A-Za-z0-9_-]{25,}', content):
        raise SystemExit('Credential detected in public asset: ' + name)
    if name == 'config.js':
        config = json.loads(content.decode().split('=', 1)[1].strip().rstrip(';'))
        if set(config) != {'anonKey'}:
            raise SystemExit('Mobile config must contain only the public anon key')
    files.append({'file': 'mobile-app/' + name, 'data': base64.b64encode(content).decode(), 'encoding': 'base64'})
files.append({'file': 'vercel.json', 'data': (root / 'vercel.json').read_text(), 'encoding': 'utf-8'})
if args.dry_run:
    print('Validated preview payload:', len(files), 'public files; no private repo files uploaded')
    raise SystemExit(0)
credentials = (root / 'vercel_key.md').read_text()
project_match = re.search(r'prj_[A-Za-z0-9]{12,}', credentials)
team_match = re.search(r'team_[A-Za-z0-9]{12,}', credentials)
project = args.project or (project_match.group() if project_match else 'auto-call-monitor-preview')
lines = [line.strip().strip('`"\' ') for line in credentials.splitlines()]
key = next((line for line in lines if re.fullmatch(r'[A-Za-z0-9_-]{24,}', line) and not line.startswith(('prj_', 'team_'))), None)
if not key:
    match = re.search(r'(?im)^\s*(?:token|vercel_token|access_token)\s*[:=]\s*[`"\']?([A-Za-z0-9_-]{24,})', credentials)
    key = match.group(1) if match else None
if not key:
    raise SystemExit('Cannot identify access token in vercel_key.md')
team = args.team_id or (team_match.group() if team_match else None)
query = '?' + urllib.parse.urlencode({'teamId': team}) if team else '' 
# Tác dụng: Gọi Vercel API với token local, giới hạn timeout và che token nếu API trả lỗi.
def request(path, payload=None):
    req = urllib.request.Request('https://api.vercel.com' + path + query,
        data=json.dumps(payload).encode() if payload is not None else None,
        headers={'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=45) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        message = error.read().decode().replace(key, '[REDACTED]')
        raise SystemExit('Vercel HTTP ' + str(error.code) + ': ' + message) from None
if not team:
    user = request('/v2/user').get('user', {})
    team = user.get('defaultTeamId')
    query = '?' + urllib.parse.urlencode({'teamId': team}) if team else ''
# A wrong project ID or insufficient scope must never create a different project.
project_info = request('/v9/projects/' + urllib.parse.quote(project, safe=''))
print('Target project:', project_info['name'])
# No production target, aliases, GitHub Pages changes, or worker launch.
result = request('/v13/deployments', {'name': project_info['name'], 'project': project_info['id'],
    'files': files, 'meta': {'gitCommitRef': 'feat/deploy'},
    'projectSettings': {'framework': None, 'buildCommand': '', 'installCommand': '', 'outputDirectory': 'mobile-app'}})
print('Preview deployment:', result.get('id'))
print('URL: https://' + result['url'])
print('State:', result.get('readyState', result.get('status')))
