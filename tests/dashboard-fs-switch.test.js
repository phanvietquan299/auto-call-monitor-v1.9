const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
function ui(){
  const elements=new Map(),sent=[];
  const feature={enabled:false,mode:'MANUAL',history:[]};
  const plan={key:'sale',groupId:3,profile:'TELESALE',source:{fs:'FS05',backups:6},target:{fs:'FS07',backups:20,phone:'0900000000'}};
  const element=id=>{if(!elements.has(id))elements.set(id,{value:'',textContent:'',innerHTML:'',open:false,showModal(){this.open=true;},close(){this.open=false;}});return elements.get(id);};
  const ctx={document:{getElementById:element},FsSwitch:{identity:()=> 'exact-plan'},setInterval(){},confirm:()=>false,confirmationNotice(){},chrome:{runtime:{sendMessage:async msg=>{
    sent.push(msg);if(msg.type==='FS_SWITCH_SETTINGS')Object.assign(feature,{enabled:msg.enabled,mode:msg.mode});
    return {ok:true,feature,candidates:[plan]};
  }}}};
  vm.createContext(ctx);vm.runInContext(fs.readFileSync('dashboard-fs-switch.js','utf8'),ctx);
  return {element,sent,feature,async ready(){await new Promise(setImmediate);}};
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
