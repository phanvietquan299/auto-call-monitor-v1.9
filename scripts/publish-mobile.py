"""Publish only sanitized mobile static assets to an isolated GitHub Pages branch."""
import json,subprocess,urllib.request,urllib.error,base64,re
from pathlib import Path
root=Path(__file__).resolve().parent.parent
p=subprocess.run(['git','credential','fill'],input='protocol=https\nhost=github.com\n\n',capture_output=True,text=True,check=True)
credential=dict(line.split('=',1) for line in p.stdout.splitlines() if '=' in line)
headers={'Authorization':'Bearer '+credential['password'],'Accept':'application/vnd.github+json','Content-Type':'application/json'}
base='https://api.github.com/repos/phanvietquan299/auto-call-monitor-v1.9'
# Tác dụng: Gọi GitHub API để xuất bản các asset mobile đã lọc; không in credential ra log.
def request(path,data=None,method=None):
 with urllib.request.urlopen(urllib.request.Request(base+path,data=json.dumps(data).encode() if data is not None else None,headers=headers,method=method),timeout=30) as response:
  raw=response.read();return json.loads(raw) if raw else {}
entries=[]
for file in sorted((root/'mobile-app').iterdir()):
 if not file.is_file():continue
 raw=file.read_bytes()
 if file.suffix in ['.js','.html','.json'] and re.search(rb'sbp_[A-Za-z0-9]{10,}|sb_secret_[A-Za-z0-9]+|historyToken',raw):raise RuntimeError('Credential pattern in public assets')
 blob=request('/git/blobs',{'content':base64.b64encode(raw).decode(),'encoding':'base64'})
 entries.append({'path':file.name,'mode':'100644','type':'blob','sha':blob['sha']})
blob=request('/git/blobs',{'content':'','encoding':'utf-8'});entries.append({'path':'.nojekyll','mode':'100644','type':'blob','sha':blob['sha']})
tree=request('/git/trees',{'tree':entries})
try:old=request('/git/ref/heads/gh-pages')['object']['sha']
except urllib.error.HTTPError as e:
 if e.code!=404:raise
 old=None
commit=request('/git/commits',{'message':'Publish mobile Auto Call Monitor dashboard','tree':tree['sha'],'parents':[old] if old else []})
if old:request('/git/refs/heads/gh-pages',{'sha':commit['sha']},'PATCH')
else:request('/git/refs',{'ref':'refs/heads/gh-pages','sha':commit['sha']})
try:pages=request('/pages')
except urllib.error.HTTPError as e:
 if e.code!=404:raise
 try:pages=request('/pages',{'source':{'branch':'gh-pages','path':'/'}},'POST')
 except urllib.error.HTTPError as conflict:
  if conflict.code!=409:raise
  pages=request('/pages')
if pages.get('source',{}).get('branch')!='gh-pages':request('/pages',{'source':{'branch':'gh-pages','path':'/'}},'PUT')
print('Published mobile assets:',commit['sha'][:8]);print('URL: https://phanvietquan299.github.io/auto-call-monitor-v1.9/')
