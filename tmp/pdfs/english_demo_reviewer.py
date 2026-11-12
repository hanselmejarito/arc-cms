from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table, TableStyle
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from xml.sax.saxutils import escape

pdfmetrics.registerFont(TTFont('Arial','C:/Windows/Fonts/arial.ttf'))
pdfmetrics.registerFont(TTFont('Arial-Bold','C:/Windows/Fonts/arialbd.ttf'))
pdfmetrics.registerFontFamily('Arial',normal='Arial',bold='Arial-Bold',italic='Arial',boldItalic='Arial-Bold')
out='output/pdf/ARC_Client_Demo_Reviewer_English.pdf'
styles=getSampleStyleSheet()
styles.add(ParagraphStyle(name='TitleX',fontName='Arial-Bold',fontSize=20,leading=24,textColor=colors.HexColor('#143D40'),spaceAfter=8))
styles.add(ParagraphStyle(name='SubX',fontName='Arial-Bold',fontSize=12,leading=16,textColor=colors.HexColor('#126A68'),spaceBefore=4,spaceAfter=6))
styles.add(ParagraphStyle(name='BodyX',fontName='Arial',fontSize=10.2,leading=14.3,textColor=colors.HexColor('#1F3436'),spaceAfter=5))
styles.add(ParagraphStyle(name='BulletX',fontName='Arial',fontSize=10.2,leading=14.2,leftIndent=12,firstLineIndent=-9,spaceAfter=6,textColor=colors.HexColor('#1F3436')))
styles.add(ParagraphStyle(name='SmallX',fontName='Arial',fontSize=9,leading=12.5,textColor=colors.HexColor('#45595B'),spaceAfter=5))
styles.add(ParagraphStyle(name='TagX',fontName='Arial-Bold',fontSize=8.3,leading=11,textColor=colors.HexColor('#8B6100'),spaceAfter=8))
story=[]
def p(t,style='BodyX'): story.append(Paragraph(t,styles[style]))
def head(title,tag): p(escape(tag.upper()),'TagX');p(escape(title),'TitleX')
def bullet(title,text): p('&#8226; <b>'+escape(title)+'</b> '+escape(text),'BulletX')
def say(text):
    box=Table([[Paragraph('<b>Suggested script</b><br/>'+escape(text),styles['BodyX'])]],colWidths=[170*mm])
    box.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),colors.HexColor('#EAF5F2')),('BOX',(0,0),(-1,-1),0.5,colors.HexColor('#A5D3CA')),('LEFTPADDING',(0,0),(-1,-1),10),('RIGHTPADDING',(0,0),(-1,-1),10),('TOPPADDING',(0,0),(-1,-1),8),('BOTTOMPADDING',(0,0),(-1,-1),6)]))
    story.append(box);story.append(Spacer(1,7))
def page(): story.append(PageBreak())

head('Client demonstration reviewer','ARC Clinic Management System | Presentation guide')
p('A readable script for the meeting, followed by a focused client decision list. Use fictional records during the demonstration.')
say('Good day. Today I will recap our October 27 discussion, demonstrate the current system, and ask for your decisions on the remaining operational rules. Some details came from our follow-up with HR and still need your review.')
p('Meeting flow','SubX')
bullet('1. Recap','Review the October 27 topics and confirm the shared understanding.')
bullet('2. Demonstrate','Show the working screens and print previews using fictional records.')
bullet('3. Decide','Ask only the remaining policy, access, and workflow questions.')
bullet('4. Close','Record decisions, responsible persons, and the next testing date.')
p('Important context','SubX')
bullet('Signed baseline','The client signed requirements v1.2. Use it as the agreed baseline; this meeting does not itself amend the agreement.')
bullet('October 27 and HR follow-up','Treat discussion points and HR-provided rules as working requirements until the client confirms the relevant details.')
bullet('Status','A feature being visible or deployed does not by itself establish client acceptance. Cross-branch referral and updated payroll require end-to-end validation.')
page()
head('October 27 discussion recap','Read this before the demo')
say('These are the topics we discussed on October 27. I will briefly recap them before showing the current workflow, then we can confirm any remaining details.')
for a,b in [
('1. Muñoz and Palayan','The 8:00 AM to 6:00 PM schedule, meal break, and overtime handling.'),
('2. Access','Clinic-only access and separate privileged accounts for the owners and administrator.'),
('3. Flu label','Change the Influvac service label to Flu, retaining product or brand information where appropriate.'),
('4. Reminders and forms','Appointment SMS reminders, signature-pad capture, and a patient photo on the admission printout.'),
('5. Other Treatments','ERIG, tetanus toxoid, Flu, pneumococcal, and hepatitis B treatments without an RER admission or registry number.'),
('6. Cross-branch referral','Continue treatment from one branch to another while tracking history, branch records, and completion.'),
('7. Pricing and discounts','Senior/PWD discounts, transaction pricing, and the proposed VetMed pricing.'),
('8. Employee and payroll','Payroll eligibility, resignation, account deactivation, rehire, and preservation of records.')]: bullet(a,b)
say('I will now show the current screens. After the demo, I will ask for decisions on the items that still need confirmation.')
page()
head('Guided demonstration','Use fictional data')
bullet('Patient and admission','Register a fictional patient; show address and municipality, patient photo, and the admission workflow.')
bullet('RER and signatures','Show exposure details, patient or guardian signing, Day 0 vaccinator signing, and the admission print preview. Confirm print clarity on paper.')
bullet('Treatment and SOAP','Show scheduled doses, vaccinator signature or upload, progress notes, and the SOAP print preview.')
bullet('Other Treatments','Select the patient, branch, and one or more services; show editable prices, valid stock batches, and saving as given. Stock is deducted when treatment is recorded; payment can follow.')
bullet('Payment and discount','Show a pending bill, editable prices, the Senior/PWD option, total, and paid view. Explain the current working assumption: a single 20% discount, without VAT in the demo.')
bullet('Inventory and reports','Show batch, expiry, and stock movement. Check that Other Treatments appear in sales and inventory and are excluded from RER/DOH exposure reporting.')
bullet('Attendance and payroll prints','Show morning and applicable night time-in/out, payroll eligibility, Attendance Summary, and Payroll Register. Treat amounts as working calculations pending HR and client review.')
p('Do not overstate status','SubX')
bullet('Referral','The Baloc Day 0 to Guimba continuation and report/completion scenario still needs a full end-to-end test.')
bullet('SMS','Do not present automatic SMS as live until the provider integration and actual sending are verified.')
bullet('RER payment','The current walk-in RER flow can require payment before a dose is recorded; this differs from Other Treatments.')
page()
head('Client decisions: operations','Ask after the demonstration')
bullet('1. Clinic-only access','Should access be restricted by clinic internet/IP, approved devices, or another method? Who may access the system outside the clinic, and how are outages or remote support handled?')
bullet('2. Privileged accounts','Who are the two owners and administrator, which branches may each access, and what actions may each perform? Each person should have an individual account.')
bullet('3. SMS reminders','Confirm the provider, budget, sender name, message wording, exact send times, patient consent/opt-out, and how failed sends should be handled. The proposed timing is one day before and on the appointment day.')
bullet('4. Consent, photos, and signatures','What consent process and wording should staff follow? Who may sign or upload doctor/vaccinator signatures, how is authorization documented, and how long are photos and signatures kept? Approve actual print clarity.')
bullet('5. Cross-branch referral','Who initiates and accepts the transfer? Which branch owns each dose and report entry? How should transferred, incomplete, and completed cases appear? Agree to test Baloc Day 0 through Guimba completion.')
bullet('6. VetMed','Who qualifies, which services and branches are eligible, and is the proposed PHP 500 ARV price per dose approved? How should eligibility and price changes appear on the bill?')
bullet('7. Discount and price exceptions','Confirm which services qualify for the 20% Senior/PWD discount, proof of eligibility, approval of manual price changes, and receipt breakdown. Confirm the no-VAT assumption with the clinic accountant. Flu uses the current default with one discount, not an additional fixed senior price.')
page()
head('Client decisions: HR and payroll','Validate with HR and the client')
say('The next items reflect our follow-up with HR. Please review the examples and confirm the intended rules before final payroll acceptance.')
bullet('8. Muñoz and Palayan','Confirm 8 AM-6 PM, the one-hour meal break, and that the ninth actual work hour is paid as overtime in addition to the daily rate. Confirm whether the meal break is fixed at 12-1 PM or flexible; earlier discussions described both.')
bullet('9. Grace and payable time','Confirm the 20-minute morning grace example and 15-minute OT filing/review threshold. How should actual work within the threshold be reviewed and paid? Confirm holiday/rest-day treatment and rates with HR/accounting.')
bullet('10. Straight duty and night shift','For Guimba and Cabanatuan, confirm separate morning and 4-11 PM night clock entries, no unpaid night break, the HR example of PHP 850 per shift plus night differential, and the differential rate and calculation. Night late/undertime was described as daily night rate divided by seven hours, per minute.')
bullet('11. Exceptions','Who reviews half-days, late or early departures, missed or interrupted meal breaks, missing punches, and corrections? What evidence and approval are required?')
bullet('12. Payroll eligibility and employee exit','Should disabling payroll eligibility affect prior payroll views, or only future periods? Confirm resignation/deactivation, unpaid final payroll, access removal, record retention, and rehire handling.')
bullet('13. HR reports','Do the attendance matrix and payroll register meet the manual forms? Confirm cutoff dates, employee classifications, allowances, deductions, and who prepares, checks, and approves each report.')
p('Payroll figures and rules should be checked against agreed sample cases and validated by the client\'s HR/accountant before real payroll. Night work beyond 11 PM and crossing midnight require further verification.','SmallX')
page()
head('Close the meeting','Record decisions and next steps')
say('For each open item, may we record whether it is approved, needs revision, or remains pending, along with the person responsible and the target date? We will use those decisions to prepare the next test and any necessary change request.')
p('Before the demonstration','SubX')
bullet('Demo environment','The latest code was observed as Ready on Vercel and the demo database migrations were applied. Sign in and smoke-test the actual demo before presenting; deployment status is not the same as end-to-end acceptance.')
bullet('Prepare data','The demo was reset with one superadmin and branches retained. Create fictional employees, a fictional patient, and stock batches; no real patient information is needed.')
bullet('Equipment','Test the pen tablet, camera, printer, signature clarity, and admission/SOAP/payroll print previews.')
p('Decision notes','SubX')
for i in range(6): p('________________________________________________________________________')
p('Reference: signed ARC Final Business and System Requirements v1.2, October 27 discussion, HR follow-up, and current demo/code review. This reviewer is a presentation aid and does not amend the agreement.','SmallX')

def footer(c,doc):
    c.setStrokeColor(colors.HexColor('#D4E2DE'));c.line(20*mm,17*mm,190*mm,17*mm)
    c.setFont('Arial',8);c.setFillColor(colors.HexColor('#607477'));c.drawString(20*mm,12*mm,'ARC CMS | Client demo reviewer');c.drawRightString(190*mm,12*mm,str(doc.page))
SimpleDocTemplate(out,pagesize=A4,rightMargin=20*mm,leftMargin=20*mm,topMargin=16*mm,bottomMargin=22*mm,title='ARC CMS Client Demo Reviewer - English').build(story,onFirstPage=footer,onLaterPages=footer)
print(out)
