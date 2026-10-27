"""Deploy using local ignored credentials. Never print token values."""
import json,re,secrets,urllib.request,urllib.error,zipfile,io
from pathlib import Path
root=Path(__file__).resolve().parent.parent
pat=re.search(r'sbp_[A-Za-z0-9]+',(root/'supabase.md').read_text()).group()
s=(root/'telegrambot.md').read_text()
bot=re.search(r'\b\d{6,12}:[A-Za-z0-9_-]{25,}\b',s).group()
chat=re.search(r'(?im)^\s*id\s*:\s*(-?\d+)',s).group(1)
config=json.loads((root/'config/supabase-config.js').read_text().split('=',1)[1].strip().rstrip(';'))
ref=config['url'].split('//')[1].split('.')[0]
# Tác dụng: Gửi HTTP cho bước deploy và che các secret đã biết trong thông báo lỗi.
def req(url,data=None,headers=None):
 try:
  with urllib.request.urlopen(urllib.request.Request(url,data=data,headers=headers or {}),timeout=60) as r:
   raw=r.read();return json.loads(raw) if raw else {}
 except urllib.error.HTTPError as error:
  message=error.read().decode();
  for value in [pat,bot,config['historyToken']]:message=message.replace(value,'[REDACTED]')
  raise RuntimeError('HTTP '+str(error.code)+': '+message) from None
# Tác dụng: Gọi Supabase Management API trong đúng project với payload quản trị được truyền vào.
def management(path,payload):
 return req('https://api.supabase.com/v1/projects/'+ref+'/'+path,json.dumps(payload).encode(),{'Authorization':'Bearer '+pat,'Content-Type':'application/json'})
me=req('https://api.telegram.org/bot'+bot+'/getMe');print('Bot verified:',me['result']['username'])
management('database/query',{'query':(root/'supabase/telegram.sql').read_text()});print('Remote command schema deployed')
secret_path=Path('/tmp/auto-call-telegram-webhook-secret')
webhook_secret=secret_path.read_text() if secret_path.exists() else secrets.token_urlsafe(40)
management('secrets',[{'name':k,'value':v} for k,v in {'TELEGRAM_BOT_TOKEN':bot,'TELEGRAM_CHAT_ID':chat,'TELEGRAM_WEBHOOK_SECRET':webhook_secret,'CALL_MONITOR_HISTORY_TOKEN':config['historyToken']}.items()]);print('Backend secrets configured')
archive=io.BytesIO()
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:z.writestr('index.ts',(root/'supabase/functions/telegram-control/index.ts').read_text())
boundary='Boundary'+secrets.token_hex(16)
metadata=json.dumps({'name':'telegram-control','entrypoint_path':'index.ts','verify_jwt':False})
body=(f'--{boundary}\r\nContent-Disposition: form-data; name="metadata"\r\n\r\n{metadata}\r\n--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="index.ts"\r\nContent-Type: application/typescript\r\n\r\n').encode()+(root/'supabase/functions/telegram-control/index.ts').read_bytes()+f'\r\n--{boundary}--\r\n'.encode()
result=req('https://api.supabase.com/v1/projects/'+ref+'/functions/deploy?slug=telegram-control',body,{'Authorization':'Bearer '+pat,'Content-Type':'multipart/form-data; boundary='+boundary});print('Edge function:',result.get('status'))
url=config['url']+'/functions/v1/telegram-control/webhook'
result=req('https://api.telegram.org/bot'+bot+'/setWebhook',json.dumps({'url':url,'secret_token':webhook_secret,'allowed_updates':['message','callback_query']}).encode(),{'Content-Type':'application/json'});print('Webhook configured:',result.get('ok'))
result=req('https://api.telegram.org/bot'+bot+'/setMyCommands',json.dumps({'commands':[{'command':name,'description':description} for name,description in [('app','Mở app điện thoại'),('menu','Mở bảng điều khiển'),('status','Trạng thái VT/CDR và BACKUP'),('pending','Các yêu cầu chờ xác nhận'),('history','Lịch sử theo ngày'),('stats','Thống kê theo ngày'),('help','Tất cả lệnh điều khiển')]]}).encode(),{'Content-Type':'application/json'});print('Bot menu configured:',result.get('ok'))
Path('/tmp/auto-call-telegram-webhook-secret').write_text(webhook_secret)
