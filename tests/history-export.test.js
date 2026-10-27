const {test}=require('node:test'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const E=require('../src/core/history-export');
const at=Date.parse('2026-10-18T23:59:59+07:00');
const event={at,fs:'FS01',group:'99.153',type:'AUTO_BLOCKED',phone:'0866479480',incidentId:'one',detail:'480-0-0 & <test>'};
test('Export filters by Vietnam date, includes all pages, deduplicates success and excludes failures',()=>{
 const events=[event,{...event,type:'BLOCKED_OBSERVED'},{...event,type:'AUTO_FAILED',incidentId:'failed'},{...event,at:at+1000,incidentId:'next-day'},...Array.from({length:600},(_,i)=>({...event,at:at-i-1,incidentId:'row-'+i}))];
 const result=E.workbook(events,'2026-10-18');assert.equal(result.count,601);assert.equal(result.bytes[0],0x50);assert.equal(result.bytes[1],0x4b);
});
test('Real XLSX opens, preserves phone text and Unicode, uses no formulas and has correct summary',()=>{
 const data=E.workbook([event,{...event,fs:'FS02',phone:'=1+1',incidentId:'two',isBackup:true}],'2026-10-18');
 const script=`import sys,io,zipfile,openpyxl\nb=sys.stdin.buffer.read()\nassert zipfile.ZipFile(io.BytesIO(b)).testzip() is None\nw=openpyxl.load_workbook(io.BytesIO(b),data_only=False)\nassert w.sheetnames==['Lịch sử','Thống kê']\ns=w.worksheets[0]\nassert s.cell(2,6).value=='0866479480'\nassert s.cell(3,6).value=='=1+1' and s.cell(3,6).data_type=='s'\nassert s.cell(2,2).value=='18/10/2026' and s.cell(2,3).value=='23:59:59'\nassert s.cell(2,13).value=='480-0-0 & <test>'\nassert w.worksheets[1].cell(2,4).value==1\nassert w.worksheets[1].cell(3,5).value==1\nprint('XLSX validated')`;
 const r=spawnSync('python3',['-c',script],{input:Buffer.from(data.bytes),encoding:'utf8'});assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/validated/);
});
