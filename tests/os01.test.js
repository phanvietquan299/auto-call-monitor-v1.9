const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const D=require('../src/core/detection'),C=require('../src/core/cdr'),F=require('../src/core/fs-switch'),E=require('../src/core/collection-evening');
test('OS01 belongs to Collection rotation only and CDR maps exact IP',()=>{
 assert.equal(C.IPS.OS01,'10.10.99.140');assert.ok(F.groups['99.153'].fs.includes('OS01'));assert.ok(!F.groups['99.155'].fs.includes('OS01'));
});
test('FreeSWITCH reads OS01 numbers and can dispatch BLOCK on the exact phone',()=>{
 let handler,changes=0;const select={value:'ACTIVE',disabled:false,options:[{value:'ACTIVE'},{value:'BLOCKED'}],dispatchEvent(){changes++;}};
 const row={children:['0901','OS01','COLLECTION'].map(innerText=>({tagName:'TD',innerText})).concat({tagName:'TD',querySelector:()=>select})};
 const ctx={document:{querySelector:()=>({querySelectorAll:()=>[row]}),querySelectorAll:s=>s==='#numbers-tbody > tr'?[row]:[]},chrome:{runtime:{id:'test',sendMessage:async()=>{},onMessage:{addListener:f=>handler=f}}},setInterval:()=>1,clearInterval(){},Event:class{},Date};vm.createContext(ctx);vm.runInContext(fs.readFileSync('src/content/freeswitch.js','utf8'),ctx);
 let read;handler({type:'READ_FS_NUMBERS'},null,r=>read=r);assert.equal(read.numbers[0].fs,'OS01');
 let result;handler({type:'AUTO_BLOCK_FS',fs:'OS01',profile:'COLLECTION',phone:'0901'},null,r=>result=r);assert.equal(result.ok,true);assert.equal(changes,1);
});
test('OS01 VT and fresh CDR participate in Collection detection',()=>{
 const now=Date.parse('2026-10-26T09:00:00+07:00'),key='99.153|OS01|10.10.99.140';
 const f={key,group:'99.153',fs:'OS01',ip:C.IPS.OS01,groupId:2,groupIdAt:now,updatedAt:now,currentVt:0,baseline:100,vtDropAt:now-1000,history:[]};
 const s={config:{...D.CONFIG,detectionSource:'CDR',cdrRequireVtDrop:true},monitoringEnabled:true,fsStates:{[key]:f},schedule:{groups:{}},freeswitch:{numbers:[{fs:'OS01',profile:'COLLECTION',phone:'0901',status:'ACTIVE'}]}};
 f.cdr={decision:{locked:true,count:5,eligibleCount:5,checkedAt:now,newestCallTime:now,phone:'0901',group:f.group,ip:f.ip}};D.updateCdrStates(s,now);assert.equal(f.state,'SUSPECTED');assert.equal(D.groupCandidates(s,'99.153',now)[0],f);
});
test('Collection night schedule includes OS01 and rejects incomplete node lists',()=>{
 const now=Date.parse('2026-10-26T18:05:00+07:00');const nodes=F.groups['99.153'].fs.map((fs,i)=>({fs,ip:C.IPS[fs],destinationId:i+1,resource:'vt',groupId:2}));
 const s={monitoringEnabled:true,collectionEvening:{policy:27,date:'2026-10-26',status:'FINAL_CONFIRMED'},opensips:{'99.153':{updatedAt:now,nodes}}};
 assert.ok(E.next(s,now).disable.some(n=>n.fs==='OS01'));s.opensips['99.153'].nodes=nodes.slice(0,4);assert.equal(E.next(s,now),null);
});
