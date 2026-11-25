const fs=require('fs'),ts=require('typescript'),assert=require('node:assert/strict')
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server')
function load(file,deps={}){const js=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;const out={};new Function('require','exports','module',js)(n=>n in deps?deps[n]:require(n),out,{exports:out});return out}
const shifts=load('lib/shiftPreview.ts'),timeFormat=load('src/timeFormat.js'),eligibility=load('src/payrollEligibility.js'),data=load('src/data.js',{'../lib/shiftPreview':shifts,'./timeFormat':timeFormat}),basis=load('src/payrollBasis.js'),allocation=load('src/dutyAllocation.js')
const branch=load('src/branchPayroll.js',{'./data':data,'./dutyAllocation':allocation})
const summary=load('src/branchPayrollSummary.js',{'./data':data,'./dutyAllocation':allocation,'./branchPayroll':branch,'./payrollEligibility':eligibility})
const passthrough=({children})=>React.createElement('div',null,children)
const Table=({rows,columns})=>React.createElement('table',null,
  React.createElement('tbody',null,rows.map(r=>React.createElement('tr',{key:r.id},
    columns.map((c,i)=>React.createElement('td',{key:i},c.render?c.render(r):r[c.key]||''))))))
const StatCard=({label,value})=>React.createElement('div',null,label,': ',value)
const components={Badge:passthrough,Button:passthrough,Card:passthrough,Field:passthrough,Modal:passthrough,SectionTitle:passthrough,Select:passthrough,Tabs:passthrough,Table,StatCard,BrandLogo:passthrough}
const people=load('src/screens/People.jsx',{'../data':data,'../timeFormat':timeFormat,'../payrollEligibility':eligibility,'../payrollBasis':basis,'../api':{},'../components':components,'./HrPrint':{},'../StaffSignatures':{},'../BranchCorrection':{}})
const pages=load('src/screens/PayrollPages.jsx',{'../data':data,'../payrollEligibility':eligibility,'../api':{},'../components':components,'./People':people,'./HrPrint':{PayrollPrint:passthrough},'../branchPayroll':branch,'../branchPayrollSummary':summary,'../dutyAllocation':allocation})
const e={id:'E',name:'Test Staff',role:'Nurse',branch:'Guimba',shift:'Morning Shift',rate:840,hours:8,payroll:true,benefits:false}
const date=data.payPeriods[0].from
const attendance=[{id:'A',employeeId:'E',date,branch:'Paniqui',in:'08:00',out:'17:00',homeBranchAtMorning:'Guimba',roleAtMorning:'Nurse',rateAtMorning:840,officerAtMorning:false,benefitsAtMorning:false,nightBranch:'Guimba',nightIn:'17:00',nightOut:'23:00',homeBranchAtNight:'Guimba',roleAtNight:'Nurse',rateAtNight:840,officerAtNight:false,benefitsAtNight:false}]
const html=renderToStaticMarkup(React.createElement(pages.PayrollPage,{branch:'All branches',role:'Admin',employees:[e],attendance,users:[],payrollInputs:[],contributionOverrides:[],overtimeRequests:[],temporaryBranchEnabled:true,notify:()=>{}}))
assert.match(html,/Paniqui/);assert.match(html,/Guimba/);assert.match(html,/Test Staff/)
const away=renderToStaticMarkup(React.createElement(pages.PayrollPage,{branch:'Paniqui',role:'Admin',employees:[e],attendance,users:[],payrollInputs:[],contributionOverrides:[],overtimeRequests:[],temporaryBranchEnabled:true,notify:()=>{}}))
assert.match(away,/Test Staff/);assert.match(away,/Paniqui/)
const payslip=renderToStaticMarkup(React.createElement(pages.PayslipsPage,{branch:'Paniqui',role:'Admin',employees:[e],attendance,users:[],payrollInputs:[],contributionOverrides:[],overtimeRequests:[],temporaryBranchEnabled:true}))
assert.match(payslip,/Test Staff/);assert.match(payslip,/combines duties from all branches/)
const marked=renderToStaticMarkup(React.createElement(pages.PayrollPage,{branch:'All branches',role:'Admin',employees:[e],attendance,users:[],payrollInputs:[{employeeId:'E',periodId:data.payPeriods[0].id,days:2}],contributionOverrides:[],overtimeRequests:[],temporaryBranchEnabled:true,notify:()=>{}}))
assert.match(marked,/Branch payroll requires Admin review/)
const hr=load('src/screens/HrPrint.jsx',{'../components':components,'../data':data,'../dutyAllocation':allocation,'../xlsxExport':{}})
const attendanceHtml=renderToStaticMarkup(React.createElement(hr.AttendancePrint,{employees:[e],attendance,users:[],period:data.payPeriods[0],overtimeRequests:[],temporaryBranchEnabled:true,branchFilter:'All branches'}))
assert.match(attendanceHtml,/Paniqui branch/);assert.match(attendanceHtml,/Guimba branch/)
const awayAttendance=renderToStaticMarkup(React.createElement(hr.AttendancePrint,{employees:[e],attendance,users:[],period:data.payPeriods[0],overtimeRequests:[],temporaryBranchEnabled:true,branchFilter:'Paniqui'}))
assert.match(awayAttendance,/Paniqui branch/);assert.doesNotMatch(awayAttendance,/Guimba branch/)
const nightView=renderToStaticMarkup(React.createElement(people.AttendancePage,{branch:'Guimba',role:'Nurse',userId:'U',employeeId:'E',employees:[e],attendance:[{id:'N',userId:'U',employeeId:'E',date:data.today,branch:'Guimba',nightBranch:'Guimba',nightIn:'16:00',nightOut:''}],users:[],temporaryBranchEnabled:true,setAttendance:()=>{},notify:()=>{}}))
assert.match(nightView,/Night duty in progress/);assert.doesNotMatch(nightView,/No duty recorded today/);assert.match(nightView,/Morning hours/)
console.log('Gated branch payroll rendering and review state: PASS')
