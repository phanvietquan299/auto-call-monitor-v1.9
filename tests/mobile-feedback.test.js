const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
test('Mobile reports progress immediately and returns completion without waiting for another snapshot',async()=>{
 const elements=new Map();const element=id=>{if(!elements.has(id))elements.set(id,{hidden:true,style:{},setAttribute(){}});return elements.get(id);};
 let reads=0;const notices=[];
 const context={MobileConfig:{anonKey:'public'},localStorage:{getItem:()=> 'session',removeItem(){}},document:{getElementById:element,createElement:()=>{const e={style:{},setAttribute(){}};notices.push(e);return e;},body:{appendChild(){}},addEventListener(){},visibilityState:'visible'},window:{addEventListener(){}},navigator:{},location:{hash:''},Date,URLSearchParams,AbortSignal,crypto:{randomUUID:()=> 'id'},setTimeout:()=>1,clearTimeout(){},fetch:async(url,opts)=>{
  const {p_action}=JSON.parse(opts.body);
  let data;
  if(p_action==='state'){if(++reads>1)return new Promise(()=>{});data={online:true,at:Date.now(),snapshot:{dashboard:{monitoringEnabled:true}}};}
  if(p_action==='command')data={id:'id'};
  if(p_action==='result')data={status:'DONE',result:{ok:true}};
  return {ok:true,json:async()=>data};
 }};
 vm.createContext(context);vm.runInContext(fs.readFileSync('src/mobile/adapter.js','utf8'),context);
 await new Promise(setImmediate);
 const pending=context.chrome.runtime.sendMessage({type:'SET_MONITORING',enabled:false});
 await new Promise(setImmediate);
 const result=await pending;
 assert.equal(result.ok,true);assert.match(notices[0].textContent,/Đã thực hiện/);
 assert.equal(reads,2);
});
