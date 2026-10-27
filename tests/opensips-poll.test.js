const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
for(const role of ['UNKNOWN','LOAD_BALANCER','CDR'])test(`VT polling remains independent on ${role} page`,async()=>{
 let calls=0,tick,interval,listener;
 const context={location:{hostname:'10.10.99.153',host:'10.10.99.153',protocol:'http:'},OpenSipsPage:{role:()=>role},AbortSignal,
 fetch:async()=>{calls++;throw Error('mock offline');},chrome:{storage:{local:{get:async()=>({})}},runtime:{sendMessage:()=>Promise.resolve(),onMessage:{addListener(fn){listener=fn;}}}},
 setInterval:(fn,ms)=>{tick=fn;interval=ms;},clearInterval(){},addEventListener(){}};
 vm.runInNewContext(fs.readFileSync('src/content/opensips.js','utf8'),context);
 await new Promise(resolve=>setImmediate(resolve));
 const initial=calls;await tick();
 assert.equal(interval,1000);
 assert.equal(initial,role==='CDR'?0:1);
 assert.equal(calls,role==='CDR'?0:2);
 // Background wake still fetches when browser has stopped page timers.
 const response=await new Promise(resolve=>listener({type:'OPENSIPS_POLL_NOW'},{},resolve));
 assert.equal(response.ok,true);assert.equal(calls,role==='CDR'?0:3);
});
