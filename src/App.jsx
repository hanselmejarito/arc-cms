'use client'
import React from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Activity, AlertTriangle, Bell, CalendarDays, Check, ChevronDown, ChevronRight, ClipboardList, Clock3, CreditCard, Eye, EyeOff, FileBarChart2, FileClock, FileText, GitBranch, HeartPulse, LayoutDashboard, LogOut, Menu, Moon, Package, PanelLeftClose, PanelLeftOpen, PiggyBank, Search, Settings, ShieldCheck, Sun, Syringe, Users, WalletCards, X } from 'lucide-react'
import { addDays, allBranchRoles, branchMaster as seedBranches, buildSchedule, noClockRoles, today } from './data'
import { loadClinical, loginApi, logoutApi, meApi, timeInApi, timeOutApi } from './api'
import { Badge, BrandLogo, Button, IconButton, Modal, PartnerLogo } from './components'
import { Dashboard, PatientsPage, ProfilePage, AdmissionsPage, ExposurePage, TreatmentsPage, NotesPage, SchedulePage } from './screens/Clinical'
import { InventoryPage, InventoryReportPage, PaymentsPage, FinancePage, ReferralsPage, RefundsPage } from './screens/Operations'
import { EmployeesPage, AttendancePage } from './screens/People'
import { PayrollPage, PayslipsPage } from './screens/PayrollPages'
import { ReportsPage, RegistryPage, DOHPage } from './screens/Reports'
import { BranchesPage, UsersPage, AuditPage, SettingsPage } from './screens/Admin'

const nav=[
{group:'OVERVIEW',items:[['dashboard','Dashboard',LayoutDashboard]]},
{group:'PATIENT MANAGEMENT',items:[['patients','Patients',Users],['admissions','Admissions',ClipboardList],['exposure','RER / Animal Bite',HeartPulse],['treatments','Treatment & Vaccination',Syringe],['notes','Progress Notes',FileText],['schedule','Follow-up Schedule',CalendarDays]]},
{group:'INVENTORY',items:[['stock','Current Stock',Package],['receiving','Stock In / Receiving',Package],['usage','Stock Out / Usage',Activity],['adjustments','Stock Adjustments',ClipboardList],['alerts','Expiring / Low Stock',Bell],['invreport','Vaccine Inventory Report',FileText]]},
{group:'TRANSACTIONS',items:[['payments','Payments / Sales',CreditCard],['finance','Finance Tracker',PiggyBank],['referrals','Branch Referrals',GitBranch],['refunds','Refunds',WalletCards]]},
{group:'EMPLOYEES',items:[['employees','Employee Records',Users],['attendance','Attendance',Clock3],['payroll','Payroll',WalletCards],['payslips','Payslips',FileText]]},
{group:'REPORTS',items:[['reports','Clinic Reports',FileBarChart2],['registry','Rabies Exposure Registry',ClipboardList],['doh','Animal Bite & Rabies Report',FileBarChart2]]},
{group:'ADMINISTRATION',items:[['branches','Branches',GitBranch],['users','Users & Roles',ShieldCheck],['audit','Audit Trail',FileClock],['settings','Settings',Settings]]}
]
const titles=Object.fromEntries(nav.flatMap(g=>g.items.map(([id,label])=>[id,label])))
const clinical=['patients','admissions','exposure','treatments','notes','schedule']
export const access={'Nurse':['dashboard',...clinical,'stock','receiving','usage','adjustments','alerts','invreport','payments','finance','referrals','refunds','reports','registry','doh','attendance','payslips'],'PhilHealth Officer':['dashboard',...clinical,'referrals','refunds','reports','registry','doh','attendance','payslips'],Secretary:['dashboard','patients','admissions','exposure','treatments','notes','schedule','payments','finance','referrals','refunds','reports','registry','doh','attendance','payslips']}
export const can=(role,page)=>role==='Superadmin'||role==='Admin'||!!access[role]?.includes(page)
const homeBranch={Admin:'Guimba',Nurse:'Guimba','PhilHealth Officer':'Guimba',Secretary:'Guimba'}
const workspacePages=['dashboard','patients','profile','admissions','exposure','treatments','notes','schedule','stock','receiving','usage','adjustments','alerts','invreport','payments','finance','referrals','refunds','employees','attendance','payroll','payslips','reports','registry','doh','branches','users','audit','settings']
function parseRoute(pathname,search){
 const parts=(pathname||'/').replace(/\/+$/,'').split('/').filter(Boolean)
 const focus=search?.get('focus')||null
 if(parts[0]==='login')return {page:'login',patientId:'',focus:null}
 if(parts[0]==='patients'&&parts[1])return {page:'profile',patientId:parts[1],focus:null}
 const page=!parts[0]||parts[0]==='dashboard'?'dashboard':parts[0]
 return {page:workspacePages.includes(page)?page:'dashboard',patientId:'',focus}
}
function hrefFor(page,patientId,focus){
 if(page==='profile'&&patientId)return '/patients/'+patientId
 if(!page||page==='dashboard'||page==='login')return '/'
 return '/'+page+(focus?'?focus='+encodeURIComponent(focus):'')
}
function useStored(key,initial){const [value,setValue]=React.useState(()=>{try{const v=JSON.parse(localStorage.getItem(key));if(v!=null)return v}catch{}return initial});React.useEffect(()=>{try{localStorage.setItem(key,JSON.stringify(value))}catch{}},[key,value]);return [value,setValue]}
function ThemeToggle({theme,setTheme,className=''}){return <IconButton icon={theme==='dark'?Sun:Moon} onClick={()=>setTheme(theme==='dark'?'light':'dark')} label={theme==='dark'?'Switch to light mode':'Switch to dark mode'} className={className}/>}
function BranchMenu({branch,setBranch,locked,sidebar,onPick,branchMaster}){
 const [open,setOpen]=React.useState(false),ref=React.useRef(null)
 React.useEffect(()=>{if(!open)return;const out=e=>{if(!ref.current?.contains(e.target))setOpen(false)},esc=e=>{if(e.key==='Escape')setOpen(false)};document.addEventListener('mousedown',out);document.addEventListener('keydown',esc);return()=>{document.removeEventListener('mousedown',out);document.removeEventListener('keydown',esc)}},[open])
 const pick=b=>{setBranch(b);setOpen(false);onPick?.()}
 const label=branch==='All branches'?'All branches':branch+(sidebar?' Branch':'')
 return <div ref={ref} className={(sidebar?'sidebar-context':'branch-select')+(locked?' locked':'')+(open?' open':'')}>
  <button type="button" className="branch-trigger" disabled={locked} aria-haspopup="listbox" aria-expanded={open} onClick={()=>setOpen(!open)}>
   {sidebar?<><span className="context-icon"><GitBranch size={17}/></span><div><small>WORKSPACE</small><strong>{label}</strong></div></>:<><GitBranch size={16}/><strong>{label}</strong></>}
   {!locked&&<ChevronDown size={14} className="branch-chevron"/>}
  </button>
  {open&&<div className="popover branch-pop" role="listbox">
   <button role="option" aria-selected={branch==='All branches'} className={branch==='All branches'?'selected':''} onClick={()=>pick('All branches')}><span className="branch-dot all"><GitBranch size={12}/></span><span className="branch-name">All branches<small>12 confirmed branches</small></span>{branch==='All branches'&&<Check size={15}/>}</button>
   <div className="branch-pop-label">BRANCHES</div>
   <div className="branch-pop-list">{(branchMaster||seedBranches).map(b=><button key={b.name} role="option" aria-selected={branch===b.name} className={branch===b.name?'selected':''} onClick={()=>pick(b.name)}><span className="branch-dot">{b.name[0]}</span><span className="branch-name">{b.name}<small>{[b.accreditation==='Accredited'&&'PhilHealth accredited',b.night&&'Night shift'].filter(Boolean).join(' · ')||'Morning shift'}</small></span>{branch===b.name&&<Check size={15}/>}</button>)}</div>
  </div>}
 </div>
}
const clock=()=>new Date().toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit',hour12:false})
export default function App(){
 const router=useRouter()
 const pathname=usePathname()||'/'
 const searchParams=useSearchParams()
 const route=parseRoute(pathname,searchParams)
 const page=route.page==='login'?'dashboard':route.page
 const focus=route.focus
 const [ready,setReady]=React.useState(false)
 const [logged,setLogged]=React.useState(false)
 const [user,setUser]=React.useState(null)
 const [theme,setTheme]=useStored('clinic-theme','light')
 React.useEffect(()=>{document.documentElement.dataset.theme=theme},[theme])
 React.useEffect(()=>{try{['clinic-page','clinic-focus','clinic-patient','clinic-encounter'].forEach(k=>localStorage.removeItem(k))}catch{}},[])
 const role=user?.role||'Superadmin'
 const [branch,setBranch]=React.useState('All branches')
 const [sidebar,setSidebar]=React.useState(true)
 const [mobile,setMobile]=React.useState(false)
 const [profileMenu,setProfileMenu]=React.useState(false)
 const [notifications,setNotifications]=React.useState(false)
 const patientRef=React.useRef(route.patientId||'')
 const navRef=React.useRef(null)
 React.useEffect(()=>{const nav=navRef.current;const active=nav?.querySelector('.nav-link.active');if(!nav||!active)return;const top=active.offsetTop,bottom=top+active.offsetHeight;if(top<nav.scrollTop)nav.scrollTop=Math.max(0,top-8);else if(bottom>nav.scrollTop+nav.clientHeight)nav.scrollTop=bottom-nav.clientHeight+8},[page,logged,sidebar])
 const [patientId,setPatientState]=React.useState(route.patientId||'')
 const setPatientId=id=>{patientRef.current=id||'';setPatientState(id||'')}
 const [encounterId,setEncounterId]=React.useState(null)
 React.useEffect(()=>{if(route.patientId)setPatientId(route.patientId)},[route.patientId])
 React.useEffect(()=>{if((page==='treatments'||page==='exposure'||page==='notes')&&focus)setEncounterId(focus)},[page,focus])
 const [patients,setPatients]=React.useState([])
 const [encounters,setEncounters]=React.useState([])
 const [doses,setDoses]=React.useState([])
 const [inventory,setInventory]=React.useState([])
 const [ledger,setLedger]=React.useState([])
 const [received,setReceived]=React.useState([])
 const [movements,setMovements]=React.useState([])
 const [payments,setPayments]=React.useState([])
 const [finance,setFinance]=React.useState([])
 const [referrals,setReferrals]=React.useState([])
 const [refunds,setRefunds]=React.useState([])
 const [attendance,setAttendance]=React.useState([])
 const [payrollInputs,setPayrollInputs]=React.useState([])
 const [contributionOverrides,setContributionOverrides]=React.useState([])
 const [attendanceCorrections,setAttendanceCorrections]=React.useState([])
 const [overtimeRequests,setOvertimeRequests]=React.useState([])
 const [employees,setEmployees]=React.useState([])
 const [users,setUsers]=React.useState([])
 const [branchMaster,setBranchMaster]=React.useState(seedBranches)
 const [notes,setNotes]=React.useState([])
 const [activity,setActivity]=React.useState([])
 const [toast,setToast]=React.useState(null)
 const applyClinical=data=>{
  setPatients(data.patients||[])
  setEncounters(data.encounters||[])
  setDoses(data.doses||[])
  setNotes(data.notes||[])
  setPayments(data.payments||[])
  setReferrals(data.referrals||[])
  setInventory(data.inventory||[])
  setLedger(data.ledger||[])
  setReceived(data.received||[])
  setMovements(data.movements||[])
  setFinance(data.finance||[])
  setRefunds(data.refunds||[])
  setAttendance(data.attendance||[])
  setPayrollInputs(data.payrollInputs||[])
  setContributionOverrides(data.contributionOverrides||[])
  setAttendanceCorrections(data.attendanceCorrections||[])
  setOvertimeRequests(data.overtimeRequests||[])
  setEmployees(data.employees||[])
  setUsers(data.users||[])
  if(data.branches?.length)setBranchMaster(data.branches)
  setActivity((data.audit||[]).map(a=>({id:a.id,title:a.action,patient:a.user,branch:a.branch,time:a.time,type:a.module,record:a.record,old:a.old,new:a.new,device:a.device})))
 }
 const startSession=async u=>{
  setUser(u)
  setBranch(u.allBranches?'All branches':(u.branchName||'Guimba'))
  applyClinical(await loadClinical())
  setLogged(true)
 }
 React.useEffect(()=>{let live=true,done=false;const boot=async()=>{try{const {user:u}=await meApi();if(!live)return;if(u)await startSession(u);else setLogged(false)}catch{if(live)setLogged(false)}finally{done=true;if(live)setReady(true)}};const t=setTimeout(()=>{if(live&&!done){setLogged(false);setReady(true)}},8000);boot();return()=>{live=false;clearTimeout(t)}},[])
 React.useEffect(()=>{if(toast){const t=setTimeout(()=>setToast(null),4000);return()=>clearTimeout(t)}},[toast])
 React.useEffect(()=>{if(!logged||!user)return;const need=page==='profile'?'patients':page;if(page==='dashboard')return;if(!can(user.role,need))router.replace('/')},[logged,user,page,router])
 React.useEffect(()=>{if(logged&&route.page==='login')router.replace('/')},[logged,route.page,router])
 const notify=(message,type='Update')=>{const fail=type==='error'||type==='Error'||(type==='Update'&&/required|Enter |Select |Mali|Hindi|failed|Unable|blocked|already|must /i.test(message));setToast({message,fail});if(!fail)setActivity(a=>[{title:message,patient:(user?.name||'')+' ('+role+')',branch:branch==='All branches'?'Guimba':branch,time:new Date().toLocaleTimeString('en-PH',{hour:'numeric',minute:'2-digit'}),type},...(a||[])].slice(0,30))}
 const go=(id,nextFocus=null)=>{const need=id==='profile'?'patients':id;if(id!=='dashboard'&&!can(role,need))return;const pid=id==='profile'?(nextFocus&&typeof nextFocus==='object'&&nextFocus.patientId)||patientRef.current||patientId:'';router.push(hrefFor(id,pid,id==='profile'?null:nextFocus));setMobile(false);setProfileMenu(false);window.scrollTo({top:0,behavior:'smooth'})}
 const branchLocked=!allBranchRoles.includes(role)
 const [promptHidden,setPromptHidden]=React.useState(false)
 const [signOutPrompt,setSignOutPrompt]=React.useState(false)
 const clocks=!noClockRoles.includes(role)
 const mine=attendance.filter(x=>!x.userId||x.userId===user?.id)
 const record=mine.find(x=>x.date===today)
 const login=async(email,password,remember)=>{await startSession((await loginApi(email,password,remember)).user);setPromptHidden(false);router.replace('/')}
 const timeIn=async()=>{if(record?.in)return;const duty=employees.find(e=>e.id===user?.employeeId)?.branch;const where=branch==='All branches'?(duty||homeBranch[role]||'Guimba'):branch;try{const saved=await timeInApi({branch:where});setAttendance(log=>[...log.filter(x=>!(x.date===today&&(!x.userId||x.userId===user?.id))),saved]);notify('Time In recorded at '+saved.in+' · '+saved.branch,'Attendance')}catch(err){notify(err.message,'error')}}
 const timeOut=async()=>{if(!record?.in||record.out)return;try{const saved=await timeOutApi();setAttendance(log=>log.map(x=>x.date===today&&(!x.userId||x.userId===user?.id)?saved:x));notify('Time Out recorded at '+saved.out,'Attendance')}catch(err){notify(err.message,'error')}}
 const doLogout=()=>{logoutApi().catch(()=>{});setUser(null);setLogged(false);setPatientId('');setEncounterId(null);setPatients([]);setEncounters([]);setDoses([]);setNotes([]);setPayments([]);setReferrals([]);setInventory([]);setLedger([]);setReceived([]);setMovements([]);setFinance([]);setRefunds([]);setAttendance([]);setPayrollInputs([]);setContributionOverrides([]);setAttendanceCorrections([]);setOvertimeRequests([]);setEmployees([]);setUsers([]);router.replace('/')}
 const signOut=()=>{setProfileMenu(false);if(clocks&&record?.in&&!record.out)setSignOutPrompt(true);else doLogout()}
 const finishSignOut=async withTimeOut=>{if(withTimeOut)await timeOut();setSignOutPrompt(false);doLogout()}
 const schedule=buildSchedule(encounters,doses,patients)
 const inScope=b=>branch==='All branches'||b===branch
 const alertCount=inventory.filter(x=>inScope(x.branch)&&(x.stock<=x.threshold||x.expiry<addDays(today,60))).length
 const ctx={page,go,focus,branch,role,userId:user?.id||'',userName:user?.name||'',employeeId:user?.employeeId||'',patients,setPatients,encounters,setEncounters,doses,setDoses,schedule,inventory,setInventory,ledger,setLedger,received,setReceived,movements,setMovements,payments,setPayments,finance,setFinance,referrals,setReferrals,refunds,setRefunds,attendance,setAttendance,payrollInputs,setPayrollInputs,contributionOverrides,setContributionOverrides,attendanceCorrections,setAttendanceCorrections,overtimeRequests,setOvertimeRequests,employees,setEmployees,users,setUsers,branchMaster,setBranchMaster,timeIn,timeOut,notes,setNotes,activity,notify,patientId,setPatientId,encounterId,setEncounterId,can:p=>can(role,p)}
 if(!ready)return <div className="login-page"><div className="login-right"><p className="card-note">Loading…</p></div></div>
 if(!logged)return <Login onLogin={login} theme={theme} setTheme={setTheme}/>
 const pages={dashboard:Dashboard,patients:PatientsPage,profile:ProfilePage,admissions:AdmissionsPage,exposure:ExposurePage,treatments:TreatmentsPage,notes:NotesPage,schedule:SchedulePage,stock:InventoryPage,receiving:InventoryPage,usage:InventoryPage,adjustments:InventoryPage,alerts:InventoryPage,invreport:InventoryReportPage,payments:PaymentsPage,finance:FinancePage,referrals:ReferralsPage,refunds:RefundsPage,employees:EmployeesPage,attendance:AttendancePage,payroll:PayrollPage,payslips:PayslipsPage,reports:ReportsPage,registry:RegistryPage,doh:DOHPage,branches:BranchesPage,users:UsersPage,audit:AuditPage,settings:SettingsPage}
 const Page=pages[page]||Dashboard
 const due=schedule.filter(s=>inScope(s.branch)&&s.status==='Due today').length,pendingRef=referrals.filter(r=>r.status==='Pending acceptance'&&inScope(r.to)).length
 return <div className={'app '+(!sidebar?'sidebar-collapsed':'')}>
  {mobile&&<div className="mobile-scrim" onClick={()=>setMobile(false)}/>}
  <aside className={'sidebar '+(mobile?'mobile-open':'')}>
   <div className="brand"><div className="brand-mark"><BrandLogo/></div><div><strong>ARC</strong><small>ANTI RABIES CLINIC</small></div><PartnerLogo/><button className="sidebar-close" onClick={()=>setMobile(false)}><X size={18}/></button></div>
   <BranchMenu sidebar branch={branch} setBranch={setBranch} locked={branchLocked} onPick={()=>setMobile(false)} branchMaster={branchMaster}/>
   <nav className="side-nav" ref={navRef}>{nav.map(group=>{const items=group.items.filter(([id])=>can(role,id));return items.length?<div className="nav-group" key={group.group}><div className="nav-label">{group.group}</div>{items.map(([id,label,Icon])=><button key={id} className={'nav-link '+(page===id||page==='profile'&&id==='patients'?'active':'')} onClick={()=>go(id)}><Icon size={18}/><span>{label}</span>{id==='alerts'&&alertCount>0&&<span className="nav-count">{alertCount}</span>}</button>)}</div>:null})}</nav>
   <div className="sidebar-bottom"><div className="support-card"><span className="support-icon"><HeartPulse size={18}/></span><strong>Care across every branch</strong><p>One connected view of patients, teams and care.</p></div><button className="collapse-button" onClick={()=>setSidebar(!sidebar)} title={sidebar?'Collapse sidebar':'Expand sidebar'} aria-label={sidebar?'Collapse sidebar':'Expand sidebar'}>{sidebar?<PanelLeftClose size={17}/>:<PanelLeftOpen size={17}/>}<span>{sidebar?'Collapse sidebar':'Expand sidebar'}</span></button></div>
  </aside>
  <div className="main-shell"><header className="topbar"><div className="top-left"><button className="mobile-menu" onClick={()=>setMobile(true)}><Menu size={21}/></button><div className="header-logo"><BrandLogo/></div><PartnerLogo className="brand-partner header-partner"/><div className="breadcrumb"><span>Workspace</span><ChevronRight size={14}/><strong>{page==='profile'?'Patient Profile':titles[page]}</strong></div></div><div className="top-right"><div className="global-search"><Search size={17}/><input placeholder="Search name, registry no., contact..." onKeyDown={e=>{if(e.key==='Enter'&&can(role,'patients')){go('patients');e.target.blur()}}}/><kbd>⌘ K</kbd></div><BranchMenu branch={branch} setBranch={setBranch} locked={branchLocked} branchMaster={branchMaster}/><ThemeToggle theme={theme} setTheme={setTheme}/><div className="header-pop"><IconButton icon={Bell} onClick={()=>setNotifications(!notifications)} label="Notifications"/><i className="notification-dot"/>{notifications&&<div className="popover notifications"><strong>Notifications</strong>{can(role,'schedule')&&<p><Badge>Due today</Badge> {due} vaccine follow-up{due===1?'':'s'} due today.</p>}{can(role,'alerts')&&<p><Badge>Low stock</Badge> {alertCount} stock line{alertCount===1?'':'s'} low, near expiry or expired.</p>}{can(role,'referrals')&&<p><Badge>Pending</Badge> {pendingRef} referral{pendingRef===1?'':'s'} awaiting acceptance.</p>}{clocks&&<p><Badge tone="blue">Attendance</Badge> {record?.in?'Time In '+record.in+(record.out?' · Time Out '+record.out:' · Time Out pending'):'You have not timed in today.'}</p>}</div>}</div><div className="header-pop"><button className="avatar-button" onClick={()=>setProfileMenu(!profileMenu)}><span className="avatar">{(user?.name||'?').split(' ').map(x=>x[0]).join('').slice(0,2)}</span><span className="avatar-text"><strong>{user?.name}</strong><small>{role}</small></span><ChevronDown size={15}/></button>{profileMenu&&<div className="popover profile-pop"><strong>{user?.email}</strong><p className="card-note">{role}{user?.branchName?' · '+user.branchName:' · all branches'}</p><button className="logout" onClick={signOut}><LogOut size={15}/> Sign out</button></div>}</div></div></header>
   <main className="content">{clocks&&!record?.in&&!promptHidden&&<div className="timein-prompt"><span className="timein-icon"><Clock3 size={20}/></span><div><strong>You have not timed in today</strong><p>Signing in does not record attendance. Tap Time In when you start your shift at {branch==='All branches'?(employees.find(e=>e.id===user?.employeeId)?.branch||homeBranch[role]||'Guimba'):branch} branch.</p></div><Button icon={Clock3} onClick={timeIn}>Time In now</Button><button className="timein-later" onClick={()=>setPromptHidden(true)}>Later</button></div>}<Page key={page==='profile'?page+'-'+patientId:page} {...ctx}/></main><footer className="app-footer">ARC Anti Rabies Clinic · Next.js + Prisma · Clinic records persist on the server</footer>
  </div>{signOutPrompt&&<Modal title="Time Out before signing out?" onClose={()=>setSignOutPrompt(false)} footer={<><Button variant="secondary" onClick={()=>setSignOutPrompt(false)}>Cancel</Button><Button variant="secondary" onClick={()=>finishSignOut(false)}>Sign out only</Button><Button icon={Clock3} onClick={()=>finishSignOut(true)}>Time Out & sign out</Button></>}><p className="card-note">You timed in at {record?.in} and have not timed out. Signing out does not end your shift. Choose “Sign out only” if you are switching users or stepping away.</p></Modal>}{toast&&<div className={'toast'+(toast.fail?' fail':'')}><span>{toast.fail?<AlertTriangle size={12} strokeWidth={2.6}/>:<Check size={12} strokeWidth={3}/>}</span>{toast.message}<button type="button" onClick={()=>setToast(null)} aria-label="Dismiss"><X size={15}/></button></div>}
 </div>
}
function ParticleField(){const ref=React.useRef(null);React.useEffect(()=>{const canvas=ref.current;if(!canvas)return;const ctx=canvas.getContext('2d');const reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches;let raf=0,dots=[],w=0,h=0;const resize=()=>{const r=canvas.parentElement.getBoundingClientRect();if(Math.abs(r.width-w)<1&&Math.abs(r.height-h)<1&&dots.length)return;const dpr=Math.min(window.devicePixelRatio||1,2);w=r.width;h=r.height;canvas.width=w*dpr;canvas.height=h*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);const n=Math.round(Math.min(72,Math.max(32,w*h/15000)));dots=Array.from({length:n},()=>({x:Math.random()*w,y:Math.random()*h,vx:(Math.random()-.5)*.42,vy:(Math.random()-.5)*.42,r:Math.random()*1.5+1.2,gold:Math.random()<.4}))};const draw=()=>{ctx.clearRect(0,0,w,h);if(!reduce)dots.forEach(p=>{p.x+=p.vx;p.y+=p.vy;if(p.x<0||p.x>w)p.vx*=-1;if(p.y<0||p.y>h)p.vy*=-1});const reach=128;for(let i=0;i<dots.length;i++)for(let j=i+1;j<dots.length;j++){const a=dots[i],b=dots[j],dx=a.x-b.x,dy=a.y-b.y,dist=Math.hypot(dx,dy);if(dist<reach){ctx.strokeStyle=`rgba(255,204,0,${(1-dist/reach)*.32})`;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke()}}dots.forEach(p=>{ctx.fillStyle=p.gold?'rgba(255,204,0,.92)':'rgba(186,230,226,.8)';ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,Math.PI*2);ctx.fill()})};const tick=()=>{draw();if(!reduce)raf=requestAnimationFrame(tick)};resize();const ro=new ResizeObserver(()=>{resize();if(reduce)draw()});ro.observe(canvas.parentElement);tick();return()=>{cancelAnimationFrame(raf);ro.disconnect()}},[]);return <canvas ref={ref} className="login-particles" aria-hidden="true"/>}
function Login({onLogin,theme,setTheme}){
 const [email,setEmail]=React.useState('')
 const [password,setPassword]=React.useState('')
 const [show,setShow]=React.useState(false)
 const [remember,setRemember]=React.useState(false)
 const [error,setError]=React.useState('')
 const [busy,setBusy]=React.useState(false)
 const submit=async e=>{
  e.preventDefault()
  setBusy(true)
  setError('')
  try{await onLogin(email,password,remember)}
  catch(err){setPassword('');setError(err.message||'Sign in failed')}
  finally{setBusy(false)}
 }
 return <div className="login-page">
  <div className="login-left">
   <ParticleField/>
   <div className="login-brand"><span className="brand-mark"><BrandLogo/></span><PartnerLogo/></div>
   <div className="login-copy">
    <span className="login-kicker">ARC ANTI RABIES CLINIC</span>
    <h1>One record across every branch.</h1>
    <p>Admissions, vaccines, stock, and reports stay with the clinic that is caring for the patient.</p>
    <div className="login-features">
     <div><span>01</span> Patients and PEP, from admission to the last dose</div>
     <div><span>02</span> Stock counted at each branch</div>
     <div><span>03</span> Payments, attendance, and the DOH report</div>
    </div>
   </div>
   <div className="login-copyright">© 2026 ARC Anti Rabies Clinic</div>
  </div>
  <div className="login-right">
   <ThemeToggle theme={theme} setTheme={setTheme} className="login-theme"/>
   <form className="login-form" onSubmit={submit}>
    <div className="login-welcome"><h2>Welcome back</h2><p>Sign in to your ARC account</p></div>
    <label>Email<input required value={email} onChange={e=>setEmail(e.target.value)} placeholder="Email" autoComplete="username"/></label>
    <label>Password<div className="password-field"><input required type={show?'text':'password'} value={password} onChange={e=>setPassword(e.target.value)} placeholder="Password" autoComplete="current-password"/><button type="button" className="password-toggle" onClick={()=>setShow(!show)} aria-label={show?'Hide password':'Show password'} title={show?'Hide password':'Show password'}>{show?<EyeOff size={18}/>:<Eye size={18}/>}</button></div></label>
    <label className="remember"><input type="checkbox" checked={remember} onChange={e=>setRemember(e.target.checked)}/> Remember me on this device</label>
    {error&&<p className="login-error" role="alert">{error}</p>}
    <Button type="submit" className="login-submit" disabled={busy}>{busy?'Signing in…':'Sign in'}</Button>
   </form>
  </div>
 </div>
}
