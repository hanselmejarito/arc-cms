const fs=require('node:fs'),ts=require('typescript'),assert=require('node:assert/strict')
const src=fs.readFileSync('lib/staffSignatures.ts','utf8'),start=src.indexOf('export async function auditSavedSignatureUse(')
const js=ts.transpileModule(src.slice(start),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const out={};new Function('exports',js)(out)
let entry;const tx={staffSignature:{findUnique:async()=>({name:'Synthetic Nurse',kind:'Nurse'})},auditLog:{create:async({data})=>{entry=data}}}
;(async()=>{await out.auditSavedSignatureUse(tx,{id:'U',name:'Tester',role:'Admin'},'signer-id','TEST · D3','Guimba','test');assert.match(entry.newValue,/Synthetic Nurse \(Nurse\)/);assert.match(entry.newValue,/signer-id/);assert.match(entry.time,/\d{4}-\d{2}-\d{2} · /);console.log('Saved signature audit identity and time: PASS')})().catch(e=>{console.error(e);process.exitCode=1})
