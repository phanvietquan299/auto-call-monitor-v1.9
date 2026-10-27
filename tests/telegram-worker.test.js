const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function rig(){let remote,bridge,sends=[],completeCalls=0,completeFails=false,publishes=0,noticeFails=false;const state={monitoringEnabled:true,autoEnabled:false,config:{},fsStates:{},events:[]};
 const ctx={Date,URL,crypto:require('node:crypto').webcrypto,AbortSignal,SupabaseHistoryConfig:{url:'https://test.supabase.co',historyToken:'limited',anonKey:'public'},FsSwitch:{plans:()=>[],identity:()=>''},getState:async()=>state,rotationFeature:async()=>({enabled:true,mode:'MANUAL'}),messageQueue:Promise.resolve(),setInterval(){},
 chrome:{alarms:{create(){},onAlarm:{addListener(){}}},storage:{local:{get:async()=>({telegramBridge:bridge}),set:async v=>{if(v.telegramBridge)bridge=structuredClone(v.telegramBridge);}}}},
 handleMainMessage:(m,_s,reply)=>{sends.push(m);reply({ok:true});},processSwitch:async m=>{sends.push(m);return {ok:true};},fetch:async(_url,options)=>{if(_url.includes('/rest/v1/rpc/call_monitor_remote')){assert.equal(new URL(_url).searchParams.get('apikey'),'public');assert.equal(options.headers.apikey,'public');assert.equal(new URL(_url).searchParams.has('p_token'),false);}const p=JSON.parse(options.body);if(p.p_action==='complete'){completeCalls++;if(completeFails)throw Error('offline');return {ok:true,json:async()=>({accepted:true})};}if(p.p_action==='publish'){publishes++;return {ok:true,json:async()=>({})};}if(p.action==='result-notify'){if(noticeFails)throw Error('Telegram offline');return {ok:true,json:async()=>({ok:true})};}if(p.action==='notify')return {ok:true,json:async()=>({command:null})};const command=remote;remote=null;return {ok:true,json:async()=>command};}};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync('src/background/telegram-worker.js','utf8'),ctx);
 return {ctx,sends,get bridge(){return bridge;},get completions(){return completeCalls;},get publishes(){return publishes;},setBridge(value){bridge=value;},setCommand(payload,age=0){remote={id:'command',created_at:Date.now()-age,payload};},setCompleteFails(value){completeFails=value;},setNoticeFails(value){noticeFails=value;},async ready(){await new Promise(setImmediate);}};
}
test('Telegram dispatch uses existing handlers and rejects arbitrary samples',async()=>{
 const r=rig();await r.ready();
 assert.equal((await r.ctx.TelegramBridge.dispatch({type:'OPENSIPS_SAMPLE'})).ok,false);
 await r.ctx.TelegramBridge.dispatch({type:'SET_MONITORING',enabled:false});await r.ctx.TelegramBridge.dispatch({type:'FS_SWITCH_THRESHOLD',value:6});
 assert.deepEqual(r.sends.map(m=>m.type),['SET_MONITORING','FS_SWITCH_THRESHOLD']);
});
test('Expired remote commands never execute; interrupted commands report uncertainty without retry',async()=>{
 const r=rig();await r.ready();r.setCommand({type:'SET_AUTO',enabled:true},91000);await r.ctx.TelegramBridge.tick();assert.equal(r.sends.length,0);
 r.setBridge({...r.bridge,inFlight:{id:'interrupted',payload:{type:'CONFIRM_AUTO_BLOCK'}}});await r.ctx.TelegramBridge.tick();assert.equal(r.sends.length,0);assert.equal(r.bridge.inFlight,undefined);
});
test('Failed result delivery retries only acknowledgement, not the FS action',async()=>{
 const r=rig();await r.ready();r.setCommand({type:'FS_SWITCH_RELOAD',group:'99.153'});r.setCompleteFails(true);await r.ctx.TelegramBridge.tick();assert.equal(r.sends.length,1);assert.ok(r.bridge.ack);
 r.setCompleteFails(false);await r.ctx.TelegramBridge.tick();assert.equal(r.sends.length,1);assert.equal(r.bridge.ack,undefined);
});

test('Snapshot publication continues while a remote FS action waits for its response',async()=>{
 const r=rig();await r.ready();let finish;
 r.ctx.handleMainMessage=(message,_sender,reply)=>{finish=()=>reply({ok:true});};
 r.setCommand({type:'SET_MONITORING',enabled:false});const operation=r.ctx.TelegramBridge.tick();await new Promise(setImmediate);
 const before=r.publishes;await r.ctx.TelegramBridge.publish();assert.equal(r.publishes,before+1);
 finish();await operation;
});

test('Telegram notification failure cannot block a second mobile command',async()=>{
 const r=rig();await r.ready();r.setNoticeFails(true);
 r.setCommand({type:'FS_SWITCH_THRESHOLD',value:6});await r.ctx.TelegramBridge.tick();assert.equal(r.bridge.ack,undefined);
 r.setCommand({type:'FS_SWITCH_PRESET',group:'99.155',source:'FS06',target:'FS07'});await r.ctx.TelegramBridge.tick();
 assert.equal(r.sends.length,2);assert.equal(r.completions,2);assert.equal(r.bridge.ack,undefined);
});

test('Mobile snapshot strips bulky internal CDR traffic while retaining the three displayed records',async()=>{
 const r=rig();await r.ready();
 const observed=Array.from({length:2000},(_,i)=>({callId:'call-'+i+'x'.repeat(40),time:Date.now(),ip:'10.10.101.176'}));
 const records=Array.from({length:50},()=>({sipCode:480,setupTime:0,duration:0,time:Date.now()}));
 const s={monitoringEnabled:true,config:{},fsStates:{one:{fs:'FS01',group:'99.153',cdr:{traffic:{observed},records,decision:{count:5}},cdrUsedCallIds:observed.map(x=>x.callId),history:observed}},events:[]};
 const result=r.ctx.TelegramBridge.snapshot(s,{enabled:true,mode:'MANUAL'});
 assert.equal(result.dashboard.fsStates.one.cdr.traffic,undefined);assert.equal(result.dashboard.fsStates.one.cdr.records.length,3);
 assert.equal(result.dashboard.fsStates.one.cdr.decision.count,5);assert.ok(JSON.stringify(result).length<10000);
});
