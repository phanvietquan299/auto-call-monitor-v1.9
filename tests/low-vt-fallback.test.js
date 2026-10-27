const {test}=require('node:test');
const assert=require('node:assert/strict');
const D=require('../src/core/detection.js');
const now=Date.parse('2026-10-26T09:00:00+07:00');
function fixture(vt=0){
 const f={key:'99.155|FS05|10.10.101.58',group:'99.155',fs:'FS05',ip:'10.10.101.58',groupId:3,groupIdAt:now,currentVt:vt,updatedAt:now,history:[],healthyHistory:[],baseline:null,state:'LEARNING'};
 const s={config:{...D.CONFIG,detectionSource:'CDR',cdrRequireVtDrop:true},monitoringEnabled:true,autoEnabled:true,autoBlockMode:'AUTOMATIC',fsStates:{[f.key]:f},freeswitch:{updatedAt:now,numbers:[{fs:'FS05',profile:'TELESALE',phone:'0901',status:'ACTIVE',hasStatusControl:true}]},events:[],schedule:{groups:{}}};return {s,f};
}
for(const vt of [0,9])test(`VT ${vt} alone never authorizes BLOCK`,()=>{
 const {s,f}=fixture(vt);D.updateCdrStates(s,now);assert.notEqual(f.state,'SUSPECTED');assert.equal(f.incident,undefined);assert.equal(D.cdrGate(s,f,now).ready,false);
});
test('CDR timeout with VT zero cannot authorize BLOCK',()=>{
 const {s,f}=fixture();f.cdr={decision:{error:'timeout',locked:false}};D.updateCdrStates(s,now);assert.notEqual(f.state,'SUSPECTED');assert.equal(D.cdrGate(s,f,now).ready,false);
});
test('old pending VT-only request is rejected and retired even while paused',()=>{
 const {s,f}=fixture();f.incident={id:'legacy',oldPhone:'0901',lowVtFallback:true};f.state='SUSPECTED';s.pendingAutoActions=[{incidentId:'legacy'},{incidentId:'other'}];s.schedule.groups['99.155']={paused:true};
 assert.equal(D.cdrGate(s,f,now).ready,false);D.updateCdrStates(s,now);assert.equal(f.incident,null);assert.equal(f.lastIncident.cancelled,true);assert.deepEqual(s.pendingAutoActions,[{incidentId:'other'}]);
});
for(const field of ['locked','actionPending','actionUncertain','autoExecuted','manualExecuted'])test(`retirement preserves ${field} outcome and prevents duplicate dispatch`,()=>{
 const {s,f}=fixture();f.incident={id:'legacy',oldPhone:'0901',lowVtFallback:true,[field]:true};D.updateCdrStates(s,now);assert.equal(f.incident.id,'legacy');assert.equal(f.incident[field],true);assert.equal(D.cdrGate(s,f,now).ready,false);
});
test('normal VT decline and fresh CDR 5/5 still authorize BLOCK',()=>{
 const {s,f}=fixture();f.baseline=100;f.vtDropAt=now-1000;
 f.cdr={decision:{locked:true,count:5,consecutiveTotal:5,eligibleCount:5,checkedAt:now,newestCallTime:now,phone:'0901',group:f.group,ip:f.ip,callIds:['1','2','3','4','5']}};
 D.updateCdrStates(s,now);assert.equal(f.state,'SUSPECTED');assert.equal(f.incident.lowVtFallback,undefined);assert.equal(D.cdrGate(s,f,now).ready,true);
});
