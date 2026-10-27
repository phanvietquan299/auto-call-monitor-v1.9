const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
function dashboard(){
  const action={key:'99.153|FS03|ip',incidentId:'incident',phone:'phone',fs:'FS03',group:'99.153',profile:'COLLECTION',ip:'ip'};
  const state={autoEnabled:true,monitoringEnabled:true,mode:'MONITOR',pendingAutoActions:[action],fsStates:{[action.key]:{currentVt:0,baseline:500,recentMedian:0,dropPercent:100}},opensips:{},grafana:{},config:{}};
  const elements=new Map(),sent=[],historyReads=[],downloads=[],timeouts=new Map();let timer,reply={ok:true},timeoutId=0,deferredGet=null;
  function element(selector){
    if(!elements.has(selector))elements.set(selector,{textContent:'',innerHTML:'',disabled:false,open:false,childNodes:[],
      addEventListener(type,fn){this[type]=fn;},showModal(){this.open=true;},close(){this.open=false;}});
    return elements.get(selector);
  }
  const ctx={Date,FsSwitch:require('../src/core/fs-switch'),HistoryExport:require('../src/core/history-export'),Blob,URL:{createObjectURL:blob=>{downloads.push(blob);return 'blob:export';},revokeObjectURL(){}},document:{body:{appendChild(){}},querySelector:element,querySelectorAll:()=>[],createElement:tag=>tag==='a'?{click(){},remove(){}}:({innerHTML:'',content:{childNodes:[]}})},
    chrome:{runtime:{sendMessage:async msg=>{
      if(msg.type==='GET_STATE'){if(deferredGet){const p=deferredGet;deferredGet=null;return p;}return {state};}
      if(msg.type==='HISTORY_READ'){historyReads.push(msg);return {ok:true,events:state.events||[]};}
      sent.push(msg);if(reply instanceof Error)throw reply;
      if(reply.ok)state.pendingAutoActions=[];
      return reply;
    }}},setInterval(fn){timer=fn;},setTimeout(fn,delay){const id=++timeoutId;timeouts.set(id,{fn,delay});return id;},clearTimeout(id){timeouts.delete(id);},alert(){throw Error('Unexpected blocking alert');}};
  vm.createContext(ctx);vm.runInContext(fs.readFileSync('src/ui/dashboard.js','utf8'),ctx);
  ctx.updateCdr=html=>{element('#cdr-monitor').innerHTML=html;};
  return {state,sent,historyReads,downloads,element,render:ctx.render,deferGet(p){deferredGet=p;},captureGroups(){ctx.updateGroups=html=>{element('#groups').innerHTML=html;};},patchChildren:ctx.patchChildren,manualStatusControl:ctx.manualStatusControl,timeouts,setReply(r){reply=r;},async tick(){timer();await new Promise(setImmediate);},async ready(){await new Promise(setImmediate);}};
}
test('Toolbar CONFIRM opens deferred popup and never changes status by itself',async()=>{
  const d=dashboard();await d.ready();assert.equal(d.element('#block-dialog').open,true);
  d.element('#block-later').onclick();await d.tick();assert.equal(d.element('#block-dialog').open,false);
  await d.element('#open-confirmation').onclick();assert.equal(d.element('#block-dialog').open,true);
  assert.equal(d.sent.length,0);
});
test('Confirmation remains clickable after repeated dashboard refreshes and sends exact target',async()=>{
  const d=dashboard();await d.ready();for(let i=0;i<5;i++)await d.tick();
  await d.element('#block-confirm').onclick();
  assert.equal(d.sent.length,1);assert.equal(d.sent[0].type,'CONFIRM_AUTO_BLOCK');
  assert.equal(d.sent[0].phone,'phone');assert.equal(d.sent[0].incidentId,'incident');
  assert.equal(d.element('#block-confirm').disabled,false);
});
test('Rejected confirmation shows error and re-enables buttons',async()=>{
  const d=dashboard();await d.ready();d.setReply({ok:false,error:'ACTIVE changed'});
  await d.element('#block-confirm').onclick();await d.tick();
  assert.equal(d.element('#confirmation-status').textContent,'ACTIVE changed');
  assert.equal(d.element('#block-confirm').disabled,false);assert.equal(d.element('#block-dialog').open,false);
  await d.element('#open-confirmation').onclick();assert.equal(d.element('#block-dialog').open,true);
});
test('Lost connection shows actionable error instead of leaving confirmation disabled',async()=>{
  const d=dashboard();await d.ready();d.setReply(Error('Extension invalidated'));
  await d.element('#block-confirm').onclick();
  assert.match(d.element('#confirmation-status').textContent,/Mất kết nối/);
  assert.equal(d.element('#block-confirm').disabled,false);
});
test('Toolbar gives feedback when AUTO is off or there is no pending action',async()=>{
  const d=dashboard();await d.ready();d.state.autoEnabled=false;
  await d.element('#open-confirmation').onclick();assert.match(d.element('#confirmation-status').textContent,/OFF/);
  assert.equal(d.element('#block-dialog').open,false);assert.equal(d.sent.length,0);
});
test('Scheduled pause closes confirmation popup and explains why BLOCK is unavailable',async()=>{
  const d=dashboard();await d.ready();
  d.state.pendingAutoActions[0].group='99.155';
  d.state.schedule={groups:{'99.155':{paused:true,phase:'HANDOFF',startAt:'11:30'}}};
  await d.tick();assert.equal(d.element('#block-dialog').open,false);
  assert.match(d.element('#summary').innerHTML,/không tiếp quản/);
  await d.element('#open-confirmation').onclick();
  assert.match(d.element('#confirmation-status').textContent,/11:40–13:00/);
  assert.equal(d.sent.length,0);
});
test('Test BLOCK FS01 control is removed from dashboard',()=>{
 assert.doesNotMatch(fs.readFileSync('src/ui/dashboard.html','utf8'),/id="test-fs01"|id="test-dialog"/);
});
test('Transient notice expires after 30 seconds',async()=>{
 const d=dashboard();await d.ready();d.element('#block-later').onclick();
 assert.equal(d.timeouts.size,1);const timeout=[...d.timeouts.values()][0];
 assert.equal(timeout.delay,30000);timeout.fn();assert.equal(d.element('#confirmation-status').textContent,'');
});
test('Choosing automatic requires mode confirmation then sends mode change',async()=>{
  const d=dashboard();await d.ready();
  await d.element('#auto-block-mode').onchange({target:{value:'AUTOMATIC'}});
  assert.equal(d.element('#auto-mode-dialog').open,true);assert.equal(d.sent.length,0);
  await d.element('#auto-mode-confirm').onclick();
  assert.equal(d.sent[0].type,'SET_AUTO_BLOCK_MODE');assert.equal(d.sent[0].mode,'AUTOMATIC');
});
test('Choosing manual mode sends switch back without a block action',async()=>{
  const d=dashboard();await d.ready();await d.element('#auto-block-mode').onchange({target:{value:'MANUAL'}});
  assert.equal(d.sent[0].type,'SET_AUTO_BLOCK_MODE');assert.equal(d.sent[0].mode,'MANUAL');
});
function fakeNode(name,children=[],text=null){
  return {nodeName:name,nodeType:text===null?1:3,nodeValue:text,childNodes:children,attributes:[],
    hasAttribute(){return false;},getAttribute(){return null;},removeAttribute(){},setAttribute(){},
    cloneNode(){return fakeNode(name,this.childNodes.map(n=>n.cloneNode()),this.nodeValue);},
    appendChild(n){this.childNodes.push(n);},replaceChild(n,old){this.childNodes[this.childNodes.indexOf(old)]=n;},
    removeChild(n){this.childNodes.splice(this.childNodes.indexOf(n),1);},get lastChild(){return this.childNodes.at(-1);}};
}
test('Table updates preserve scroll container identity and horizontal position',async()=>{
  const d=dashboard();await d.ready();
  const cell=fakeNode('TD',[fakeNode('#text',[],'500')]);
  const wrap=fakeNode('DIV',[fakeNode('TABLE',[fakeNode('TR',[cell])])]);wrap.scrollLeft=280;
  const target=fakeNode('DIV',[wrap]);
  const source=fakeNode('DIV',[fakeNode('DIV',[fakeNode('TABLE',[fakeNode('TR',[fakeNode('TD',[fakeNode('#text',[],'100')])])])])]);
  for(let i=0;i<5;i++)d.patchChildren(target,source);
  assert.equal(target.childNodes[0],wrap);assert.equal(wrap.scrollLeft,280);
  assert.equal(cell.childNodes[0].nodeValue,'100');
});
test('Confirm control only appears for pending manual requests',async()=>{
  const d=dashboard();await d.ready();
  assert.equal(d.element('#open-confirmation').hidden,false);
  assert.equal(d.element('#open-confirmation').textContent,'Xác nhận BLOCK (1)');
  d.state.pendingAutoActions=[];await d.tick();assert.equal(d.element('#open-confirmation').hidden,true);
  d.state.autoBlockMode='AUTOMATIC';await d.tick();assert.equal(d.element('#open-confirmation').hidden,true);
});

test('17:00-18:00 hides active Collection schedule and shows Sale overnight pause',async()=>{
  const d=dashboard();await d.ready();d.state.schedule={groups:{
    '99.153':{paused:false},'99.155':{paused:true,phase:'DAY_END',startAt:'17:00'}
  }};await d.tick();
  const html=d.element('#summary').innerHTML;
  assert.doesNotMatch(html,/Collection/);assert.doesNotMatch(html,/18:00–08:00/);
  assert.match(html,/Sale · dừng qua đêm 17:00–08:00/);
});
test('After 18:00 both overnight pause notices are visible',async()=>{
  const d=dashboard();await d.ready();d.state.schedule={groups:{
    '99.153':{paused:true,phase:'DAY_END',startAt:'18:00'},'99.155':{paused:true,phase:'DAY_END',startAt:'17:00'}
  }};await d.tick();
  const html=d.element('#summary').innerHTML;
  assert.match(html,/Collection · dừng qua đêm 18:00–08:00/);
  assert.match(html,/Sale · dừng qua đêm 17:00–08:00/);
});
test('Schedule card does not say monitoring is active when user switched it off',async()=>{
  const d=dashboard();await d.ready();d.state.monitoringEnabled=false;
  d.state.schedule={groups:{'99.153':{paused:false},'99.155':{paused:false}}};await d.tick();
  const html=d.element('#summary').innerHTML;
  assert.doesNotMatch(html,/Collection/);assert.doesNotMatch(html,/trong giờ giám sát/);assert.match(html,/Monitoring is manually OFF/);
});

test('History filters Vietnam day, counts successful incidents once, and paginates eight logs',async()=>{
  const d=dashboard();await d.ready();const now=Date.now();
  d.state.events=Array.from({length:10},(_,i)=>({type:'AUTO_BLOCKED',at:now-i*1000,fs:'FS05',group:'99.155',incidentId:`id${i}`,phone:`phone${i}`}));
  d.state.events.push({type:'BLOCKED_OBSERVED',at:now,fs:'FS05',group:'99.155',incidentId:'id0'});
  d.state.events.push({type:'AUTO_FAILED',at:now,fs:'FS07',group:'99.155',incidentId:'failure',detail:'should be hidden'});
  d.state.events.push({type:'TEST_BLOCKED',at:now,fs:'FS01',group:'99.153',incidentId:'test'});
  d.state.events.push({type:'AUTO_BLOCKED',at:now-4*86400000,fs:'FS01',group:'99.153',incidentId:'expired'});
  await d.element('#history-all').onclick();await d.tick();
  assert.match(d.element('#history-stats').innerHTML,/Tổng: 11/);
  assert.doesNotMatch(d.element('#history-logs').innerHTML,/should be hidden|TEST_BLOCKED|AUTO_FAILED/);
  assert.equal(fs.readFileSync('src/ui/dashboard.html','utf8').includes('FS NGHI NGỜ BỊ BLOCK'),false);
  assert.match(d.element('#history-page').textContent,/Trang 1\/2 · 11 log/);
  assert.equal((d.element('#history-logs').innerHTML.match(/class="event"/g)||[]).length,8);
  await d.element('#history-pages').onclick({target:{closest:()=>({dataset:{historyPage:'2'}})}});await d.tick();
  assert.equal((d.element('#history-logs').innerHTML.match(/class="event"/g)||[]).length,3);
  d.element('#history-date').value='2000-01-01';await d.element('#history-date').onchange();await d.tick();
  assert.match(d.element('#history-page').textContent,/Trang 1\/1 · 0 log/);
  assert.match(d.element('#history-stats').innerHTML,/Tổng: 0/);
});

test('History pagination stays compact for 100 pages and supports direct jump and first page',async()=>{
  const d=dashboard();await d.ready();const now=Date.now();
  d.state.events=Array.from({length:800},(_,i)=>({type:'AUTO_BLOCKED',at:now-i,fs:'FS05',group:'99.155',incidentId:`page-${i}`}));
  await d.element('#history-all').onclick();await d.tick();
  d.element('#history-jump').value='50';
  let prevented=false;d.element('#history-jump-form').onsubmit({preventDefault(){prevented=true;}});await d.tick();
  assert.equal(prevented,true);assert.match(d.element('#history-page').textContent,/Trang 50\/100/);
  const buttons=d.element('#history-pages').innerHTML;
  assert.match(buttons,/data-history-page="1"/);assert.match(buttons,/data-history-page="100"/);
  assert.match(buttons,/…/);assert.ok((buttons.match(/<button/g)||[]).length<=7);
  assert.match(buttons,/data-history-page="50"[^>]*aria-current="page"/);
  d.element('#history-jump').value='101';d.element('#history-jump-form').onsubmit({preventDefault(){}});await d.tick();
  assert.match(d.element('#history-page').textContent,/Trang 50\/100/);
  d.element('#history-jump').value='100';d.element('#history-jump-form').onsubmit({preventDefault(){}});await d.tick();
  assert.match(d.element('#history-page').textContent,/Trang 100\/100/);
  d.element('#history-pages').onclick({target:{closest:()=>({dataset:{historyPage:'1'}})}});await d.tick();
  assert.match(d.element('#history-page').textContent,/Trang 1\/100/);
  assert.match(d.element('#history-logs').innerHTML,/class="log-time"/);
});

test('Summary never claims no suspected when SUSPECTED is excluded by routing/staleness guards',async()=>{
 const d=dashboard();await d.ready();
 const key='99.155|FS05|10.10.101.58';
 d.state.fsStates={[key]:{fs:'FS05',group:'99.155',state:'SUSPECTED'}};
 d.state.alerts=[];d.state.processingStatus={[key]:'BACKUP ≤ ngưỡng: chờ xác nhận THAY FS.'};
 await d.tick();assert.match(d.element('#summary').innerHTML,/FS05.*chờ xác nhận THAY FS/);
 assert.doesNotMatch(d.element('#summary').innerHTML,/No suspected block detected/);
});

for(const [groupId,vt,paused,label] of [[3,7,false,'LEARNING'],[3,0,false,'WAITING_VT'],[3,7,true,'PAUSED'],[0,31,false,'INACTIVE'],[null,31,false,'UNKNOWN_GROUP']])test(`Sale dashboard distinguishes ${label} from inactive`,async()=>{
 const d=dashboard();await d.ready();d.captureGroups();const group='99.155',key=group+'|FS06|ip';
 d.state.opensips[group]={nodes:[{fs:'FS06',ip:'ip',groupId,used:vt,capacity:1000}]};
 d.state.fsStates[key]={state:'INACTIVE',groupId,healthyHistory:[vt],updatedAt:Date.now()};
 d.state.schedule={groups:{[group]:{paused}}};await d.tick();
 assert.match(d.element('#groups').innerHTML,new RegExp('>'+label+'<'));
 if(groupId===3&&!paused)assert.doesNotMatch(d.element('#groups').innerHTML,/>INACTIVE</);
});

test('Clear history opens date/time selection and sends only that range after explicit click',async()=>{
 const d=dashboard();await d.ready();d.element('#history-date').value='2026-10-09';d.element('#history-date').onchange();
 d.element('#clear').onclick();assert.equal(d.sent.length,0);assert.equal(d.element('#clear-history-dialog').open,true);
 assert.equal(d.element('#clear-history-date').value,'2026-10-09');
 d.element('#clear-history-start').value='09:00';d.element('#clear-history-end').value='10:30';
 await d.element('#clear-history-confirm').onclick();
 assert.deepEqual(JSON.parse(JSON.stringify(d.sent[0])),{type:'CLEAR_HISTORY',date:'2026-10-09',startTime:'09:00',endTime:'10:30'});
 assert.equal(d.element('#clear-history-dialog').open,false);
});
test('Clear history cancellation and reversed hours never send delete',async()=>{
 const d=dashboard();await d.ready();d.element('#clear').onclick();d.element('#clear-history-cancel').onclick();
 assert.equal(d.sent.length,0);d.element('#clear').onclick();d.element('#clear-history-start').value='11:00';d.element('#clear-history-end').value='10:00';
 await d.element('#clear-history-confirm').onclick();assert.equal(d.sent.length,0);assert.equal(d.element('#clear-history-dialog').open,true);
});

test('Manual popup suppresses stale queued peer during group observation and missing fresh samples',async()=>{
 const d=dashboard();await d.ready();const a=d.state.pendingAutoActions[0];
 const now=Date.now();d.state.groupTrials={[a.group]:{until:now+6000,completedAt:now,peers:{[a.key]:0}}};
 await d.tick();assert.equal(d.element('#block-dialog').open,false);
 await d.element('#open-confirmation').onclick();assert.equal(d.element('#block-dialog').open,false);
 d.state.groupTrials[a.group].until=now-1;
 await d.tick();assert.equal(d.element('#block-dialog').open,false,'timer alone is not enough');
 d.state.fsStates[a.key].history=[{time:now+1000,vt:0},{time:now+2000,vt:0}];
 await d.tick();assert.equal(d.element('#block-dialog').open,true);
});
test('Dashboard ignores an old pending snapshot arriving after manual confirmation',async()=>{
 const d=dashboard();await d.ready();const old=structuredClone(d.state);
 let resolve;d.deferGet(new Promise(r=>{resolve=r;}));
 const pending=d.render();
 await d.element('#block-confirm').onclick();
 resolve({state:old});await pending;await d.tick();
 assert.equal(d.element('#block-dialog').open,false);assert.equal(d.sent.length,1);
});

test('VT-only suspicion displays WAITING_CDR and does not instruct changing a number manually',async()=>{
 const d=dashboard();d.state.config.cdrVerificationEnabled=true;
 const a=d.state.pendingAutoActions[0];d.state.pendingAutoActions=[];
 d.state.fsStates[a.key]={state:'SUSPECTED',currentVt:60,baseline:600,recentMedian:60,incident:{id:'incident'},cdrStatus:'CDR 1/5 cuộc liên tiếp 480 / 0 / 0'};
 d.state.opensips={'99.153':{nodes:[{fs:'FS03',ip:'ip',groupId:2,used:60}]}};
 d.state.alerts=[{...a,currentVt:60}];d.state.autoEnabled=false;
 d.captureGroups();await d.ready();await d.tick();
 assert.match(d.element('#groups').innerHTML,/WAITING_CDR/);
 assert.match(d.element('#groups').innerHTML,/CDR 1\/5/);
 assert.doesNotMatch(d.element('#summary').innerHTML,/ACTION REQUIRED/);
 assert.equal(d.element('#block-dialog').open,false);
});

test('Separate observational CDR table shows 4 errors and confirmed BLOCK without changing action policy',async()=>{
 const d=dashboard();d.state.config.cdrObservationEnabled=true;d.state.config.cdrVerificationEnabled=false;
 const a=d.state.pendingAutoActions[0];d.state.pendingAutoActions=[];
 d.state.fsStates[a.key]={state:'COOLDOWN',incident:{id:'incident',locked:true},cdr:{incidentId:'incident',count:5,consecutiveTotal:6,locked:true,checkedAt:Date.now()},cdrBlockOutcome:{incidentId:'incident',confirmed:true,mode:'AUTOMATIC',at:Date.now()-1000,cdrCountAtBlock:5}};
 d.state.opensips={'99.153':{nodes:[{fs:'FS03',ip:'ip',groupId:2,used:60}]}};
 d.captureGroups();await d.ready();await d.tick();
 const html=d.element('#groups').innerHTML;
 assert.doesNotMatch(d.element('#groups').innerHTML,/<th>CDR<\/th>/);
 assert.match(html,/<th>Dãy CDR<\/th>/);assert.match(html,/6\/5 liên tiếp/);
 assert.doesNotMatch(html,/<th>Thông tin \/ BLOCK<\/th>/);
 assert.doesNotMatch(html,/<th>Cuộc gọi \/ giây<\/th>/);
 assert.doesNotMatch(html,/WAITING_CDR/);
});
test('CDR errors and uncertain writes never appear as confirmed BLOCK',async()=>{
 const d=dashboard(),a=d.state.pendingAutoActions[0];d.state.config.cdrObservationEnabled=true;d.state.pendingAutoActions=[];
 d.state.fsStates[a.key]={state:'SUSPECTED',incident:{id:'incident',locked:true,actionUncertain:true},cdr:{incidentId:'incident',count:0,locked:false,reason:'CDR tab closed',checkedAt:Date.now()}};
 d.state.opensips={'99.153':{nodes:[{fs:'FS03',ip:'ip',groupId:2,used:60}]}};
 d.captureGroups();await d.ready();await d.tick();
 assert.match(d.element('#groups').innerHTML,/ACK_MANUAL_AFTER_FAILURE/);
 assert.doesNotMatch(d.element('#groups').innerHTML,/BLOCK: đã xác nhận/);
});

test('Continuous CDR table only includes routed FS and shows latest received call',async()=>{
 const d=dashboard();d.state.pendingAutoActions=[];
 d.state.opensips={'99.155':{nodes:[{fs:'FS05',ip:'active-ip',groupId:3,used:0},{fs:'FS07',ip:'inactive-ip',groupId:0,used:31}]}};
 d.state.fsStates={'99.155|FS05|active-ip':{cdr:{count:0,traffic:{latest:{time:Date.now()-1000,count:12},buckets:[{time:Date.now()-1000,count:12}]},receivedCalls:8,records:[{sipCode:480,setupTime:0,duration:0,time:Date.now()},{sipCode:487,setupTime:5,duration:0,time:Date.now()},{sipCode:200,setupTime:2,duration:34,time:Date.now()}],lastCall:{sipCode:480,setupTime:1,duration:0,time:Date.now()},checkedAt:Date.now()}}};
 d.captureGroups();await d.ready();await d.tick();
 const html=d.element('#groups').innerHTML;
 assert.match(html,/FS05/);assert.match(html,/FS07/);assert.match(html,/FS không hoạt động/);
 assert.match(html,/480-0-0/);assert.match(html,/487-5-0/);assert.match(html,/200-2-34/);
 assert.doesNotMatch(html,/<th>Cuộc gọi \/ giây<\/th>/);
 assert.doesNotMatch(html,/Nhận 8 cuộc/);
 assert.match(d.element('#groups').innerHTML,/FS07/);
});

test('Unified CDR table restores VT and removes analysis columns and displays only three returned records',async()=>{
 const d=dashboard();d.state.pendingAutoActions=[];
 d.state.opensips={'99.155':{nodes:[{fs:'FS05',ip:'active-ip',groupId:3,used:100}]}};
 d.state.fsStates={'99.155|FS05|active-ip':{state:'HEALTHY',cdr:{checkedAt:Date.now(),count:0,records:Array.from({length:12},(_,i)=>({sipCode:480,setupTime:0,duration:i,time:Date.now()}))}}};
 d.captureGroups();await d.ready();await d.tick();
 const html=d.element('#groups').innerHTML;
 for(const name of ['Baseline','Recent','Drop','Thông tin / BLOCK','Cuộc gọi / giây'])assert.doesNotMatch(html,new RegExp('<th>'+name+'</th>'));
 assert.match(html,/<th>VT<\/th>/);assert.match(html,/100\/—/);assert.match(html,/<th>Dãy CDR<\/th>/);assert.match(html,/480-0-2/);assert.doesNotMatch(html,/480-0-3/);
});
test('Each group keeps a labelled scrollable table at narrow widths',async()=>{
 const d=dashboard();await d.ready();d.captureGroups();
 d.state.config.cdrRequireVtDrop=true;
 d.state.opensips={'99.153':{nodes:[{fs:'FS03',ip:'ip',groupId:2,used:100,capacity:1000,description:'Collection'}]}};
 d.state.fsStates['99.153|FS03|ip'].baseline=600;
 await d.render();const html=d.element('#groups').innerHTML;
 for(const label of ['FS','IP','VT','Trạng thái','Dãy CDR','Liên tiếp','Xử lý','Profile'])assert.ok(html.includes(`data-label="${label}"`));
 assert.match(html,/Baseline: 600/);
 const css=fs.readFileSync('src/ui/dashboard.html','utf8');assert.doesNotMatch(css,/content:attr\(data-label\)/);assert.match(css,/overflow-x:auto/);assert.match(css,/grid-template-columns:minmax\(0,1fr\)/);
});
test('FS names show remaining backups for matching node and profile',async()=>{
 const d=dashboard();await d.ready();d.captureGroups();
 d.state.opensips={'99.153':{nodes:[{fs:'FS03',ip:'ip',groupId:2,used:100,description:'Collection'}]}};
 d.state.freeswitch={numbers:[{fs:'FS03',profile:'COLLECTION',status:'BACKUP'},{fs:'FS03',profile:'COLLECTION',status:'BACKUP'},{fs:'FS03',profile:'COLLECTION',status:'ACTIVE'},{fs:'FS03',profile:'TELESALE',status:'BACKUP'},{fs:'FS04',profile:'COLLECTION',status:'BACKUP'}]};
 await d.render();assert.match(d.element('#groups').innerHTML,/FS03 \(2\)/);
 d.state.freeswitch.numbers=[];await d.render();assert.match(d.element('#groups').innerHTML,/FS03 \(0\)/);
 delete d.state.freeswitch;await d.render();assert.match(d.element('#groups').innerHTML,/FS03 \(—\)/);
});
test('Special CDR warning log shows pattern, FS and group at top of dashboard',async()=>{
 const d=dashboard();await d.ready();d.state.cdrWarnings=[{fs:'FS07',ip:'10.10.101.88',group:'99.155',pattern:'487-32-0',count:5,at:Date.now()}];
 await d.render();const html=d.element('#summary').innerHTML;
 assert.match(html,/CẢNH BÁO CDR ĐẶC BIỆT/);assert.match(html,/FS07 · Sale/);assert.match(html,/487-32-0/);assert.match(html,/5 cuộc liên tiếp/);
});
test('Latched manual confirmation remains open while group evaluation temporarily blocks execution',async()=>{
 const d=dashboard();await d.ready();const a=d.state.pendingAutoActions[0];
 d.state.fsStates[a.key].incident={id:a.incidentId,manualCdrProof:{count:5}};
 d.state.groupTrials={[a.group]:{until:Date.now()+9000,peers:{[a.key]:50}}};
 a.canConfirm=false;a.waitReason='Chờ đánh giá nhóm';
 for(let i=0;i<4;i++)await d.tick();
 assert.equal(d.element('#block-dialog').open,true);assert.equal(d.element('#block-confirm').disabled,true);
 assert.match(d.element('#block-details').innerHTML,/Chờ đánh giá nhóm/);
 a.canConfirm=true;await d.tick();assert.equal(d.element('#block-dialog').open,true);assert.equal(d.element('#block-confirm').disabled,false);
});
test('Backup summary display survives empty or ACTIVE-only number inventory, and accepts a confirmed zero',async()=>{
 const d=dashboard();await d.ready();d.captureGroups();
 d.state.opensips={'99.153':{nodes:[{fs:'FS03',ip:'ip',groupId:2,used:100}]}};
 d.state.freeswitch={numbers:[],backupCounts:{FS03:{count:12,updatedAt:Date.now(),source:'SUMMARY'}}};
 await d.render();assert.match(d.element('#groups').innerHTML,/FS03 \(12\)/);
 d.state.freeswitch.numbers=[{fs:'FS03',profile:'COLLECTION',status:'ACTIVE'}];
 await d.render();assert.match(d.element('#groups').innerHTML,/FS03 \(12\)/);
 d.state.freeswitch.backupCounts.FS03.count=0;await d.render();assert.match(d.element('#groups').innerHTML,/FS03 \(0\)/);
});

test('Excel button exports every selected-date log rather than the visible history page',async()=>{
 const d=dashboard();await d.ready();
 d.state.events=Array.from({length:600},(_,i)=>({type:'AUTO_BLOCKED',fs:'FS01',group:'99.153',incidentId:'export-'+i,phone:'0866479480',at:Date.parse('2026-10-18T12:00:00+07:00')+i}));
 d.element('#history-date').value='2026-10-18';d.element('#history-date').onchange();
 await d.element('#history-export').onclick();
 assert.equal(d.historyReads.at(-1).date,'2026-10-18');assert.equal(d.downloads.length,1);
 assert.match(d.element('#history-export-status').textContent,/600 lượt/);
 assert.equal(d.element('#history-export').disabled,false);
 assert.equal(d.downloads[0].type,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
});
test('Paused active FS reports scheduled resumption instead of claiming baseline learning',async()=>{
 const d=dashboard();d.state.pendingAutoActions=[];d.state.fsStates={'99.153|FS03|10.10.101.184':{state:'INACTIVE',groupId:2,baseline:null,healthyHistory:[]}};
 d.state.config={detectionSource:'CDR',cdrRequireVtDrop:true,baselineSamples:20,staleMs:45000};
 d.state.schedule={groups:{'99.153':{paused:true,resumeAt:'13:00'}}};d.state.opensips={'99.153':{nodes:[{fs:'FS03',ip:'10.10.101.184',groupId:2,used:0,capacity:1000}]}};
 await d.ready();d.captureGroups();await d.render(d.state);const html=d.element('#groups').innerHTML;assert.match(html,/PAUSED/);assert.match(html,/xét lại VT\/CDR từ 13:00/);assert.doesNotMatch(html,/Đang học baseline VT/);
});
test('13:00 CDR check displays its two-read progress and stops showing after a confirmed change',async()=>{
 const d=dashboard(),at=Date.now()-2000,key='99.153|FS03|10.10.101.184';d.state.pendingAutoActions=[];
 const f={state:'SUSPECTED',groupId:2,groupIdAt:Date.now(),baseline:null,healthyHistory:[],scheduledCdrAt:at,incident:{id:'resume',scheduledResume:true,cdrConfirmationReads:1}};
 d.state.fsStates={[key]:f};d.state.config={detectionSource:'CDR',cdrRequireVtDrop:true,baselineSamples:20,staleMs:45000};d.state.schedule={groups:{'99.153':{paused:false}}};d.state.opensips={'99.153':{nodes:[{fs:'FS03',ip:'10.10.101.184',groupId:2,used:0,capacity:1000}]}};
 await d.ready();d.captureGroups();await d.render(d.state);assert.match(d.element('#groups').innerHTML,/Kiểm tra CDR mới sau 13:00 · 1\/2/);
 f.lastIncident={switchedAt:at+1000,autoExecuted:true};f.incident=null;f.state='HEALTHY';await d.render(d.state);assert.doesNotMatch(d.element('#groups').innerHTML,/Kiểm tra CDR mới sau 13:00/);
});

for(const ok of [true,false])test(`Manual phone status ${ok?'success':'failure'} sends exact target, releases focus and shows an inline result`,async()=>{
 const d=dashboard();await d.ready();d.setReply(ok?{ok:true}:{ok:false,error:'Target changed'});
 let blurred=false;const select={dataset:{fs:'FS05',phone:'123',expected:'ACTIVE'},value:'BACKUP',disabled:false,blur(){blurred=true;},closest(){return this;}};
 await d.element('#groups').change({target:select});assert.equal(blurred,true);assert.equal(select.disabled,false);
 assert.deepEqual(JSON.parse(JSON.stringify(d.sent.at(-1))),{type:'MANUAL_FS_STATUS',fs:'FS05',phone:'123',expectedStatus:'ACTIVE',status:'BACKUP'});
 const html=d.manualStatusControl({freeswitch:{displayNumbers:{FS05:{fs:'FS05',profile:'TELESALE',phone:'123',status:ok?'BACKUP':'ACTIVE'}}}},'FS05','TELESALE');
 assert.match(html,ok?/Đã đổi 123 → BACKUP/:/Target changed/);if(!ok)assert.equal(select.value,'ACTIVE');
});
