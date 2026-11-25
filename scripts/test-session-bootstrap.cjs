const fs=require('node:fs'),ts=require('typescript'),assert=require('node:assert/strict')
const source=ts.transpileModule(fs.readFileSync('src/sessionBootstrap.js','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const out={};new Function('exports',source)(out)
;(async()=>{
 let workspaceLoads=0
 const load=async()=>{workspaceLoads++;return {patients:[]}}
 assert.deepEqual(await out.loadSessionBootstrap(async()=>({user:null}),load),{authenticated:false});assert.equal(workspaceLoads,0)
 const user={id:'synthetic'},data={patients:[]};assert.deepEqual(await out.loadSessionBootstrap(async()=>({user}),async()=>data),{authenticated:true,user,data})
 await assert.rejects(out.loadSessionBootstrap(async()=>{throw new Error('network down')},load),/network down/)
 await assert.rejects(out.loadSessionBootstrap(async()=>({user}),async()=>{throw new Error('workspace unavailable')}),/workspace unavailable/)
 console.log('Session restoration distinguishes signed-out from connection failure: PASS')
})().catch(e=>{console.error(e);process.exitCode=1})
