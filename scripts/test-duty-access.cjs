const fs=require('fs'),ts=require('typescript'),assert=require('node:assert/strict')
const source=ts.transpileModule(fs.readFileSync('lib/dutyAccess.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText
const exportsObject={};new Function('exports',source)(exportsObject)
const resolve=exportsObject.dutyAccessBranch
const row={branch:'Paniqui',clockIn:'08:00',clockOut:'',nightBranch:'Guimba',nightClockIn:'',nightClockOut:''}
assert.equal(resolve('Guimba',null),'Guimba')
assert.equal(resolve('Guimba',row),'Paniqui')
assert.equal(resolve('Guimba',{...row,clockOut:'17:00'}),'Guimba')
assert.equal(resolve('Guimba',{...row,clockOut:'17:00',nightClockIn:'17:30'}),'Guimba')
assert.equal(resolve('Guimba',{...row,nightClockIn:'17:30'}),null)
assert.equal(resolve('Guimba',{...row,clockOut:'17:00',nightBranch:null,nightClockIn:'17:30'}),'Paniqui')
console.log('Open-duty branch resolution and fail-closed conflict: PASS')
