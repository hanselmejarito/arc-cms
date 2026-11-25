const fs=require('node:fs'),ts=require('typescript'),assert=require('node:assert/strict')
function load(file,deps={}){const js=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;const out={};new Function('exports','require',js)(out,n=>deps[n]||require(n));return out}
const data=load('src/data.js',{'./timeFormat':load('src/timeFormat.js'),'../lib/shiftPreview':load('lib/shiftPreview.ts')})
const patient={id:'P',name:'Synthetic',birthday:'1990-01-01',sex:'Male'}
const common={patientId:'P',date:'2026-11-25',biteDate:'2026-11-24',rer:true,category:'III',pepEligible:true,regimen:'ID',erig:{},wound:[],branch:'Guimba'}
const cases=[{...common,id:'1',registry:'1',animal:'Cat',pet:true,stray:false,biteType:'Bite',washed:true},{...common,id:'2',registry:'2',animal:'Cat',pet:true,stray:false,biteType:'Bite',washed:true},{...common,id:'3',registry:'3',animal:'Dog',pet:false,stray:false,biteType:'Non-Bite',washed:false,booster:true,category:'II'},{...common,id:'4',registry:'4',preExp:true,animal:'',pet:null,stray:null,biteType:'',washed:null}]
const rows=data.registryRows(cases,[],[patient])
const prep=rows.find(r=>r.id==='4')
for(const key of ['expDate','place','animalCode','type','site','category','washed','animal14']) assert.equal(prep[key],'',key)
assert.equal(prep.prep,'PrEP')
assert.equal(rows.find(r=>r.id==='3').animalCode,'')
assert.equal(rows.find(r=>r.id==='1').animalCode,'C')
assert.equal(rows.find(r=>r.id==='3').type,'NB')
const source=fs.readFileSync('src/screens/Reports.jsx','utf8')
const filter=source.match(/const cases=encounters\.filter\((e=>[^;]+)\);const listed=/)
assert(filter,'DOH case filter must be present')
const included=new Function('encounters','branch','period','inB','inPeriod',`return encounters.filter(${filter[1]})`)(cases,'Guimba',{},()=>true,()=>true)
const decl=source.slice(source.indexOf('function aggregate('),source.indexOf('\nexport function DOHPage'))
const cols=['male','female','lt15','ge15','c1','c2','c2n','c2b','c2p','x2b','x2p','c3','c3n','c3b','c3p','x3b','x3h','x3e','dog','cat','oth','stray','pet','unk']
const aggregate=new Function('cols','ageFrom','caseInfo','under15','pct',decl+';return aggregate')(cols,data.ageFrom,data.caseInfo,data.under15,(a,b)=>b?(a/b*100).toFixed(2):'0')
const totals=aggregate(included,()=>patient,[])
assert.equal(included.length,3);assert.equal(totals.cat,2);assert.equal(totals.dog,1);assert.equal(totals.oth,0);assert.equal(totals.pet,2);assert.equal(totals.unk,1);assert.equal(totals.catT,3)
console.log('PrEP exclusion, unknown animal classification and registry fields: PASS')
