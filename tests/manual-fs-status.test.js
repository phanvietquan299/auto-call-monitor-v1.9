const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function page(){
 let listener,changes=0;
 const select={value:'ACTIVE',disabled:false,options:['ACTIVE','BACKUP','BLOCKED'].map(value=>({value})),dispatchEvent(){changes++;}};
 const td=text=>({tagName:'TD',innerText:text});
 const row={children:[td('0901234567'),td('FS06'),td('TELESALE'),{tagName:'TD',querySelector:()=>select}]};
 const ctx={document:{querySelector:()=>({querySelectorAll:()=>[row]}),querySelectorAll:selector=>selector==='#numbers-tbody > tr'?[row]:[]},chrome:{runtime:{id:'test',sendMessage:()=>Promise.resolve(),onMessage:{addListener:fn=>listener=fn}}},Event:class{},Date,setInterval:()=>1,clearInterval(){}};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync('src/content/freeswitch.js','utf8'),ctx);
 return {select,get changes(){return changes;},send(msg){let result;listener(msg,{},r=>result=r);return result;}};
}
for(const status of ['ACTIVE','BACKUP','BLOCKED'])test('Manual status applies exact phone to '+status,()=>{
 const p=page();p.select.value='BACKUP';
 const r=p.send({type:'MANUAL_FS_STATUS',fs:'FS06',profile:'TELESALE',phone:'0901234567',expectedStatus:'BACKUP',status});
 assert.equal(r.ok,true);assert.equal(p.select.value,status);assert.equal(p.changes,1);
});
test('Manual status rejects changed phone or changed previous status before dispatch',()=>{
 for(const change of [{phone:'different'},{expectedStatus:'BACKUP'},{status:'DELETE'}]){
  const p=page();const r=p.send({type:'MANUAL_FS_STATUS',fs:'FS06',profile:'TELESALE',phone:'0901234567',expectedStatus:'ACTIVE',status:'BLOCKED',...change});
  assert.equal(r.ok,false);assert.equal(r.attempted,false);assert.equal(p.changes,0);
 }
});
