const fs=require('node:fs'),ts=require('typescript'),assert=require('node:assert/strict'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server')
function load(file){const out={};const js=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;new Function('exports',js)(out);return out}
const side=load('src/doseSide.js'),two=side.TWO_SITE_ID,one='0.1 mL × 1 site ID',im='1 vial IM'
assert.equal(side.sideForDoseChange('',two,''),'L/R')
assert.equal(side.sideForDoseChange(two,one,'L/R'),'')
assert.equal(side.sideForDoseChange(two,im,'L/R'),'')
assert.equal(side.sideForDoseChange(one,one,'L'),'L')
assert.equal(side.validDoseSide(two,'L/R'),true)
assert.equal(side.validDoseSide(two,'L'),false)
for(const dose of [one,im]){assert.equal(side.validDoseSide(dose,'L'),true);assert.equal(side.validDoseSide(dose,'R'),true);assert.equal(side.validDoseSide(dose,'L/R'),false);assert.equal(side.validDoseSide(dose,''),false)}
assert.equal(side.validDoseSideCorrection(two,'L',{dose:two,side:'L'}),true)
assert.equal(side.validDoseSideCorrection(two,'R',{dose:two,side:'L'}),false)
const source=fs.readFileSync('src/screens/Clinical.jsx','utf8'),line=source.split(/\r?\n/).find(x=>x.startsWith('function DoseSideChoice('));assert(line)
const js=ts.transpileModule(line+'\nexports.DoseSideChoice=DoseSideChoice',{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
let props;function Choice(p){props=p;return React.createElement('div',null,p.label)}
const out={};new Function('require','exports','Choice','TWO_SITE_ID',js)(require,out,Choice,two)
let html=renderToStaticMarkup(React.createElement(out.DoseSideChoice,{dose:two,side:'L/R',onChange:()=>{}}));assert.deepEqual(props.value,['L','R']);assert.equal(props.disabled,true);assert.match(html,/Both sides selected/)
html=renderToStaticMarkup(React.createElement(out.DoseSideChoice,{dose:two,side:'L',onChange:()=>{}}));assert.deepEqual(props.value,['L']);assert.match(html,/Previously saved as L/)
renderToStaticMarkup(React.createElement(out.DoseSideChoice,{dose:one,side:'R',onChange:()=>{}}));assert.equal(props.value,'R');assert.equal(props.disabled,false)
const routes=fs.readFileSync('lib/routes/clinical.ts','utf8'),start=routes.indexOf("clinicalRouter.post('/encounters/:id/doses',"),end=routes.indexOf("clinicalRouter.post('/encounters/:id/doses/:day/signature'",start)
assert(start>=0&&end>start)
const routeJs=ts.transpileModule(routes.slice(start,end),{compilerOptions:{module:ts.ModuleKind.None,target:ts.ScriptTarget.ES2022}}).outputText
let handler
new Function('clinicalRouter','requirePage','doseSchema','validDoseSide',routeJs)({post:(_p,_g,fn)=>{handler=fn}},()=>()=>{},{safeParse:data=>({success:true,data})},side.validDoseSide)
async function rejected(dose,chosen){const res={code:200,status(n){this.code=n;return this},json(body){this.body=body;return this}};await handler({body:{dose,side:chosen}},res);assert.equal(res.code,400);assert.match(res.body.error,/injection side/)}
;(async()=>{await rejected(two,'L');await rejected(one,'L/R');await rejected(im,'L/R');console.log('Dose sides, form selection, historical correction and API validation: PASS')})().catch(e=>{console.error(e);process.exitCode=1})
