const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
test('FreeSWITCH reads BACKUP summary separately from a filtered phone inventory',()=>{
 const sent=[],cell=text=>({innerText:text,textContent:text});
 const header={innerText:'NODE ID IP HOST PROFILE ACTIVE BACKUP',children:['NODE ID','IP HOST','PROFILE','ACTIVE','BACKUP'].map(cell)};
 const row={children:['FS07','10.10.101.88','TELESALE','1','12'].map(cell)};
 const table={querySelectorAll:()=>[header,row]};
 const ctx={document:{querySelector:()=>null,querySelectorAll:()=>[table]},chrome:{runtime:{id:'test',sendMessage:msg=>{sent.push(msg);return Promise.resolve();},onMessage:{addListener(){}}}},setInterval(){},Date,Math};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync('src/content/freeswitch.js','utf8'),ctx);
 assert.equal(sent[0].data.backupSummary[0].fs,'FS07');assert.equal(sent[0].data.backupSummary[0].backups,12);assert.equal(sent[0].data.numbers.length,0);
});
