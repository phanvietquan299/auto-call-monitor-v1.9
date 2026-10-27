const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
test('Next FS Search proceeds while the mutation queue is busy; batch remains reserved',async()=>{
 let release;const reads=[],queue=new Promise(resolve=>{release=resolve;});
 const context={Date,Promise,Cdr:require('../src/core/cdr'),Detection:{isFsActive:()=>true},messageQueue:queue,getState:async()=>({fsStates:{}})};
 vm.createContext(context);vm.runInContext(fs.readFileSync('src/background/cdr-worker.js','utf8'),context);
 context.queryCdr=async(group,name)=>{reads.push(name);return [];};
 const state={config:{cdrObservationEnabled:true,staleMs:45000},fsStates:{a:{key:'a',group:'99.155',fs:'FS05',ip:'10.10.101.58',updatedAt:Date.now()},b:{key:'b',group:'99.155',fs:'FS07',ip:'10.10.101.88',updatedAt:Date.now()}}};
 context.scheduleCdrChecks(state);await new Promise(setImmediate);
 assert.deepEqual(reads,['FS05','FS07']);
 context.scheduleCdrChecks(state);await new Promise(setImmediate);assert.equal(reads.length,2);
 release();await context.messageQueue;await new Promise(setImmediate);
});
test('Stable CDR worker keeps independent call windows rather than filtering by peer actions',async()=>{
 let now=Date.parse('2026-10-22T09:16:33+07:00'),fresh=false;
 const cutoff=now-1000,ip='10.10.101.58',f={key:'a',fs:'FS05',group:'99.155',ip,updatedAt:now};
 const s={monitoringEnabled:false,config:{cdrObservationEnabled:true,staleMs:45000},fsStates:{a:f},groupTrials:{'99.155':{fs:'FS07',completedAt:cutoff}},freeswitch:{numbers:[{fs:'FS05',profile:'TELESALE',status:'ACTIVE',phone:'test'}]}};
 const context={Date:class extends Date{static now(){return now;}},Promise,Cdr:require('../src/core/cdr'),Detection:{isFsActive:()=>true,refreshAlerts(){}},messageQueue:Promise.resolve(),getState:async()=>s,saveState:async()=>{}};
 vm.createContext(context);vm.runInContext(fs.readFileSync('src/background/cdr-worker.js','utf8'),context);
 context.queryCdr=async()=>Array.from({length:5},(_,i)=>({ip,method:'INVITE',callId:'peer-'+now+'-'+i,time:fresh?now-500-i*10:i===0?now-500:cutoff-1000,sipCode:480,setupTime:i%2,duration:0}));
 async function read(){context.scheduleCdrChecks(s);await new Promise(setImmediate);await context.messageQueue;await new Promise(setImmediate);}
 await read();assert.equal(f.cdr.decision.locked,true);assert.equal(f.cdr.decision.count,5);
 fresh=true;now+=2000;await read();assert.equal(f.cdr.decision.locked,true);assert.equal(f.cdr.decision.count,5);assert.equal(f.cdr.decision.oldestConfirmedCallTime,undefined);
});
