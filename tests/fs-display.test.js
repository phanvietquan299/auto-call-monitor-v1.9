const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync('src/background/background.js','utf8');
const code=source.slice(source.indexOf('function updateDisplayNumbers('),source.indexOf('let statusWriteInProgress=false;'));
const ctx={};vm.createContext(ctx);vm.runInContext(code,ctx);
const update=ctx.updateDisplayNumbers;
const row=(phone,status)=>({fs:'FS01',profile:'COLLECTION',phone,status,hasStatusControl:true});
test('Display keeps exact BACKUP phone across filtered samples and never picks another backup',()=>{
 let d=update({},[row('a','ACTIVE')],100);
 d=update(d,[row('a','BACKUP'),row('b','BACKUP')],200,{FS01:'a'});
 assert.equal(d.FS01.phone,'a');assert.equal(d.FS01.status,'BACKUP');
 d=update(d,[row('b','BLOCKED'),row('c','BACKUP')],300,{FS01:'a'});
 assert.equal(d.FS01.phone,'a');assert.equal(d.FS01.status,'BACKUP');assert.equal(d.FS01.updatedAt,200);
});
test('Display replaces BLOCKED number with new ACTIVE, without retaining BLOCKED',()=>{
 let d=update({},[row('a','ACTIVE')],100);
 d=update(d,[row('a','BLOCKED'),row('b','ACTIVE')],200);
 assert.equal(d.FS01.phone,'b');assert.equal(d.FS01.status,'ACTIVE');
 d=update(d,[row('b','BLOCKED')],300);assert.equal(d.FS01,undefined);
});
test('Filter changes neither erase selected active nor populate all FS from arbitrary backups',()=>{
 let d=update({},[row('a','ACTIVE')],100);
 d=update(d,[row('b','BACKUP'),{fs:'FS02',profile:'COLLECTION',phone:'z',status:'BACKUP'}],200);
 assert.equal(d.FS01.phone,'a');assert.equal(d.FS01.updatedAt,100);assert.equal(d.FS02,undefined);
});
