const fs=require('node:fs'),ts=require('typescript'),assert=require('node:assert/strict')
const source=ts.transpileModule(fs.readFileSync('lib/staffSignatures.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const out={};let duty='Paniqui'
new Function('require','exports',source)(name=>name==='./nurseDuty.js'?{nursesByDuty:async()=>[{id:'EMP',dutyBranch:duty}]}:require(name),out)
const signer={id:'SIG',active:true,kind:'Nurse',name:'Synthetic Nurse',employeeId:'EMP',image:'synthetic',method:'pen',updatedAt:new Date('2026-01-01T00:00:00Z')}
const tx={$queryRaw:async()=>[],staffSignature:{findUnique:async()=>signer},employee:{findUnique:async()=>({id:'EMP',name:'Synthetic Nurse',role:'Nurse',status:'Active',branch:'Guimba'})},auditLog:{create:async()=>{}}}
;(async()=>{process.env.TEMPORARY_BRANCH_ENABLED='true';const version=signer.updatedAt.toISOString();assert.equal((await out.resolveStaffSignature(tx,'SIG','Nurse','Synthetic Nurse','Paniqui',version)).id,'SIG');await assert.rejects(out.resolveStaffSignature(tx,'SIG','Nurse','Synthetic Nurse','Guimba',version),/active signature/);duty='Guimba';assert.equal((await out.resolveStaffSignature(tx,'SIG','Nurse','Synthetic Nurse','Guimba',version)).id,'SIG');console.log('Temporary duty saved signature branch access: PASS')})().catch(e=>{console.error(e);process.exitCode=1})
