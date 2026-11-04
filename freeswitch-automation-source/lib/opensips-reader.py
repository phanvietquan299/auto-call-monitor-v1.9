"""Read-only OpenSIPS web adapter. Credentials/cookies never leave this process."""
import datetime, http.cookiejar, json, os, re, sys, time, urllib.parse, urllib.request
from html.parser import HTMLParser
from pathlib import Path

HOSTS={'99.153':'10.10.99.153','99.155':'10.10.99.155'}
LB='/cp/tools/system/loadbalancer/loadbalancer.php'
CDR='/cp/tools/system/cdrviewer/cdrviewer.php'
class Page(HTMLParser):
    def __init__(self,html):
        super().__init__(convert_charrefs=True);self.forms=[];self.tables=[];self.form=None;self.table=None;self.row=None;self.cell=None;self.select=None;self.option=None;self.stack=[]
        self.feed(html)
    def finish_option(self):
        if self.option is not None and self.form is not None and self.select:
            fields=self.form['fields'];value=self.option['value'] if self.option['value'] is not None else self.option['text'].strip()
            if self.select not in fields or self.option['selected']:fields[self.select]=value
        self.option=None
    def handle_starttag(self,tag,attrs):
        a=dict(attrs)
        if tag=='form':self.form={'action':a.get('action',''),'fields':{}};self.forms.append(self.form)
        if self.form and tag=='input' and a.get('name') and 'disabled' not in a:
            kind=a.get('type','text').lower()
            if kind not in ['submit','button','reset','file','image'] and (kind not in ['checkbox','radio'] or 'checked' in a):self.form['fields'][a['name']]=a.get('value','')
        if self.form and tag=='select' and a.get('name') and 'disabled' not in a:self.select=a['name']
        if self.select and tag=='option':
            self.finish_option();self.option={'value':a.get('value'),'text':'','selected':'selected' in a}
        if tag=='table':
            self.stack.append((self.table,self.row,self.cell));self.table=None;self.row=None;self.cell=None
            if 'ttable' in a.get('class','').split():self.table=[];self.tables.append(self.table)
            return
        if self.table is not None and tag=='tr':self.row=[];self.table.append(self.row)
        if self.row is not None and tag in ['td','th']:self.cell={'text':'','header':tag=='th'};self.row.append(self.cell)
    def handle_data(self,data):
        cell=self.cell if self.cell is not None else next((cell for _,_,cell in reversed(self.stack) if cell is not None),None)
        if cell is not None:cell['text']+=data+' '
        if self.option is not None:self.option['text']+=data
    def handle_endtag(self,tag):
        if tag=='option':self.finish_option()
        if tag=='select':self.finish_option();self.select=None
        if tag=='form':self.form=None
        if tag in ['td','th']:self.cell=None
        if tag=='tr':self.row=None
        if tag=='table' and self.stack:self.table,self.row,self.cell=self.stack.pop()
    def rows(self,table):return [[re.sub(r'\s+',' ',c['text']).strip() for c in row] for row in table]

def traffic(page):
    result=[]
    if not page.tables:raise ValueError('Không tìm thấy bảng Traffic')
    for table in page.tables:
        for cells in page.rows(table):
            text=' '.join(cells);ip=re.search(r'sip:((?:\d{1,3}\.){3}\d{1,3})(?::\d+)?',text,re.I);vt=re.search(r'\bvt\s*=\s*(\d+)\s*/\s*(\d+)',text,re.I)
            if not ip or not vt:continue
            result.append({'ip':ip[1],'used':int(vt[1]),'capacity':int(vt[2]),'destinationId':int(cells[0]) if cells[0].isdigit() else None,'groupId':int(cells[1]) if len(cells)>1 and cells[1].isdigit() else None})
    return result

def cdr(page,ip):
    names=['time','method','sip call id','sip code','setup time','duration','destination']
    for table in page.tables:
        rows=page.rows(table);header=next((r for r in rows if 'sip code' in [x.lower() for x in r]),None)
        if not header:continue
        heads=[x.lower() for x in header]
        if any(n not in heads for n in names):raise ValueError('Bảng CDR thiếu cột')
        indexes=[heads.index(n) for n in names];result=[]
        for row in rows:
            if len(row)<=max(indexes) or row==header:continue
            v=[row[i] for i in indexes]
            if v[6]!=ip or v[1]!='INVITE':continue
            try:at=int(datetime.datetime.strptime(v[0],'%Y-%m-%d %H:%M:%S').replace(tzinfo=datetime.timezone(datetime.timedelta(hours=7))).timestamp()*1000)
            except ValueError:at=None
            result.append({'time':at,'method':v[1],'callId':v[2],'sipCode':int(v[3]) if v[3].isdigit() else None,'setupTime':int(v[4]) if v[4].isdigit() else None,'duration':int(v[5]) if v[5].isdigit() else None,'ip':v[6]})
        return result[:200]
    raise ValueError('Không tìm thấy bảng CDR')

class Reader:
    def __init__(self,group):
        self.group=group;self.origin='http://'+HOSTS[group]
        config=Path(os.environ.get('MONITOR_ACCESS_FILE','/etc/freeswitch-automation-monitor-opensips.json'))
        if not config.is_file():raise ValueError('Chưa cấu hình tài khoản OpenSIPS')
        self.access=json.loads(config.read_text()).get(group,{})
        if self.access.get('disabled'):raise ValueError('Tài khoản OpenSIPS đã bị từ chối; cần cập nhật tài khoản đúng')
        if not self.access.get('username') or not self.access.get('password'):raise ValueError('Thiếu tài khoản OpenSIPS của nhóm')
        directory=Path(os.environ.get('MONITOR_COOKIE_DIR','/var/lib/freeswitch-automation-monitor/web-sessions'));directory.mkdir(mode=0o700,parents=True,exist_ok=True)
        self.formfile=directory/(group+'.cdr-form.json')
        self.cookiefile=directory/(group+'.cookies');self.jar=http.cookiejar.MozillaCookieJar(str(self.cookiefile))
        if self.cookiefile.exists():
            try:self.jar.load(ignore_discard=True)
            except Exception:pass
        origin=self.origin
        class SameOrigin(urllib.request.HTTPRedirectHandler):
            def redirect_request(self,req,fp,code,msg,headers,newurl):
                if urllib.parse.urlsplit(newurl).netloc!=urllib.parse.urlsplit(origin).netloc:raise ValueError('OpenSIPS chuyển hướng ra ngoài máy chủ')
                return super().redirect_request(req,fp,code,msg,headers,newurl)
        self.client=urllib.request.build_opener(urllib.request.ProxyHandler({}),urllib.request.HTTPCookieProcessor(self.jar),SameOrigin())
    def request(self,path,fields=None):
        url=urllib.parse.urljoin(self.origin,path);parts=urllib.parse.urlsplit(url)
        if parts.netloc!=urllib.parse.urlsplit(self.origin).netloc or parts.path not in [LB,CDR,'/cp/index.php','/cp/login.php']:raise ValueError('Endpoint không được phép')
        data=None if fields is None else urllib.parse.urlencode(fields).encode()
        req=urllib.request.Request(url,data=data,headers={'Cache-Control':'no-cache','User-Agent':'FS-Monitor-ReadOnly/1.0'})
        with self.client.open(req,timeout=5) as response:
            raw=response.read(3_000_001)
            if len(raw)>3_000_000:raise ValueError('Phản hồi OpenSIPS quá lớn')
            return Page(raw.decode('utf-8',errors='replace'))
    def login(self):
        self.request('/cp/index.php')
        page=self.request('/cp/login.php',{'name':self.access['username'],'password':self.access['password'],'acces.x':'1','acces.y':'1'})
        if any('password' in form['fields'] for form in page.forms):raise ValueError('Sai tài khoản hoặc mật khẩu OpenSIPS; đã dừng đăng nhập lại')
        self.jar.save(ignore_discard=True);os.chmod(self.cookiefile,0o600)
    def cdr_form(self,force=False):
        if not force and self.formfile.exists():
            try:
                saved=json.loads(self.formfile.read_text())
                if 0<=time.time()-saved['at']<60:return saved['form']
            except (ValueError,KeyError,OSError):pass
        page=self.request(CDR)
        form=next((f for f in page.forms if urllib.parse.urlsplit(urllib.parse.urljoin(self.origin+CDR,f['action'])).path==CDR and urllib.parse.parse_qs(urllib.parse.urlsplit(f['action']).query).get('action')==['search']),None)
        if form:
            temporary=self.formfile.with_suffix('.tmp');temporary.write_text(json.dumps({'at':time.time(),'form':form}));temporary.chmod(0o600);temporary.replace(self.formfile)
        return form
    def read(self,operation,ip=None):
        for attempt in range(2):
            if operation=='traffic':
                page=self.request(LB+'?action=add',{'refresh':'Refresh from Server'})
                if page.tables:return {'nodes':traffic(page)}
            else:
                form=self.cdr_form(force=attempt>0)
                if form:
                    fields=form['fields'];fields.update(cdr_field='dst_ip',search_regexp=ip,search='Search')
                    date=datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=7)))
                    for prefix in ['start','end']:
                        for unit,value in [('year',str(date.year)),('month',f'{date.month:02}'),('day',f'{date.day:02}'),('hour','00' if prefix=='start' else '23'),('minute','00' if prefix=='start' else '59'),('second','00' if prefix=='start' else '59')]:fields[prefix+'_'+unit]=value
                    action=urllib.parse.urljoin(self.origin+CDR,form['action'])
                    try:return {'records':cdr(self.request(action,fields),ip)}
                    except ValueError:
                        if attempt:raise
                        self.formfile.unlink(missing_ok=True)
            if attempt==0:self.login()
        raise ValueError('OpenSIPS yêu cầu đăng nhập hoặc không trả bảng dữ liệu')

def main():
    try:
        group,operation=sys.argv[1:3]
        if group not in HOSTS or operation not in ['traffic','cdr']:raise ValueError('Yêu cầu không hợp lệ')
        ip=sys.argv[3] if len(sys.argv)>3 else None
        if operation=='cdr' and not re.fullmatch(r'(?:\d{1,3}\.){3}\d{1,3}',ip or ''):raise ValueError('IP không hợp lệ')
        result=Reader(group).read(operation,ip);result['ok']=True
    except ValueError as e:result={'ok':False,'error':str(e),'code':'AUTH' if 'đăng nhập' in str(e).lower() or 'tài khoản' in str(e).lower() else 'PARSE'}
    except Exception:result={'ok':False,'error':'Không đọc được OpenSIPS (kết nối, HTTP hoặc phiên đăng nhập)'}
    print(json.dumps(result,ensure_ascii=False))
if __name__=='__main__':main()
