const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');
const C=require('../src/core/cdr'),D=require('../src/core/detection');
const now=Date.parse('2026-10-11T10:25:10+07:00'),ip='10.10.101.180';
const rows=()=>Array.from({length:5},(_,i)=>({time:now-1000-i*1000,method:'INVITE',ip,callId:'call-'+i,sipCode:480,setupTime:0,duration:0}));
const evaluate=records=>C.evaluate(records,{ip,now,after:now-10000});
test('Exactly five distinct latest calls with 480/0/0 confirm locked',()=>assert.equal(evaluate(rows()).locked,true));
for(const [field,value] of [['sipCode',487],['sipCode',200],['setupTime',2],['setupTime',null],['duration',1],['duration',null]])test(`${field}=${value} breaks the latest consecutive CDR chain`,()=>{
 const r=rows();r[1][field]=value;r.push({...r[4],callId:'extra'});const proof=evaluate(r);assert.equal(proof.locked,false);assert.equal(proof.count,1);
});
test('Only three calls cannot confirm; duplicate Call IDs are not counted twice',()=>{
 assert.equal(evaluate(rows().slice(0,3)).locked,false);assert.equal(evaluate([rows()[0],rows()[0],...rows().slice(1,3)]).locked,false);
});
test('Latest good call blocks older consecutive errors',()=>{
 assert.equal(evaluate([{...rows()[0],sipCode:200,callId:'good'},...rows()]).locked,false);
});
test('Other destination does not confirm the requested FS',()=>assert.equal(evaluate(rows().map(r=>({...r,ip:'10.10.101.88'}))).locked,false));
test('Old calls, reused calls and pre-switch calls cannot confirm a new number',()=>{
 assert.equal(evaluate(rows().map(r=>({...r,time:now-40000}))).locked,false);
 assert.equal(C.evaluate(rows(),{ip,now,after:now-10000,usedCallIds:['call-0']}).locked,false);
 assert.equal(C.evaluate(rows(),{ip,now,after:now-500}).locked,false);
});
test('Missing timestamp and reversed order fail closed',()=>{
 const r=rows();r[0].time=NaN;assert.equal(evaluate(r).locked,false);assert.equal(evaluate(rows().reverse()).locked,false);
});
test('CDR evidence is scoped to incident, destination, group, active phone and freshness',()=>{
 const key='col',f={fs:'FS04',group:'99.153',ip,incident:{id:'incident'},cdr:{locked:true,count:5,incidentId:'incident',group:'99.153',ip,phone:'old',checkedAt:now}};
 const s={config:{...D.CONFIG,cdrVerificationEnabled:true},freeswitch:{numbers:[{fs:'FS04',profile:'COLLECTION',phone:'old',status:'ACTIVE'}]}};
 assert.equal(D.cdrGate(s,f,now).ready,true);
 for(const [field,value] of [['incidentId','different'],['ip','wrong'],['group','99.155'],['phone','new'],['checkedAt',now-10001]]){
  assert.equal(D.cdrGate(s,{...f,cdr:{...f.cdr,[field]:value}},now).ready,false,field);
 }
 s.freeswitch.numbers[0].phone='new';assert.equal(D.cdrGate(s,f,now).ready,false);
});
// Model the pasted table's cells and header names, including missing numbers.
function tableDoc(records,omit='',paging=false){
 const heads=['Time','Method','Sip Call ID','Sip Code','Sip Reason','Setup Time','Duration','Source IP','Destination','Exten'].filter(x=>x!==omit);
 if(paging)heads.push('','Page:','Total Records: 86276');
 const trs=records.map(r=>{const values=[r.date||'2026-10-11 10:25:09',r.method||'INVITE',r.callId,String(r.sipCode),'Temporarily Unavailable',r.setupTime==null?'':String(r.setupTime),String(r.duration),'10.30.85.100',r.ip,'test'];return {querySelectorAll:()=>values.map(textContent=>({textContent}))};});
 const table={querySelectorAll:q=>q==='th'?heads.map(textContent=>({textContent})):trs};
 return {querySelector:()=>null,querySelectorAll:()=>[table]};
}
test('Parser reads the actual pasted CDR column structure and strict numeric fields',()=>{
 const records=C.parseDocument(tableDoc(rows()));assert.equal(records.length,5);assert.equal(evaluate(records).locked,true);
 assert.equal(C.parseDocument(tableDoc([{...rows()[0],setupTime:null}]))[0].setupTime,null);
 assert.throws(()=>C.parseDocument(tableDoc(rows(),'Duration')),/thiếu cột/);
});
for(const group of ['99.153','99.155'])test(`CDR adapter ${group}: Search POST uses actual iframe form endpoint and exact destination`,async()=>{
 const fsName=group==='99.153'?'FS04':'FS07',target=C.IPS[fsName],origin='http://10.10.'+group,requests=[];let listener;
 const field={name:'cdr_field',value:'time'},input={name:'search_regexp',value:'old'},form={elements:[field,input,{name:'csrf',value:'token',type:'hidden'}],getAttribute:()=> 'cdrviewer.php?action=search',querySelector:q=>q.includes('cdr_field')?field:input};
 const doc={URL:origin+'/cp/tools/system/cdrviewer/cdrviewer.php',baseURI:origin+'/cp/tools/system/cdrviewer/cdrviewer.php',querySelector:()=>null};
 const ctx={Cdr:C,OpenSipsPage:{documents:()=>[doc],cdrForm:()=>form},location:{origin,hostname:'10.10.'+group},Date:class extends Date{static now(){return now;}},URL,URLSearchParams,AbortSignal,
  chrome:{runtime:{onMessage:{addListener(fn){listener=fn;}}}},DOMParser:class{parseFromString(){return tableDoc(rows().map(r=>({...r,ip:target})));}},
  fetch:async(url,options)=>{requests.push({url,...options});return {ok:true,url,text:async()=>'<cdr>'};}};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync('src/content/cdr-viewer.js','utf8'),ctx);
 const check=()=>new Promise(resolve=>listener({type:'CDR_CHECK_FS',group,fs:fsName,ip:target},{},resolve));
 const result=await check();assert.equal(result.ok,true);assert.equal(result.records.length,5);
 const body=new URLSearchParams(requests[0].body);assert.equal(body.get('cdr_field'),'dst_ip');assert.equal(body.get('search_regexp'),target);assert.equal(body.get('search'),'Search');assert.equal(body.get('csrf'),'token');assert.equal(body.get('start_year'),'2026');assert.equal(body.get('end_hour'),'23');
 assert.equal(requests[0].url,origin+'/cp/tools/system/cdrviewer/cdrviewer.php?action=search');
 await new Promise(setImmediate);await check();assert.equal(requests.length,2,'each check sends a new Search');
 await new Promise(setImmediate);const wrong=await new Promise(resolve=>listener({type:'CDR_CHECK_FS',group:group==='99.153'?'99.155':'99.153',fs:fsName,ip:target},{},resolve));assert.equal(wrong.ok,false);assert.equal(requests.length,2);
});
test('Page role resolves nested iframe content despite the same main.php URL',()=>{
 let listener;const child={URL:'http://10.10.99.153/cp/tools/system/cdrviewer/cdrviewer.php',querySelectorAll:q=>q==='form'?[{querySelector:()=>({})}]:[],querySelector:()=>null};
 const parent={URL:'http://10.10.99.153/cp/main.php',querySelectorAll:q=>q==='iframe,frame'?[{contentDocument:child}]:[],querySelector:()=>null};
 const ctx={document:parent,location:{hostname:'10.10.99.153'},chrome:{runtime:{onMessage:{addListener(fn){listener=fn;}}}}};vm.createContext(ctx);vm.runInContext(fs.readFileSync('src/content/opensips-page.js','utf8'),ctx);
 let result;listener({type:'OPENSIPS_PAGE_ROLE'},{},r=>result=r);assert.equal(result.role,'CDR');
 child.URL='http://10.10.99.153/cp/tools/system/loadbalancer/loadbalancer.php';child.querySelectorAll=()=>[];listener({type:'OPENSIPS_PAGE_ROLE'},{},r=>result=r);assert.equal(result.role,'LOAD_BALANCER');
});

for(const group of ['99.153','99.155'])test(`Worker selects ${group} CDR by page content, not duplicate main.php URLs`,async()=>{
 const ctx={chrome:{tabs:{query:async()=>[{id:1},{id:2}],sendMessage:async id=>({ok:true,group,role:id===1?'LOAD_BALANCER':'CDR'})}}};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync('src/background/cdr-worker.js','utf8'),ctx);
 assert.equal(await ctx.openSipsTabWithRole(group,'CDR'),2);assert.equal(await ctx.openSipsTabWithRole(group,'LOAD_BALANCER'),1);
 ctx.chrome.tabs.sendMessage=async()=>({ok:true,group,role:'CDR'});
 await assert.rejects(ctx.openSipsTabWithRole(group,'CDR'),/đúng một tab/);
});
for(const group of ['99.153','99.155'])for(const locked of [true,false])test(`Post-rotation target ${group}: CDR proof ${locked} controls the status write`,async()=>{
 const F=require('../src/core/fs-switch');let clock=now,writes=0;
 const sale=group==='99.155',targetFs=sale?'FS07':'FS03',targetIp=C.IPS[targetFs];
 const plan={group,groupId:sale?3:2,profile:sale?'TELESALE':'COLLECTION',source:{fs:sale?'FS06':'FS01',baseline:600},target:{fs:targetFs,ip:targetIp,phone:'new'}};
 const target={group,fs:targetFs,ip:targetIp,state:'INACTIVE',history:[]},state={monitoringEnabled:true,config:{...D.CONFIG,cdrVerificationEnabled:true},fsStates:{target},events:[]};
 const feature={operation:{id:'op',targetInitialVt:0}};
 const ctx={FsSwitch:F,Detection:D,Cdr:C,Date:class extends Date{static now(){return clock;}},structuredClone,messageQueue:Promise.resolve(),
  setTimeout(fn,ms){clock+=ms;fn();},chrome:{runtime:{onMessage:{addListener(){}}},alarms:{create(){},onAlarm:{addListener(){}}}},
  getState:async()=>state,saveState:async()=>{},queryCdr:async()=>rows().map((r,i)=>({...r,ip:targetIp,callId:'new-'+i,time:clock-1000,setupTime:locked?0:2}))};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync('src/background/fs-switch-worker.js','utf8'),ctx);
 ctx.switchSnapshot=async()=>state;ctx.switchSave=async()=>{};ctx.switchTab=async()=>2;ctx.waitForFreeSwitch=async()=>{};
 ctx.switchCommand=async(_id,msg)=>{
  if(msg.type==='FS_SWITCH_READ_NODE')return {groupId:plan.groupId,used:0};
  if(msg.type==='READ_FS_NUMBERS')return {numbers:[{fs:targetFs,profile:plan.profile,phone:'new',status:'ACTIVE',hasStatusControl:true}]};
  assert.equal(msg.type,'AUTO_BLOCK_FS');writes++;return {ok:true};
 };
 await ctx.monitorSwitchTarget(1,plan,feature);
 assert.equal(writes,locked?1:0);assert.equal(feature.operation.stage,locked?'RECOVERING':'WAITING_CDR');
 if(!locked)assert.equal(feature.operation.targetWatchPending,true);
});

test('Observation reports the complete consecutive run even beyond the five-call threshold',()=>{
 const r=Array.from({length:7},(_,i)=>({...rows()[0],callId:'run-'+i,time:now-1000-i*1000}));
 const proof=evaluate(r);assert.equal(proof.consecutiveTotal,7);assert.equal(proof.count,5);assert.equal(proof.locked,true);
});
test('Observation mode never imposes a CDR gate on existing VT decisions',()=>{
 const s={config:{...D.CONFIG,cdrObservationEnabled:true,cdrVerificationEnabled:false}};
 assert.equal(D.cdrGate(s,{group:'99.155',fs:'FS05',cdr:{locked:false,count:0}},now).ready,true);
});

test('CDR pagination header cells do not discard real call rows',()=>{
 const records=C.parseDocument(tableDoc(rows(),'',true));
 assert.equal(records.length,5);assert.equal(records[0].sipCode,480);
 assert.equal(records[0].setupTime,0);assert.equal(records[0].duration,0);
});

test('Observation counts visible old records while verification still rejects stale evidence',()=>{
 const r=rows().map(x=>({...x,time:now-60000}));
 const proof=C.evaluate(r,{ip,now,after:now-30000,observation:true});
 assert.equal(proof.consecutiveTotal,5);assert.equal(proof.locked,true);
 assert.equal(evaluate(r).count,0);
 assert.equal(C.evaluate([...r,...r],{ip,now,observation:true}).consecutiveTotal,5);
 const broken=[{...r[0],setupTime:2},...r.slice(1)];
 assert.equal(C.evaluate(broken,{ip,now,observation:true}).consecutiveTotal,0);
 assert.equal(evaluate(rows().slice(0,4)).locked,false);
});

for(const group of ['99.153','99.155'])test(`Direct CDR ${group} loads hidden form and recovers a failed Search without navigation`,async()=>{
 const origin='http://10.10.'+group,fsName=group==='99.153'?'FS04':'FS07',target=C.IPS[fsName];
 let listener,posts=0,gets=0;const requests=[];
 const form={elements:[{name:'csrf',value:'fresh-token',type:'hidden'}],getAttribute:()=> 'cdrviewer.php?action=search'};
 const fetchedForm={kind:'form'},main={kind:'main'};
 const ctx={Cdr:C,OpenSipsPage:{documents:()=>[main],cdrForm:d=>d.kind==='form'?form:null},location:{origin,hostname:'10.10.'+group},URL,URLSearchParams,AbortSignal,Date,
 chrome:{runtime:{onMessage:{addListener(fn){listener=fn;}}}},DOMParser:class{parseFromString(html){return html==='form'?fetchedForm:tableDoc(rows().map(r=>({...r,ip:target})));}},
 fetch:async(url,options)=>{requests.push({url,...options});if(options.method==='POST'){posts++;return {ok:posts!==1,url,text:async()=> 'rows'};}gets++;return {ok:true,url,text:async()=> 'form'};}};
 vm.runInNewContext(fs.readFileSync('src/content/cdr-viewer.js','utf8'),ctx);
 const check=()=>new Promise(resolve=>listener({type:'CDR_CHECK_FS',group,fs:fsName,ip:target},{},resolve));
 const result=await check();assert.equal(result.ok,true);assert.equal(result.records.length,5);assert.equal(gets,2);assert.equal(posts,2);
 assert.equal(new URLSearchParams(requests.at(-1).body).get('csrf'),'fresh-token');
 assert.equal(new URLSearchParams(requests.at(-1).body).get('search_regexp'),target);
 await new Promise(setImmediate);assert.equal((await check()).ok,true);assert.equal(gets,2,'reuse cached form');assert.equal(posts,3);
});

test('Calls per second use CDR timestamps and merge distinct IDs across repeated searches',()=>{
 const input=[{...rows()[0],callId:'a',time:now-1000},{...rows()[0],callId:'b',sipCode:200,time:now-1000},{...rows()[0],callId:'c',time:now-2000}];
 const first=C.measureTraffic(input,null,{ip,now});
 assert.deepEqual(first.buckets,[{time:now-1000,count:2},{time:now-2000,count:1}]);
 const merged=C.measureTraffic([...input,{...input[0],callId:'d'}, {...input[0],callId:'other',ip:'other'}],first,{ip,now});
 assert.equal(merged.latest.count,3);assert.equal(merged.observed.length,4);
 assert.equal(C.measureTraffic([],merged,{ip,now:now+61000}).latest,null);
 assert.equal(C.measureTraffic([{...input[0],time:NaN},{...input[0],time:now+10000}],null,{ip,now}).latest,null);
});

test('Latest mixed 480-0-0 and 480-1-0 chain counts five calls',()=>{
 const r=rows();r[0].setupTime=1;r[2].setupTime=1;r[4].setupTime=1;
 const proof=evaluate(r);assert.equal(proof.locked,true);assert.equal(proof.consecutiveTotal,5);
 assert.equal(evaluate(r.map(x=>({...x,setupTime:1}))).count,5,'five 480-1-0 calls qualify independently');
 const separated=[...r.map(x=>({...x,setupTime:1})),{...r[4],callId:'break',sipCode:487}, {...r[4],callId:'older-zero',setupTime:0}];
 assert.equal(evaluate(separated).locked,true,'five newest 480-1-0 calls qualify before the separator');
});
for(const setups of [[1,1,1,1,0],[0,1,0,0,0],[1,0,1,0,1]])test(`Five mixed qualifying calls ${setups.join(',')} confirm locked`,()=>{
 const result=evaluate(rows().map((r,i)=>({...r,setupTime:setups[i]})));
 assert.equal(result.locked,true);assert.equal(result.count,5);
});
for(const [sipCode,setupTime] of [[480,30],[408,30],[487,32]])test(`Special CDR ${sipCode}-${setupTime}-0 requires five distinct fresh consecutive calls`,()=>{
 const r=rows().map(x=>({...x,sipCode,setupTime}));
 assert.equal(C.specialWarning(r,{ip,now}).pattern,`${sipCode}-${setupTime}-0`);
 assert.equal(C.specialWarning(r.slice(0,4),{ip,now}),null);
 assert.equal(C.specialWarning(r.map(x=>({...x,callId:'same'})),{ip,now}),null);
 assert.equal(C.specialWarning(r.map(x=>({...x,time:now-60000})),{ip,now}),null);
 assert.equal(C.specialWarning([{...r[0],duration:1},...r.slice(1)],{ip,now}),null);
});

test('Stable CDR evaluator respects an explicitly supplied call cutoff',()=>{
 const cutoff=now-3000;const old=rows();old[0].time=now-1000;assert.equal(evaluate(old).locked,true);
 const recent=rows().map((r,i)=>({...r,time:now-1000-i*100}));const proof=C.evaluate(recent,{ip,now,after:cutoff});assert.equal(proof.locked,true);assert.equal(proof.callIds.length,5);assert.equal(C.evaluate(old,{ip,now,after:cutoff}).locked,false);
});
