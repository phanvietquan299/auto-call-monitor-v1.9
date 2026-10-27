const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const ts=require('typescript');
function rig(){let handler;const messages=[],prepared=[];
 const snapshot={monitoring:true,auto:false,blockMode:'MANUAL',feature:{enabled:true,mode:'MANUAL',backupThreshold:6,nextSwitch:{}},fs:[{fs:'FS06',group:'99.155',groupId:3,key:'six',incidentId:'incident'}],pending:[{fs:'FS06',key:'six',incidentId:'incident',phone:'old'}],candidates:[]};
 const ctx={Deno:{env:{get:n=>({TELEGRAM_CHAT_ID:'10',TELEGRAM_BOT_TOKEN:'bot',TELEGRAM_WEBHOOK_SECRET:'webhook',CALL_MONITOR_HISTORY_TOKEN:'restricted',SUPABASE_URL:'https://db',SUPABASE_ANON_KEY:'anon'})[n]},serve:fn=>{handler=fn;}},URL,Response,Date,console:{error(){}},fetch:async(url,options)=>{
 const p=JSON.parse(options.body);let result;
 if(url.includes('api.telegram.org')){messages.push(p);result={ok:true,result:{}};}
 else if(p.p_action==='snapshot')result={online:true,snapshot};
 else if(p.p_action==='prepare'){prepared.push(p.p_payload.command);result={id:'preview'};}
 else result={};return {ok:true,json:async()=>result};
 }};
 const source=ts.transpileModule(fs.readFileSync('supabase/functions/telegram-control/index.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
 vm.createContext(ctx);vm.runInContext(source,ctx);
 return {messages,prepared,async callback(data){return handler({method:'POST',url:'https://edge/webhook',headers:{get:()=> 'webhook'},json:async()=>({callback_query:{id:'cb',from:{id:10},message:{message_id:99,chat:{id:10}},data}})});},async send(text,user=10,secret='webhook'){return handler({method:'POST',url:'https://edge/webhook',headers:{get:()=>secret},json:async()=>({update_id:1,message:{from:{id:user},chat:{id:user},text}})});}};
}
test('Telegram rejects wrong webhook secret and unauthorized user before reading commands',async()=>{
 const r=rig();assert.equal((await r.send('/monitor off',10,'bad')).status,401);assert.equal((await r.send('/monitor off',11)).status,403);assert.equal(r.prepared.length,0);
});
for(const [text,type]of [['/monitor off','SET_MONITORING'],['/block auto','SET_AUTO_BLOCK_MODE'],['/switch off','FS_SWITCH_SETTINGS'],['/threshold 5','FS_SWITCH_THRESHOLD'],['/fs 6 off','FS_SWITCH_TOGGLE_NODE'],['/preset sale 0 7','FS_SWITCH_PRESET'],['/reload col','FS_SWITCH_RELOAD'],['/confirm 6','CONFIRM_AUTO_BLOCK'],['/clear 2026-10-14 09:00 10:00','CLEAR_HISTORY']])test(`Telegram ${text} prepares preview with confirmation, not immediate execution`,async()=>{
 const r=rig();await r.send(text);assert.equal(r.prepared[0].type,type);assert.match(r.messages.at(-1).reply_markup.inline_keyboard[0][0].callback_data,/^ok:/);
});

test('Menu opens compact dashboard with grouped FS and state buttons instead of command list',async()=>{
 const r=rig();await r.send('/menu');const panel=r.messages.at(-1);
 assert.match(panel.text,/COLLECTION/);assert.match(panel.text,/SALE/);assert.doesNotMatch(panel.text,/history YYYY/);
 const labels=panel.reply_markup.inline_keyboard.flat().map(b=>b.text).join(' ');assert.match(labels,/MONITOR/);assert.match(labels,/AUTO BLOCK/);assert.match(labels,/THAY FS/);
});
test('Navigation edits the same message and threshold buttons still prepare confirmation',async()=>{
 const r=rig();await r.callback('view:threshold');const panel=r.messages.at(-1);
 assert.equal(panel.message_id,99);assert.match(panel.text,/NGƯỠNG BACKUP/);
 await r.callback('cmd:/threshold 5');assert.equal(r.prepared[0].type,'FS_SWITCH_THRESHOLD');assert.equal(r.messages.at(-1).message_id,99);
});
test('Preset wizard supports only-enable without immediate mutation',async()=>{
 const r=rig();await r.callback('preset:sale:source');assert.equal(r.prepared.length,0);
 await r.callback('preset:sale:target:0');const buttons=r.messages.at(-1).reply_markup.inline_keyboard.flat();assert.ok(buttons.some(b=>b.callback_data==='cmd:/preset sale 0 7'));assert.equal(r.prepared.length,0);
});
