import React from 'react'
import { Activity, Bell, CalendarDays, Check, ChevronDown, ChevronRight, ClipboardList, Clock3, CreditCard, FileBarChart2, FileClock, FileText, GitBranch, HeartPulse, LayoutDashboard, LogOut, Menu, Moon, Package, PanelLeftClose, PanelLeftOpen, PiggyBank, Search, Settings, ShieldCheck, Sun, Syringe, Users, WalletCards, X } from 'lucide-react'
import { addDays, allBranchRoles, branchMaster, buildSchedule, doses as seedDoses, encounters as seedEncounters, financeEntries, inventory as seedInventory, ledger as seedLedger, patients as seedPatients, payments as seedPayments, progressNotes, receivedReport, referrals as seedReferrals, refunds as seedRefunds, roles, today, attendanceLog } from './data'
import { Badge, BrandLogo, Button, IconButton, Modal, PartnerLogo } from './components'
import { Dashboard, PatientsPage, ProfilePage, AdmissionsPage, ExposurePage, TreatmentsPage, NotesPage, SchedulePage } from './pages/Clinical'
import { InventoryPage, InventoryReportPage, PaymentsPage, FinancePage, ReferralsPage, RefundsPage } from './pages/Operations'
import { EmployeesPage, AttendancePage, PayrollPage, PayslipsPage } from './pages/People'
import { ReportsPage, RegistryPage, DOHPage } from './pages/Reports'
import { BranchesPage, UsersPage, AuditPage, SettingsPage } from './pages/Admin'

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
export const access={HR:['dashboard','employees','attendance','payroll','payslips','reports'],'Nurse / Staff':['dashboard',...clinical,'stock','receiving','usage','alerts','invreport','referrals','registry','doh','attendance','payslips'],'PO / PhilHealth Officer':['dashboard',...clinical,'stock','receiving','usage','adjustments','alerts','invreport','payments','finance','referrals','refunds','reports','registry','doh','attendance','payslips'],Secretary:['dashboard','patients','admissions','schedule','payments','referrals','registry','attendance','payslips'],Cashier:['dashboard','patients','payments','finance','referrals','refunds','reports','attendance','payslips'],Employee:['dashboard','attendance','payslips']}
export const can=(role,page)=>!access[role]||access[role].includes(page)
const homeBranch={'Nurse / Staff':'Guimba','PO / PhilHealth Officer':'Guimba',Secretary:'Guimba',Cashier:'Cabanatuan',Employee:'Guimba'}
function useStored(key,initial){const [value,setValue]=React.useState(()=>{try{return JSON.parse(localStorage.getItem(key))??initial}catch{return initial}});React.useEffect(()=>localStorage.setItem(key,JSON.stringify(value)),[key,value]);return [value,setValue]}
function ThemeToggle({theme,setTheme,className=''}){return <IconButton icon={theme==='dark'?Sun:Moon} onClick={()=>setTheme(theme==='dark'?'light':'dark')} label={theme==='dark'?'Switch to light mode':'Switch to dark mode'} className={className}/>}
function BranchMenu({branch,setBranch,locked,sidebar,onPick}){
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
   <button role="option" aria-selected={branch==='All branches'} className={branch==='All branches'?'selected':''} onClick={()=>pick('All branches')}><span className="branch-dot all"><GitBranch size={12}/></span><span className="branch-name">All branches<small>11 confirmed branches</small></span>{branch==='All branches'&&<Check size={15}/>}</button>
   <div className="branch-pop-label">BRANCHES</div>
   <div className="branch-pop-list">{branchMaster.map(b=><button key={b.name} role="option" aria-selected={branch===b.name} className={branch===b.name?'selected':''} onClick={()=>pick(b.name)}><span className="branch-dot">{b.name[0]}</span><span className="branch-name">{b.name}<small>{[b.accreditation==='Accredited'&&'PhilHealth accredited',b.night&&'Night shift'].filter(Boolean).join(' · ')||'Morning shift'}</small></span>{branch===b.name&&<Check size={15}/>}</button>)}</div>
  </div>}
 </div>
}
const clock=()=>new Date().toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit',hour12:false})
export default function App(){
 const [logged,setLogged]=useStored('clinic-logged',false)
 const [theme,setTheme]=useStored('clinic-theme',window.matchMedia?.('(prefers-color-scheme: dark)').matches?'dark':'light')
 React.useEffect(()=>{document.documentElement.dataset.theme=theme},[theme])
 const [page,setPage]=React.useState('dashboard')
 const [focus,setFocus]=React.useState(null)
 const [role,setRole]=useStored('arc4-role','Owner')
 const [branch,setBranch]=React.useState(()=>homeBranch[role]||'All branches')
 const [sidebar,setSidebar]=React.useState(true)
 const [mobile,setMobile]=React.useState(false)
 const [profileMenu,setProfileMenu]=React.useState(false)
 const [notifications,setNotifications]=React.useState(false)
 const [patientId,setPatientId]=React.useState(seedPatients[0].id)
 const [encounterId,setEncounterId]=React.useState(null)
 const [patients,setPatients]=useStored('arc18-patients',seedPatients)
 const [encounters,setEncounters]=useStored('arc18-encounters',seedEncounters)
 const [doses,setDoses]=useStored('arc18-doses',seedDoses)
 const [inventory,setInventory]=useStored('arc18-inventory',seedInventory)
 const [ledger,setLedger]=useStored('arc18-ledger',seedLedger)
 const [received,setReceived]=useStored('arc18-received',receivedReport)
 const [movements,setMovements]=useStored('arc18-movements',[])
 const [payments,setPayments]=useStored('arc18-payments',seedPayments)
 const [finance,setFinance]=useStored('arc18-finance',financeEntries)
 const [referrals,setReferrals]=useStored('arc18-referrals',seedReferrals)
 const [refunds,setRefunds]=useStored('arc18-refunds',seedRefunds)
 const [attendance,setAttendance]=useStored('arc18-attendance',attendanceLog)
 const [notes,setNotes]=useStored('arc18-notes',progressNotes)
 const [activity,setActivity]=useStored('arc18-activity',[])
 const [toast,setToast]=React.useState('')
 React.useEffect(()=>{if(toast){const t=setTimeout(()=>setToast(''),3500);return()=>clearTimeout(t)}},[toast])
 const notify=(message,type='Update')=>{setToast(message);setActivity(a=>[{title:message,patient:'Alex Rivera ('+role+')',branch:branch==='All branches'?'Guimba':branch,time:new Date().toLocaleTimeString('en-PH',{hour:'numeric',minute:'2-digit'}),type},...(a||[])].slice(0,30))}
 const go=(id,nextFocus=null)=>{setFocus(nextFocus);setPage(id);setMobile(false);setProfileMenu(false);window.scrollTo({top:0,behavior:'smooth'})}
 const branchLocked=!allBranchRoles.includes(role)
 const changeRole=(r)=>{setRole(r);setBranch(homeBranch[r]||'All branches');setProfileMenu(false);if(!can(r,page==='profile'?'patients':page))setPage('dashboard')}
 const [promptHidden,setPromptHidden]=React.useState(false)
 const [signOutPrompt,setSignOutPrompt]=React.useState(false)
 const record=attendance.find(x=>x.date===today)
 const login=()=>{setPromptHidden(false);setPage('dashboard');setLogged(true)}
 const timeIn=()=>{if(record?.in)return;const at=clock(),where=branch==='All branches'?homeBranch[role]||'Guimba':branch;setAttendance(log=>[...log.filter(x=>x.date!==today),{date:today,in:at,out:'',source:'Time In button',branch:where,device:'Branch workstation'}]);notify('Time In recorded at '+at+' · '+where,'Attendance')}
 const timeOut=()=>{if(!record?.in||record.out)return;const at=clock();setAttendance(log=>log.map(x=>x.date===today?{...x,out:at}:x));notify('Time Out recorded at '+at,'Attendance')}
 const signOut=()=>{setProfileMenu(false);if(record?.in&&!record.out)setSignOutPrompt(true);else setLogged(false)}
 const finishSignOut=withTimeOut=>{if(withTimeOut)timeOut();setSignOutPrompt(false);setLogged(false)}
 const schedule=buildSchedule(encounters,doses,patients)
 const inScope=b=>branch==='All branches'||b===branch
 const alertCount=inventory.filter(x=>inScope(x.branch)&&(x.stock<=x.threshold||x.expiry<addDays(today,60))).length
 const ctx={page,go,focus,branch,role,patients,setPatients,encounters,setEncounters,doses,setDoses,schedule,inventory,setInventory,ledger,setLedger,received,setReceived,movements,setMovements,payments,setPayments,finance,setFinance,referrals,setReferrals,refunds,setRefunds,attendance,setAttendance,timeIn,timeOut,notes,setNotes,activity,notify,patientId,setPatientId,encounterId,setEncounterId,can:p=>can(role,p)}
 if(!logged)return <Login onLogin={login} theme={theme} setTheme={setTheme}/>
 const pages={dashboard:Dashboard,patients:PatientsPage,profile:ProfilePage,admissions:AdmissionsPage,exposure:ExposurePage,treatments:TreatmentsPage,notes:NotesPage,schedule:SchedulePage,stock:InventoryPage,receiving:InventoryPage,usage:InventoryPage,adjustments:InventoryPage,alerts:InventoryPage,invreport:InventoryReportPage,payments:PaymentsPage,finance:FinancePage,referrals:ReferralsPage,refunds:RefundsPage,employees:EmployeesPage,attendance:AttendancePage,payroll:PayrollPage,payslips:PayslipsPage,reports:ReportsPage,registry:RegistryPage,doh:DOHPage,branches:BranchesPage,users:UsersPage,audit:AuditPage,settings:SettingsPage}
 const Page=pages[page]||Dashboard
 const due=schedule.filter(s=>inScope(s.branch)&&s.status==='Due today').length,pendingRef=referrals.filter(r=>r.status==='Pending acceptance'&&inScope(r.to)).length
 return <div className={'app '+(!sidebar?'sidebar-collapsed':'')}>
  {mobile&&<div className="mobile-scrim" onClick={()=>setMobile(false)}/>}
  <aside className={'sidebar '+(mobile?'mobile-open':'')}>
   <div className="brand"><div className="brand-mark"><BrandLogo/></div><div><strong>ARC</strong><small>ANTI RABIES CLINIC</small></div><PartnerLogo/><button className="sidebar-close" onClick={()=>setMobile(false)}><X size={18}/></button></div>
   <BranchMenu sidebar branch={branch} setBranch={setBranch} locked={branchLocked} onPick={()=>setMobile(false)}/>
   <nav className="side-nav">{nav.map(group=>{const items=group.items.filter(([id])=>can(role,id));return items.length?<div className="nav-group" key={group.group}><div className="nav-label">{group.group}</div>{items.map(([id,label,Icon])=><button key={id} className={'nav-link '+(page===id||page==='profile'&&id==='patients'?'active':'')} onClick={()=>go(id)}><Icon size={18}/><span>{label}</span>{id==='alerts'&&alertCount>0&&<span className="nav-count">{alertCount}</span>}</button>)}</div>:null})}</nav>
   <div className="sidebar-bottom"><div className="support-card"><span className="support-icon"><HeartPulse size={18}/></span><strong>Care across every branch</strong><p>One connected view of patients, teams and care.</p></div><button className="collapse-button" onClick={()=>setSidebar(!sidebar)} title={sidebar?'Collapse sidebar':'Expand sidebar'} aria-label={sidebar?'Collapse sidebar':'Expand sidebar'}>{sidebar?<PanelLeftClose size={17}/>:<PanelLeftOpen size={17}/>}<span>{sidebar?'Collapse sidebar':'Expand sidebar'}</span></button></div>
  </aside>
  <div className="main-shell"><header className="topbar"><div className="top-left"><button className="mobile-menu" onClick={()=>setMobile(true)}><Menu size={21}/></button><div className="header-logo"><BrandLogo/></div><PartnerLogo className="brand-partner header-partner"/><div className="breadcrumb"><span>Workspace</span><ChevronRight size={14}/><strong>{page==='profile'?'Patient Profile':titles[page]}</strong></div></div><div className="top-right"><div className="global-search"><Search size={17}/><input placeholder="Search name, registry no., contact..." onKeyDown={e=>{if(e.key==='Enter'&&can(role,'patients')){go('patients');e.target.blur()}}}/><kbd>⌘ K</kbd></div><BranchMenu branch={branch} setBranch={setBranch} locked={branchLocked}/><ThemeToggle theme={theme} setTheme={setTheme}/><div className="header-pop"><IconButton icon={Bell} onClick={()=>setNotifications(!notifications)} label="Notifications"/><i className="notification-dot"/>{notifications&&<div className="popover notifications"><strong>Notifications</strong>{can(role,'schedule')&&<p><Badge>Due today</Badge> {due} vaccine follow-up{due===1?'':'s'} due today.</p>}{can(role,'alerts')&&<p><Badge>Low stock</Badge> {alertCount} stock line{alertCount===1?'':'s'} low, near expiry or expired.</p>}{can(role,'referrals')&&<p><Badge>Pending</Badge> {pendingRef} referral{pendingRef===1?'':'s'} awaiting acceptance.</p>}<p><Badge tone="blue">Attendance</Badge> {record?.in?'Time In '+record.in+(record.out?' · Time Out '+record.out:' · Time Out pending'):'You have not timed in today.'}</p></div>}</div><div className="header-pop"><button className="avatar-button" onClick={()=>setProfileMenu(!profileMenu)}><span className="avatar">AR</span><span className="avatar-text"><strong>Alex Rivera</strong><small>{role}</small></span><ChevronDown size={15}/></button>{profileMenu&&<div className="popover profile-pop"><strong>Demo role</strong>{roles.map(r=><button key={r} onClick={()=>changeRole(r)} className={role===r?'selected':''}>{r}{role===r?' ✓':''}</button>)}<button className="logout" onClick={signOut}><LogOut size={15}/> Sign out</button></div>}</div></div></header>
   <main className="content">{!record?.in&&!promptHidden&&<div className="timein-prompt"><span className="timein-icon"><Clock3 size={20}/></span><div><strong>You have not timed in today</strong><p>Signing in does not record attendance. Tap Time In when you start your shift at {branch==='All branches'?homeBranch[role]||'Guimba':branch} branch.</p></div><Button icon={Clock3} onClick={timeIn}>Time In now</Button><button className="timein-later" onClick={()=>setPromptHidden(true)}>Later</button></div>}<Page key={page} {...ctx}/></main><footer className="app-footer">ARC Anti Rabies Clinic prototype · Fictional demo data · Local browser state only</footer>
  </div>{signOutPrompt&&<Modal title="Time Out before signing out?" onClose={()=>setSignOutPrompt(false)} footer={<><Button variant="secondary" onClick={()=>setSignOutPrompt(false)}>Cancel</Button><Button variant="secondary" onClick={()=>finishSignOut(false)}>Sign out only</Button><Button icon={Clock3} onClick={()=>finishSignOut(true)}>Time Out & sign out</Button></>}><p className="card-note">You timed in at {record?.in} and have not timed out. Signing out does not end your shift. Choose “Sign out only” if you are switching users or stepping away.</p></Modal>}{toast&&<div className="toast"><span>✓</span>{toast}<button onClick={()=>setToast('')}><X size={15}/></button></div>}
 </div>
}
function ParticleField(){const ref=React.useRef(null);React.useEffect(()=>{const canvas=ref.current;if(!canvas)return;const ctx=canvas.getContext('2d');const reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches;let raf=0,dots=[],w=0,h=0;const resize=()=>{const r=canvas.parentElement.getBoundingClientRect();if(Math.abs(r.width-w)<1&&Math.abs(r.height-h)<1&&dots.length)return;const dpr=Math.min(window.devicePixelRatio||1,2);w=r.width;h=r.height;canvas.width=w*dpr;canvas.height=h*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);const n=Math.round(Math.min(72,Math.max(32,w*h/15000)));dots=Array.from({length:n},()=>({x:Math.random()*w,y:Math.random()*h,vx:(Math.random()-.5)*.42,vy:(Math.random()-.5)*.42,r:Math.random()*1.5+1.2,gold:Math.random()<.4}))};const draw=()=>{ctx.clearRect(0,0,w,h);if(!reduce)dots.forEach(p=>{p.x+=p.vx;p.y+=p.vy;if(p.x<0||p.x>w)p.vx*=-1;if(p.y<0||p.y>h)p.vy*=-1});const reach=128;for(let i=0;i<dots.length;i++)for(let j=i+1;j<dots.length;j++){const a=dots[i],b=dots[j],dx=a.x-b.x,dy=a.y-b.y,dist=Math.hypot(dx,dy);if(dist<reach){ctx.strokeStyle=`rgba(255,204,0,${(1-dist/reach)*.32})`;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke()}}dots.forEach(p=>{ctx.fillStyle=p.gold?'rgba(255,204,0,.92)':'rgba(186,230,226,.8)';ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,Math.PI*2);ctx.fill()})};const tick=()=>{draw();if(!reduce)raf=requestAnimationFrame(tick)};resize();const ro=new ResizeObserver(()=>{resize();if(reduce)draw()});ro.observe(canvas.parentElement);tick();return()=>{cancelAnimationFrame(raf);ro.disconnect()}},[]);return <canvas ref={ref} className="login-particles" aria-hidden="true"/>}
function Login({onLogin,theme,setTheme}){const [email,setEmail]=React.useState('');const [password,setPassword]=React.useState('');const [show,setShow]=React.useState(false);const [remember,setRemember]=React.useState(true);return <div className="login-page"><div className="login-left"><ParticleField/><div className="login-brand"><span className="brand-mark"><BrandLogo/></span><PartnerLogo/></div><div className="login-copy"><span className="login-kicker">ARC ANTI RABIES CLINIC</span><h1>One record across every branch.</h1><p>Admissions, vaccines, stock, and reports stay with the clinic that is caring for the patient.</p><div className="login-features"><div><span>01</span> Patient and PEP, from admission to the last dose</div><div><span>02</span> Stock and shifts, counted at each branch</div><div><span>03</span> Payments, attendance, and the DOH report</div></div></div><div className="login-copyright">© 2026 ARC Anti Rabies Clinic · UI prototype</div></div><div className="login-right"><ThemeToggle theme={theme} setTheme={setTheme} className="login-theme"/><form className="login-form" onSubmit={e=>{e.preventDefault();if(email&&password)onLogin()}}><div className="login-welcome"><span className="login-kicker">WELCOME BACK</span><h2>Sign in to your workspace</h2><p>Access your clinic operations dashboard.</p></div><label>Email or username<input required value={email} onChange={e=>setEmail(e.target.value)} placeholder="Enter any demo username"/></label><label>Password<div className="password-field"><input required type={show?'text':'password'} value={password} onChange={e=>setPassword(e.target.value)} placeholder="Enter any demo password"/><button type="button" onClick={()=>setShow(!show)}>{show?'Hide':'Show'}</button></div></label><label className="remember"><input type="checkbox" checked={remember} onChange={e=>setRemember(e.target.checked)}/> Remember me on this device</label><Button type="submit" className="login-submit">Sign in to ARC <ChevronRight size={16}/></Button><div className="demo-hint"><ShieldCheck size={17}/><span>Demo access: enter any username and password. Signing in does not record attendance; use Time In and Time Out inside the system.</span></div></form></div></div>}
