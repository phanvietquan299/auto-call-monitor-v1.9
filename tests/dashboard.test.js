const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
function dashboard(){
  const action={key:'99.153|FS03|ip',incidentId:'incident',phone:'phone',fs:'FS03',group:'99.153',profile:'COLLECTION',ip:'ip'};
  const state={autoEnabled:true,monitoringEnabled:true,mode:'MONITOR',pendingAutoActions:[action],fsStates:{[action.key]:{currentVt:0,baseline:500,recentMedian:0,dropPercent:100}},opensips:{},grafana:{},config:{}};
  const elements=new Map(),sent=[],timeouts=new Map();let timer,reply={ok:true},timeoutId=0,deferredGet=null;
  function element(selector){
    if(!elements.has(selector))elements.set(selector,{textContent:'',innerHTML:'',disabled:false,open:false,childNodes:[],
      addEventListener(type,fn){this[type]=fn;},showModal(){this.open=true;},close(){this.open=false;}});
    return elements.get(selector);
  }
  const ctx={Date,document:{querySelector:element,querySelectorAll:()=>[],createElement:()=>({innerHTML:'',content:{childNodes:[]}})},
    chrome:{runtime:{sendMessage:async msg=>{
      if(msg.type==='GET_STATE'){if(deferredGet){const p=deferredGet;deferredGet=null;return p;}return {state};}
      sent.push(msg);if(reply instanceof Error)throw reply;
      if(reply.ok)state.pendingAutoActions=[];
      return reply;
    }}},setInterval(fn){timer=fn;},setTimeout(fn,delay){const id=++timeoutId;timeouts.set(id,{fn,delay});return id;},clearTimeout(id){timeouts.delete(id);},alert(){throw Error('Unexpected blocking alert');}};
  vm.createContext(ctx);vm.runInContext(fs.readFileSync('dashboard.js','utf8'),ctx);
  return {state,sent,element,render:ctx.render,deferGet(p){deferredGet=p;},captureGroups(){ctx.updateGroups=html=>{element('#groups').innerHTML=html;};},patchChildren:ctx.patchChildren,timeouts,setReply(r){reply=r;},async tick(){timer();await new Promise(setImmediate);},async ready(){await new Promise(setImmediate);}};
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
test('Test FS01 button previews exact phone and confirmation sends separate test action',async()=>{
  const d=dashboard();await d.ready();
  d.setReply({ok:true,preview:{id:'test-id',phone:'fs01-phone',fs:'FS01',profile:'COLLECTION',currentVt:0}});
  await d.element('#test-fs01').onclick();
  assert.equal(d.element('#test-dialog').open,true);
  assert.match(d.element('#test-details').innerHTML,/fs01-phone/);
  assert.equal(d.sent[0].type,'PREVIEW_TEST_BLOCK_FS01');
  d.setReply({ok:true});await d.element('#test-confirm').onclick();
  assert.equal(d.sent[1].type,'CONFIRM_TEST_BLOCK_FS01');
  assert.equal(d.sent[1].testId,'test-id');assert.equal(d.sent[1].phone,'fs01-phone');
  assert.equal(d.element('#test-dialog').open,false);
});

test('Transient test message expires after 30 seconds and new messages replace old timeout',async()=>{
  const d=dashboard();await d.ready();d.setReply({ok:true,preview:{id:'test',phone:'phone'}});
  await d.element('#test-fs01').onclick();d.setReply({ok:true});await d.element('#test-confirm').onclick();
  assert.match(d.element('#confirmation-status').textContent,/Test FS01/);
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
  assert.doesNotMatch(html,/Collection/);assert.doesNotMatch(html,/18:00–09:00/);
  assert.match(html,/Sale · dừng qua đêm 17:00–09:00/);
});
test('After 18:00 both overnight pause notices are visible',async()=>{
  const d=dashboard();await d.ready();d.state.schedule={groups:{
    '99.153':{paused:true,phase:'DAY_END',startAt:'18:00'},'99.155':{paused:true,phase:'DAY_END',startAt:'17:00'}
  }};await d.tick();
  const html=d.element('#summary').innerHTML;
  assert.match(html,/Collection · dừng qua đêm 18:00–09:00/);
  assert.match(html,/Sale · dừng qua đêm 17:00–09:00/);
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
  assert.match(d.element('#history-stats').innerHTML,/Tổng: 10/);
  assert.doesNotMatch(d.element('#history-logs').innerHTML,/should be hidden|TEST_BLOCKED|AUTO_FAILED/);
  assert.equal(fs.readFileSync('dashboard.html','utf8').includes('FS NGHI NGỜ BỊ BLOCK'),false);
  assert.match(d.element('#history-page').textContent,/Trang 1\/2 · 10 log/);
  assert.equal((d.element('#history-logs').innerHTML.match(/class="event"/g)||[]).length,8);
  await d.element('#history-pages').onclick({target:{closest:()=>({dataset:{historyPage:'2'}})}});await d.tick();
  assert.equal((d.element('#history-logs').innerHTML.match(/class="event"/g)||[]).length,2);
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
