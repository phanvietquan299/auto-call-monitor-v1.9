const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
function ui(){
  const elements=new Map(),sent=[];
  let tick;
  const nodes={'99.153':{updatedAt:Date.now(),nodes:[{fs:'FS01',groupId:2},{fs:'FS02',groupId:0}]},'99.155':{updatedAt:Date.now(),nodes:[{fs:'FS05',groupId:3},{fs:'FS06',groupId:0},{fs:'FS07',groupId:3}]}};
  const feature={enabled:false,mode:'MANUAL',history:[]};
  const plan={key:'sale',groupId:3,profile:'TELESALE',source:{fs:'FS05',backups:6},target:{fs:'FS07',backups:20,phone:'0900000000'}};
  const element=id=>{if(!elements.has(id))elements.set(id,{value:'',textContent:'',innerHTML:'',open:false,addEventListener(){},showModal(){this.open=true;},close(){this.open=false;}});return elements.get(id);};
  const ctx={document:{getElementById:element},Date,FsSwitch:{...require('../src/core/fs-switch'),identity:()=> 'exact-plan'},setInterval(fn){tick=fn;},confirm:()=>false,confirmationNotice(){},chrome:{runtime:{sendMessage:async msg=>{
    sent.push(msg);if(msg.type==='FS_SWITCH_SETTINGS')Object.assign(feature,{enabled:msg.enabled,mode:msg.mode});
    return {ok:true,feature,candidates:[plan],nodes};
  }}}};
  vm.createContext(ctx);vm.runInContext(fs.readFileSync('src/ui/dashboard-fs-switch.js','utf8'),ctx);
  return {element,sent,feature,nodes,async tick(){await tick();},async ready(){await new Promise(setImmediate);}};
}
test('Dashboard button toggles full rotation on and off without navigating',async()=>{
  const d=ui();await d.ready();await d.element('fs-switch-open').onclick();
  assert.equal(d.feature.enabled,true);assert.equal(d.element('fs-switch-open').textContent,'THAY FS: ON');
  await d.element('fs-switch-open').onclick();assert.equal(d.feature.enabled,false);
});
test('Sale plan previews without writing and confirms exact full rotation',async()=>{
  const d=ui();await d.ready();await d.element('fs-switch-open').onclick();
  d.element('fs-switch-plans').onclick({target:{closest:()=>({disabled:false,dataset:{switchPlan:'0'}})}});
  assert.equal(d.element('fs-switch-confirm').open,true);
  assert.match(d.element('fs-switch-details').innerHTML,/FS05.*FS07/);
  assert.equal(d.sent.some(m=>m.type==='FS_SWITCH_CONFIRM'),false);
  await d.element('fs-switch-execute').onclick();
  assert.equal(d.sent.find(m=>m.type==='FS_SWITCH_CONFIRM').identity,'exact-plan');
  assert.equal(d.element('fs-switch-confirm').open,false);
});
test('Automatic mode requires accepting its dialog before changing settings',async()=>{
  const d=ui();await d.ready();d.element('fs-switch-mode').value='AUTOMATIC';d.element('fs-switch-mode').onchange();
  assert.equal(d.feature.mode,'MANUAL');assert.equal(d.element('fs-switch-automatic').open,true);
  d.element('fs-switch-auto-confirm').onclick();await d.ready();assert.equal(d.feature.mode,'AUTOMATIC');
});
test('Number controls use Group ID colors and require confirmation',async()=>{
 const d=ui();await d.ready();const html=d.element('fs-node-buttons').innerHTML;
 assert.match(html,/data-node-fs="FS01"[^>]*class="on"/);
 assert.match(html,/data-node-fs="FS02"[^>]*class="off"/);
 assert.match(html,/data-node-fs="FS03"[^>]*disabled/);
 d.element('fs-node-buttons').onclick({target:{closest:selector=>selector==='[data-node-fs]'?({dataset:{nodeFs:'FS01',nodeGroup:'99.153',nodeExpected:'2'}}):null}});
 assert.equal(d.element('fs-node-dialog').open,true);
 assert.equal(d.sent.some(m=>m.type==='FS_SWITCH_TOGGLE_NODE'),false);
 await d.element('fs-node-confirm').onclick();
 const msg=d.sent.find(m=>m.type==='FS_SWITCH_TOGGLE_NODE');
 assert.equal(msg.fs,'FS01');assert.equal(msg.group,'99.153');assert.equal(msg.expected,2);
});

test('Preset options separate active and inactive FS in both groups by Group ID',async()=>{
 const d=ui();await d.ready();
 for(const [group,on,off] of [['99-153','FS01','FS02'],['99-155','FS05','FS06']]){
  assert.match(d.element('preset-source-'+group).innerHTML,new RegExp(on));
  assert.doesNotMatch(d.element('preset-source-'+group).innerHTML,new RegExp(off));
  assert.match(d.element('preset-target-'+group).innerHTML,new RegExp(off));
  assert.doesNotMatch(d.element('preset-target-'+group).innerHTML,new RegExp(on));
 }
 assert.doesNotMatch(d.element('preset-source-99-153').innerHTML,/FS03|FS04/);
});
test('Preset refresh retains eligible choices and clears choices after a Group ID change',async()=>{
 const d=ui();await d.ready();
 const source=d.element('preset-source-99-153'),target=d.element('preset-target-99-153');
 source.value='FS01';target.value='FS02';await d.tick();
 assert.equal(source.value,'FS01');assert.equal(target.value,'FS02');
 d.nodes['99.153'].nodes=[{fs:'FS01',groupId:0,vt:500},{fs:'FS02',groupId:2,vt:0}];await d.tick();
 assert.equal(source.value,'');assert.equal(target.value,'');
 assert.match(source.innerHTML,/FS02/);assert.match(target.innerHTML,/FS01/);
});
test('Preset excludes duplicate, unknown and stale status while preserving blank choice',async()=>{
 const d=ui();await d.ready();
 d.nodes['99.153'].nodes=[{fs:'FS01',groupId:2},{fs:'FS01',groupId:2},{fs:'FS02',groupId:9}];
 d.nodes['99.155'].updatedAt=Date.now()-46000;await d.tick();
 for(const group of ['99-153','99-155'])for(const kind of ['source','target']){
  assert.equal(d.element('preset-'+kind+'-'+group).innerHTML,'<option value="">—</option>');
 }
});
