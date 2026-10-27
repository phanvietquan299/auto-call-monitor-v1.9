const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');
function ui(autoBlockEnabled,confirmError=false){
 const elements=new Map(),sent=[];let timer;
 const element=id=>{if(!elements.has(id))elements.set(id,{value:id==='test-node'?'FS03':'',disabled:false,hidden:false,textContent:'',innerHTML:'',open:false,showModal(){this.open=true;},close(){this.open=false;}});return elements.get(id);};
 const ctx={document:{getElementById:element},FsSwitch:{},Date,confirm:()=>false,setInterval(fn){timer=fn;},chrome:{runtime:{sendMessage:async msg=>{
 sent.push(msg);
 if(msg.type==='FS_SWITCH_TEST_CONFIRM'&&confirmError)return {ok:false,error:'Đã Save Group ID, nhưng chưa hoàn tất Reload on Server'};
 if(msg.type==='FS_SWITCH_TEST_PREVIEW')return autoBlockEnabled?{ok:false,error:'Tắt AUTO BLOCK trước khi test bật/tắt riêng.'}:{ok:true,preview:{id:'preview',node:{fs:'FS03',ip:'10.10.101.184'},expected:0,value:2}};
 return {ok:true,autoBlockEnabled,feature:{enabled:false,mode:'MANUAL',history:[]},candidates:[]};
 }}}};vm.createContext(ctx);vm.runInContext(fs.readFileSync('src/ui/fs-switch-dashboard.js','utf8'),ctx);
 return {element,sent,async ready(){await new Promise(setImmediate);},async tick(){timer();await new Promise(setImmediate);}};
}
test('Test button remains clickable and opens OpenSIPS-only confirmation when AUTO BLOCK is OFF',async()=>{
 const d=ui(false);await d.ready();assert.equal(d.element('test-enable').disabled,false);
 await d.element('test-enable').onclick();assert.equal(d.element('test-opensips-dialog').open,true);
 assert.match(d.element('test-opensips-details').innerHTML,/0 → 2/);
 assert.equal(d.sent.filter(x=>x.type==='FS_SWITCH_TEST_CONFIRM').length,0);
});
test('Test button shows the conflict instead of silently disabling, keeping explanation after refresh',async()=>{
 const d=ui(true);await d.ready();assert.equal(d.element('test-enable').disabled,false);
 await d.element('test-enable').onclick();assert.match(d.element('test-status').textContent,/Tắt AUTO BLOCK/);
 await d.tick();assert.match(d.element('test-status').textContent,/Tắt AUTO BLOCK/);assert.equal(d.element('test-opensips-dialog').open,false);
});

test('Failed confirmation closes dialog and exposes partial Save result without cancel or refresh',async()=>{
 const d=ui(false,true);await d.ready();await d.element('test-enable').onclick();
 await d.element('test-opensips-confirm').onclick();
 assert.equal(d.element('test-opensips-dialog').open,false);
 assert.match(d.element('test-status').textContent,/Đã Save Group ID/);
 await d.tick();assert.match(d.element('test-status').textContent,/chưa hoàn tất Reload/);
});
