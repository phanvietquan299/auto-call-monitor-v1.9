const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');const D=require('../src/core/detection');
const TEST_NOW=Date.parse('2026-10-07T10:00:00+07:00');
const Clock=class extends Date{static now(){return TEST_NOW;}};
function worker(initial,tabs=[{id:1,active:false}]){let stored=initial||{detectionVersion:2,config:{detectionSource:"VT",cdrVerificationEnabled:false}},listener,alarmListener,clicks=0,reloads=[],refreshes=[];const context={Detection:D,FsSwitch:require('../src/core/fs-switch'),importScripts(){},structuredClone,Date:Clock,chrome:{alarms:{get:async()=>({}),create:async()=>{},onAlarm:{addListener(fn){alarmListener=fn;}}},storage:{local:{get:async()=>({state:structuredClone(stored)}),set:async({state})=>{stored=structuredClone(state);}}},runtime:{onInstalled:{addListener(){}},onStartup:{addListener(){}},onMessage:{addListener(fn){listener=fn;}}},action:{onClicked:{addListener(){}}},tabs:{reload:async()=>{throw Error('Heartbeat must not navigate OpenSIPS');},query:async()=>tabs,sendMessage:async(_id,msg)=>{if(msg.type==='OPENSIPS_REFRESH_TOOL'){reloads.push(_id);refreshes.push({id:_id,role:msg.role});return {ok:true};}if(msg.type==='OPENSIPS_PAGE_ROLE')return {ok:true,role:tabs.find(t=>t.id===_id)?.role||'LOAD_BALANCER'};clicks++;assert.equal(stored.fsStates.k.incident.locked,true);return {ok:true,newPhone:'backup'};}}}};vm.createContext(context);vm.runInContext(fs.readFileSync('src/background/background.js','utf8'),context);return {send:msg=>new Promise(resolve=>listener(msg,{},resolve)),get state(){return stored},get clicks(){return clicks},get reloads(){return reloads},get refreshes(){return refreshes},tickAlarm:async()=>{alarmListener({name:'opensips-reload'});await new Promise(setImmediate);}};}
function seeded(){const now=TEST_NOW;return {config:{detectionSource:"VT",cdrVerificationEnabled:false},detectionVersion:2,monitoringEnabled:true,autoEnabled:true,events:[],eventKeys:{},grafana:{'99.153':{updatedAt:now,value:400,history:[400,400,400]}},fsStates:{k:{key:'k',group:'99.153',groupId:2,groupIdAt:now,fs:'FS03',ip:'ip',state:'SUSPECTED',activeBeforeIncident:true,updatedAt:now,baseline:520,recentMedian:100,trafficBaseline:820,incident:{id:'i',locked:false,autoExecuted:false}}},pendingAutoActions:[{key:'k',group:'99.153',groupId:2,groupIdAt:now,fs:'FS03',profile:'COLLECTION',phone:'old',incidentId:'i'}]};}
test('Clear event history preserves locked incident',async()=>{const s=seeded();s.fsStates.k.state='COOLDOWN';s.fsStates.k.incident.locked=true;const w=worker(s);const r=await w.send({type:'CLEAR_HISTORY',date:'2026-10-07',startTime:'00:00',endTime:'23:59'});assert.equal(r.ok,true);assert.equal(w.state.fsStates.k.incident.locked,true);});
test('Concurrent sample messages serialize without losing histories',async()=>{const w=worker(undefined);await Promise.all(Array.from({length:30},(_,i)=>w.send({type:'GRAFANA_SAMPLE',values:{'99.153':800+i}})));assert.equal(w.state.grafana['99.153'].history.length,30);});
test('Failed OpenSIPS read preserves existing state and samples',async()=>{const w=worker(seeded());await w.send({type:'OPENSIPS_SAMPLE',group:'99.153',nodes:[],diagnostic:{error:'offline'}});assert.equal(w.state.fsStates.k.incident.id,'i');});
function fsPage(rows){let handler,clicks=0;const tr=rows.map(r=>({children:[{tagName:'TD',innerText:r.phone},{tagName:'TD',innerText:'FS03'},{tagName:'TD',innerText:'COLLECTION'},{tagName:'TD',querySelector:()=>({value:r.status})},{tagName:'TD',querySelector:()=>({getAttribute:()=>`markBlockedAndSwap('${r.phone}', 'FS03')`,click:()=>clicks++})}]}));const ctx={chrome:{runtime:{id:'test',sendMessage:async()=>{},onMessage:{addListener(fn){handler=fn;}}}},document:{querySelector:()=>null,querySelectorAll:()=>tr},setInterval:()=>1,clearInterval(){},Date};vm.createContext(ctx);vm.runInContext(fs.readFileSync('src/content/freeswitch.js','utf8'),ctx);let result;handler({type:'AUTO_BLOCK_FS',fs:'FS03',profile:'COLLECTION',phone:'old'}, {},r=>result=r);return {result,clicks};}
test('FreeSWITCH counts all ACTIVE rows before comparing expected phone',()=>{const r=fsPage([{phone:'old',status:'ACTIVE'},{phone:'other',status:'ACTIVE'}]);assert.equal(r.result.ok,false);assert.equal(r.clicks,0);});
test('Changed phone aborts before click',()=>{const r=fsPage([{phone:'new',status:'ACTIVE'}]);assert.equal(r.result.ok,false);assert.equal(r.clicks,0);});


test('Manual report locks incident without clicking FreeSWITCH',async()=>{const s=seeded();s.autoEnabled=false;const w=worker(s);const r=await w.send({type:'REPORT_MANUAL_SWAP',key:'k',incidentId:'i'});assert.equal(r.ok,true);assert.equal(w.clicks,0);assert.equal(w.state.fsStates.k.state,'COOLDOWN');assert.equal(w.state.fsStates.k.incident.manualExecuted,true);});

test('Alarm reloads a background standalone Load Balancer tab',async()=>{const w=worker(undefined);await w.tickAlarm();assert.deepEqual(w.reloads,[1]);});
test('Legacy confirmation cannot trigger a page action',async()=>{const w=worker(seeded());assert.equal((await w.send({type:'CONFIRM_AUTO_BLOCK',key:'k',incidentId:'i'})).ok,false);assert.equal(w.clicks,0);});

test('Alarm skips viewed OpenSIPS tab and wakes the other background tab',async()=>{
  const tabs=[{id:153,role:'CDR',active:true,status:'complete'},{id:155,role:'CDR',active:false,status:'complete'}];
  const w=worker(undefined,tabs);await w.tickAlarm();assert.deepEqual(w.reloads,[155]);
  tabs[0].active=false;tabs[1].active=true;
  await w.tickAlarm();assert.deepEqual(w.reloads,[155,153]);
  tabs[1].active=false;await w.tickAlarm();assert.deepEqual(w.reloads,[155,153,153,155]);
});
test('Alarm skips background OpenSIPS tabs already loading',async()=>{
  const w=worker(undefined,[{id:153,active:false,status:'loading'},{id:155,active:true,status:'complete'}]);
  await w.tickAlarm();assert.deepEqual(w.reloads,[]);
});

test('Clear history deletes only the chosen Vietnam date and minutes, preserving incident/dedup state',async()=>{
 const s=seeded();s.autoEnabled=false;s.eventKeys={'i|AUTO_BLOCKED':TEST_NOW};
 const vn=t=>Date.parse(t+'+07:00');
 s.events=[['previous','2026-10-06T09:30:00'],['before','2026-10-07T09:29:59'],['start','2026-10-07T09:30:00'],
   ['end-minute','2026-10-07T09:40:59'],['after','2026-10-07T09:41:00'],['next','2026-10-08T09:30:00']].map(([id,t])=>({id,at:vn(t)}));
 const w=worker(s),r=await w.send({type:'CLEAR_HISTORY',date:'2026-10-07',startTime:'09:30',endTime:'09:40'});
 assert.equal(r.ok,true);assert.equal(r.deleted,2);assert.deepEqual(w.state.events.map(e=>e.id),['previous','before','after','next']);
 assert.equal(w.state.fsStates.k.incident.id,'i');assert.equal(w.state.eventKeys['i|AUTO_BLOCKED'],TEST_NOW);assert.equal(w.clicks,0);
});
for(const range of [{},{date:'2026-02-30',startTime:'00:00',endTime:'23:59'},
 {date:'2026-10-07',startTime:'25:00',endTime:'26:00'},
 {date:'2026-10-07',startTime:'10:00',endTime:'09:00'}])test(`Clear history rejects invalid/unbounded range ${JSON.stringify(range)}`,async()=>{
 const s=seeded();s.events=[{at:TEST_NOW,type:'AUTO_BLOCKED'}];const w=worker(s);
 const r=await w.send({type:'CLEAR_HISTORY',...range});assert.equal(r.ok,false);assert.equal(w.state.events.length,1);assert.equal(w.clicks,0);
});

test('Alarm reloads both tool frames independently on the same host',async()=>{
 const w=worker(undefined,[{id:1,active:false,role:'LOAD_BALANCER'},{id:2,active:false,role:'CDR'}]);
 await w.tickAlarm();assert.deepEqual(w.reloads,[1,2]);
});

test('Two same-host tabs are assigned Load Balancer and CDR even if both show CDR',async()=>{
 const tabs=[{id:11,url:'http://10.10.99.153/cp/main.php',active:false,role:'CDR'},{id:12,url:'http://10.10.99.153/cp/main.php',active:false,role:'CDR'},
 {id:21,url:'http://10.10.99.155/cp/main.php',active:false,role:'UNKNOWN'},{id:22,url:'http://10.10.99.155/cp/main.php',active:false,role:'UNKNOWN'}];
 const w=worker(undefined,tabs);await w.tickAlarm();
 assert.deepEqual(w.refreshes,[{id:11,role:'LOAD_BALANCER'},{id:12,role:'CDR'},{id:21,role:'LOAD_BALANCER'},{id:22,role:'CDR'}]);
 await w.tickAlarm();assert.deepEqual(w.refreshes.slice(4),w.refreshes.slice(0,4));
});
test('Saved 09:00 start migrates to 08:00 while manual monitoring OFF stays OFF',async()=>{
 const s=seeded();s.config.workdayStartMinute=540;s.monitoringEnabled=false;
 const w=worker(s);await w.send({type:'GET_STATE'});
 assert.equal(w.state.config.workdayStartMinute,480);assert.equal(w.state.monitoringEnabled,false);
});
