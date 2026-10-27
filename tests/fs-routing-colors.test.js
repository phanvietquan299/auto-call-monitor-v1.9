const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const code=fs.readFileSync('src/ui/dashboard.js','utf8');
const ctx={Date,esc:String,manualStatusBusy:new Set(),manualStatusNotes:new Map()};vm.createContext(ctx);
vm.runInContext(code.slice(code.indexOf('function fsRoutingActive('),code.indexOf("document.querySelector('#groups').addEventListener")),ctx);
for(const [profile,group,id] of [['COLLECTION','99.153',2],['TELESALE','99.155',3]])test(profile+' green only for fresh active routing',()=>{
 const state={opensips:{[group]:{updatedAt:Date.now(),nodes:[{fs:'FS01',groupId:id}]}},freeswitch:{updatedAt:Date.now(),numbers:[{fs:'FS01',profile,phone:'123',status:'ACTIVE',hasStatusControl:true}]}};
 assert.match(ctx.manualStatusControl(state,'FS01',profile),/🟢 ACTIVE/);
 state.opensips[group].nodes[0].groupId=0;
 assert.doesNotMatch(ctx.manualStatusControl(state,'FS01',profile),/🟢/);
 assert.match(ctx.manualStatusControl(state,'FS01',profile),/⚪ ACTIVE/);
 state.opensips[group].nodes[0].groupId=id;state.opensips[group].updatedAt=Date.now()-46000;
 assert.doesNotMatch(ctx.manualStatusControl(state,'FS01',profile),/🟢/);
});
for(const state of ['HEALTHY','SUSPECTED','RECOVERING','COOLDOWN','INACTIVE'])test('Manual status remains visible in '+state,()=>{
 const s={fsStates:{k:{state}},freeswitch:{updatedAt:Date.now()-60000,displayNumbers:{FS01:{fs:'FS01',phone:'123',profile:'COLLECTION',status:'ACTIVE',hasStatusControl:true,updatedAt:Date.now()-60000}}}};
 const html=ctx.manualStatusControl(s,'FS01','COLLECTION');
 assert.match(html,/<select/);assert.doesNotMatch(html,/ disabled/);assert.doesNotMatch(html,/Sẽ kiểm tra lại số/);
 s.freeswitch={};const waiting=ctx.manualStatusControl(s,'FS01','COLLECTION');
 assert.match(waiting,/<select/);assert.match(waiting,/disabled/);assert.match(waiting,/Chờ cập nhật số/);
});
test('Cached disabled FreeSWITCH control does not permanently lock manual selector',()=>{
 const html=ctx.manualStatusControl({freeswitch:{displayNumbers:{FS01:{phone:'123',status:'ACTIVE',hasStatusControl:false,updatedAt:Date.now()}}}},'FS01','COLLECTION');
 assert.match(html,/<select/);assert.doesNotMatch(html,/ disabled/);
});
