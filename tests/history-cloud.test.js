const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function rig(){
 let online=true;const rows=new Map(),remote=new Map();const calls=[];
 const local={append:async events=>{for(const e of events)rows.set(e.id,{...e});},pending:async()=>[...rows.values()].filter(e=>!e.synced),markSynced:async events=>{for(const e of events)rows.get(e.id).synced=true;},read:async()=>[...rows.values()],remove:async(start,end)=>{let count=0;for(const [id,e]of rows)if(e.at>=start&&e.at<end){rows.delete(id);count++;}return count;}};
 const ctx={HistoryDB:local,SupabaseHistoryConfig:{url:'https://test.supabase.co',anonKey:'public',historyToken:'restricted'},Date,AbortSignal,chrome:{alarms:{create(){},onAlarm:{addListener(){}}}},fetch:async(_url,args)=>{
  const p=JSON.parse(args.body);calls.push(p);if(!online)throw Error('offline');
  let result;
  if(p.p_action==='append'){for(const e of p.p_events)remote.set(e.id,{...e});result={saved:p.p_events.length};}
  if(p.p_action==='read')result=[...remote.values()].slice(p.p_offset,p.p_offset+500);
  if(p.p_action==='delete'){let deleted=0;for(const [id,e]of remote)if(e.at>=p.p_start&&e.at<p.p_end){remote.delete(id);deleted++;}result={deleted};}
  return {ok:true,json:async()=>result};
 }};vm.createContext(ctx);vm.runInContext(fs.readFileSync('src/background/history-cloud.js','utf8'),ctx);
 return {ctx,rows,remote,calls,setOnline(value){online=value;}};
}
test('Cloud history flushes old local records, uses restricted credential and keeps offline writes',async()=>{
 const r=rig();await r.ctx.CloudHistory.flush();
 r.rows.set('old',{id:'old',at:1});await r.ctx.CloudHistory.flush();assert.ok(r.remote.has('old'));assert.ok(r.rows.get('old').synced);
 r.setOnline(false);await r.ctx.HistoryDB.append([{id:'new',at:2}]);await r.ctx.CloudHistory.flush();
 assert.ok(r.rows.has('new'));assert.equal(r.rows.get('new').synced,undefined);assert.match(r.ctx.CloudHistory.status().error,/offline/);
 assert.equal(r.calls.at(-1).p_token,'restricted');
});
test('Cloud deletion fails offline without discarding local history; online delete removes both copies',async()=>{
 const r=rig();await r.ctx.CloudHistory.flush();r.rows.set('one',{id:'one',at:10});
 r.setOnline(false);await assert.rejects(r.ctx.HistoryDB.remove(10,11),/offline/);assert.ok(r.rows.has('one'));
 r.setOnline(true);assert.equal(await r.ctx.HistoryDB.remove(10,11),1);assert.equal(r.rows.size,0);assert.equal(r.remote.size,0);
});
