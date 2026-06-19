const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // Safe delete that ignores tables/models that may not exist yet.
  const safeDelete = async (model) => {
    try { if (prisma[model] && typeof prisma[model].deleteMany === 'function') await prisma[model].deleteMany(); }
    catch (e) { /* table not migrated yet — ignore */ }
  };
  // 1) Delete everything that references Project (and their own children) FIRST,
  //    so the project rows can then be removed without foreign-key errors.
  for (const m of [
    'punchItemActivity', 'punchItemAttachment', 'punchItemComment', 'inspectionApproval',
    'assignment', 'message', 'ledgerEntry', 'expenseCategory', 'dailyLog', 'punchItem',
    'commitment', 'document', 'bid', 'invoice', 'inspection', 'safetyIncident', 'equipment',
    'drawingVersion', 'planMarkup', 'scheduledReport', 'formTemplate', 'changeOrder',
  ]) await safeDelete(m);
  // 2) Now the parents.
  await prisma.project.deleteMany();
  await prisma.user.deleteMany();
  // 3) Standalone section tables (no Project FK).
  for (const m of ['observation', 'coordinationIssue', 'actionPlan', 'correspondence', 'crew', 'directoryContact', 'companyDoc', 'announcement']) await safeDelete(m);

  const users = await prisma.user.createMany({
    data: [
      { id: 'u-pm', email: 'pm@example.com', name: 'Project Manager', role: 'Project Manager' },
      { id: 'u-arch', email: 'arch@example.com', name: 'Architect', role: 'Architect' },
      { id: 'u-qs', email: 'qs@example.com', name: 'Quantity Surveyor', role: 'Quantity Surveyor' },
      { id: 'u-sm', email: 'manager@example.com', name: 'Site Manager', role: 'Contractor' },
    ],
  });

  const project = await prisma.project.create({
    data: {
      id: 'p-1',
      code: 'HFT-21',
      name: 'Hilton Financial Tower',
      city: 'Nairobi',
      value: '$14.2M',
      status: 'In Progress',
      progress: 62,
      exposure: '+$620k',
    },
  });

  await prisma.assignment.createMany({
    data: [
      { id: 'a-1', role: 'PM', userId: 'u-pm', projectId: project.id },
      { id: 'a-2', role: 'Architect', userId: 'u-arch', projectId: project.id },
      { id: 'a-3', role: 'QS', userId: 'u-qs', projectId: project.id },
    ],
  });

  await prisma.message.createMany({
    data: [
      { id: 'm-1', text: 'Architect uploaded updated Level 14 plan.', projectId: project.id, userId: 'u-sm' },
      { id: 'm-2', text: 'Cost delta noted in BOQ.', projectId: project.id, userId: 'u-qs' },
    ],
  });

  await prisma.ledgerEntry.createMany({
    data: [
      { id: 'l-1', date: new Date('2024-05-18'), desc: 'Owner draw #3 received', type: 'in', category: 'Owner funding', amountUSD: 420000, projectId: project.id },
      { id: 'l-2', date: new Date('2024-05-19'), desc: 'Concrete supplier progress billing', type: 'out', category: 'Materials', amountUSD: 88000, projectId: project.id },
      { id: 'l-3', date: new Date('2024-05-20'), desc: 'Field payroll (wages + overtime)', type: 'out', category: 'Labor', amountUSD: 152000, projectId: project.id },
    ],
  });

  await prisma.expenseCategory.createMany({
    data: [
      { id: 'e-1', name: 'Labor', budgetUSD: 500000, actualUSD: 420000, projectId: project.id },
      { id: 'e-2', name: 'Materials', budgetUSD: 420000, actualUSD: 350000, projectId: project.id },
      { id: 'e-3', name: 'Subcontract', budgetUSD: 320000, actualUSD: 280000, projectId: project.id },
      { id: 'e-4', name: 'Equipment', budgetUSD: 150000, actualUSD: 120000, projectId: project.id },
    ],
  });

  await prisma.dailyLog.createMany({
    data: [
      { id: 'd-1', date: new Date('2024-05-29'), crew: 'Concrete', headcount: 18, location: 'Tower A', notes: 'Poured level 12 slab; minor rain delay', projectId: project.id },
      { id: 'd-2', date: new Date('2024-05-28'), crew: 'MEP', headcount: 12, location: 'Podium', notes: 'Rough-in 2F complete; inspector scheduled', projectId: project.id },
    ],
  });

  await prisma.punchItem.createMany({
    data: [
      { id: 'p-1', code: 'PL-104', area: 'Level 12 corridor', desc: 'Replace damaged baseboard at grid C4', status: 'open', priority: 'medium', trade: 'Carpentry', projectId: project.id },
      { id: 'p-2', code: 'PL-105', area: 'Lobby', desc: 'Touch-up paint at east wall', status: 'in_progress', priority: 'low', trade: 'Painting', projectId: project.id },
      { id: 'p-3', code: 'PL-106', area: 'Roof', desc: 'Sealant at HVAC curb', status: 'closed', priority: 'medium', trade: 'Roofing', projectId: project.id },
    ],
  });

  await prisma.commitment.createMany({
    data: [
      { id: 'c-1', vendor: 'MEP Subcontract', scope: 'Mechanical/Plumbing', amount: '$1,200,000', due: 'Jun 15', projectId: project.id },
      { id: 'c-2', vendor: 'Concrete Supplier', scope: 'Ready-mix + pumping', amount: '$650,000', due: 'May 30', projectId: project.id },
      { id: 'c-3', vendor: 'Finishes Package', scope: 'Flooring & millwork', amount: '$480,000', due: 'Jul 02', projectId: project.id },
    ],
  });

  await prisma.document.createMany({
    data: [
      { id: 'doc-1', name: 'Safety Manual.pdf', url: 'https://example.com/safety.pdf', size: '2.4 MB', updated: 'Today', projectId: project.id },
      { id: 'doc-2', name: 'Insurance-Certificate.pdf', url: 'https://example.com/insurance.pdf', size: '620 KB', updated: 'Yesterday', projectId: project.id },
    ],
  });

  await prisma.changeOrder.createMany({
    data: [
      { id: 'co-1', number: 'CO-1258', title: 'Additional VAV boxes — east wing reconfiguration', area: 'Level 14 — Mechanical', description: 'Owner-requested HVAC capacity increase drove 8 additional VAV boxes, supplementary ductwork, and rerouting. 18-day material lead time impacts critical path.', status: 'owner_approval', trigger: 'Design clarification', rfi: 'RFI #284', costUSD: 284000, scheduleImpactDays: 4, requestedBy: 'Sarah Patel', submittedDate: '2026-05-16', assignees: JSON.stringify(['u-pm', 'u-architect']), projectId: project.id },
      { id: 'co-2', number: 'CO-1284', title: 'Curtain wall reinforcement', area: 'Curtain Wall — East', description: 'Structural review required added reinforcement at the east curtain wall connections.', status: 'pm_review', trigger: 'Structural review', rfi: 'RFI #301', costUSD: 24500, scheduleImpactDays: 1, requestedBy: 'James Chen', submittedDate: '2026-05-20', assignees: JSON.stringify(['u-architect']), projectId: project.id },
      { id: 'co-3', number: 'CO-1252', title: 'Owner-approved electrical reroute', area: 'Level 12 — Electrical', description: 'Owner-requested electrical reroute to accommodate revised tenant layout. No schedule impact.', status: 'approved', trigger: 'Owner request', rfi: 'RFI #277', costUSD: 86500, scheduleImpactDays: 0, requestedBy: 'Marcus Rivera', submittedDate: '2026-05-12', assignees: JSON.stringify(['u-super']), projectId: project.id },
      { id: 'co-4', number: 'CO-1290', title: 'Unforeseen rock excavation — north footing', area: 'Foundations — North', description: 'Unforeseen rock encountered during excavation requiring blasting and extended haulage.', status: 'drafted', trigger: 'Unforeseen condition', rfi: 'RFI #310', costUSD: 142000, scheduleImpactDays: 6, requestedBy: 'David Kimani', submittedDate: '2026-06-02', assignees: JSON.stringify(['u-pm', 'u-super']), projectId: project.id },
    ],
  });

  // ===== Section demo data =====
  await prisma.observation.createMany({
    data: [
      { id: 'obs-101', title: 'Exposed rebar at column C4 not covered', type: 'Safety', status: 'open', priority: 'high', location: 'Level 2 — Grid C4', project: 'Westside Tower', assignee: 'James Mwangi', date: '2026-06-10', description: 'Rebar protruding from column formwork without protective caps. Risk of impalement injury.', photos: 2 },
      { id: 'obs-102', title: 'Honeycombing on slab soffit', type: 'Quality', status: 'in_review', priority: 'medium', location: 'Level 1 — Zone B', project: 'Westside Tower', assignee: 'Grace Njeri', date: '2026-06-09', description: 'Visible honeycombing on slab soffit after formwork removal. Needs repair method statement.', photos: 3 },
      { id: 'obs-103', title: 'Silt runoff into storm drain', type: 'Environmental', status: 'open', priority: 'medium', location: 'Site perimeter — East', project: 'Riverside Mall', assignee: 'Peter Otieno', date: '2026-06-08', description: 'Silt fence damaged, sediment entering municipal storm drain after rains.', photos: 1 },
      { id: 'obs-104', title: 'AHU vibration isolators missing', type: 'Commissioning', status: 'closed', priority: 'low', location: 'Roof plant room', project: 'Riverside Mall', assignee: 'Mary Wanjiku', date: '2026-06-05', description: 'AHU-02 installed without spring isolators per spec section 23 05 48. Now corrected.', photos: 2 },
    ],
  });

  await prisma.coordinationIssue.createMany({
    data: [
      { id: 'rfi-045', title: 'Beam depth conflict with HVAC duct at Grid 5-B', type: 'Clash', status: 'open', priority: 'high', raisedBy: 'James Mwangi', assignedTo: 'Architect — Lena Hassan', project: 'Westside Tower', date: '2026-06-10', description: '600mm deep beam at Grid 5-B clashes with the 400mm main supply duct. Ceiling zone only allows 350mm clearance.', comments: JSON.stringify([{ author: 'Lena Hassan', text: 'Reviewing with structural. Likely duct reroute via corridor.', date: '2026-06-11' }]) },
      { id: 'rfi-046', title: 'Window schedule W-07 missing head detail', type: 'RFI', status: 'answered', priority: 'medium', raisedBy: 'Grace Njeri', assignedTo: 'Architect — Lena Hassan', project: 'Westside Tower', date: '2026-06-08', description: 'Drawing A-501 references head detail 7/A-510 for window type W-07 but that detail is not on the sheet.', comments: JSON.stringify([{ author: 'Lena Hassan', text: 'Detail issued in revision A-510 Rev C, transmitted today.', date: '2026-06-09' }]) },
      { id: 'rfi-044', title: 'Concrete grade for ground beams — confirm C30/37', type: 'Design Question', status: 'closed', priority: 'low', raisedBy: 'Peter Otieno', assignedTo: 'Engineer — David Kim', project: 'Riverside Mall', date: '2026-06-02', description: 'Spec says C30/37 but drawing S-201 notes C25/30 for ground beams. Which governs?', comments: JSON.stringify([{ author: 'David Kim', text: 'C30/37 governs. Drawing updated in S-201 Rev D.', date: '2026-06-03' }]) },
    ],
  });

  await prisma.actionPlan.createMany({
    data: [
      { id: 'ap-201', title: 'Rectify honeycombing — Level 1 slab', source: 'OBS-102', owner: 'Grace Njeri', due: '2026-06-18', status: 'active', project: 'Westside Tower', items: JSON.stringify([{ id: 'i1', text: 'Submit repair method statement to Engineer', done: true }, { id: 'i2', text: 'Chip out loose concrete & clean surface', done: true }, { id: 'i3', text: 'Apply approved repair mortar', done: false }, { id: 'i4', text: 'Engineer inspection & sign-off', done: false }]) },
      { id: 'ap-202', title: 'Restore silt fencing — East perimeter', source: 'OBS-103', owner: 'Peter Otieno', due: '2026-06-12', status: 'overdue', project: 'Riverside Mall', items: JSON.stringify([{ id: 'i1', text: 'Procure replacement silt fence rolls', done: true }, { id: 'i2', text: 'Install fence along damaged section', done: false }, { id: 'i3', text: 'Clear sediment from storm drain inlet', done: false }]) },
      { id: 'ap-203', title: 'Scaffold safety compliance sweep', source: 'Safety audit W23', owner: 'James Mwangi', due: '2026-06-08', status: 'completed', project: 'Westside Tower', items: JSON.stringify([{ id: 'i1', text: 'Inspect all scaffold platforms for toe boards', done: true }, { id: 'i2', text: 'Replace missing guardrails', done: true }, { id: 'i3', text: 'Tag all compliant scaffolds', done: true }]) },
    ],
  });

  await prisma.correspondence.createMany({
    data: [
      { id: 'ltr-0089', subject: 'Notice of delay — inclement weather W23', type: 'Letter', direction: 'outgoing', status: 'sent', fromParty: 'Buildflex Construction Ltd', toParty: 'Westside Developments (Client)', project: 'Westside Tower', date: '2026-06-10', body: 'We hereby notify you of a 3-day delay to the programme arising from heavy rainfall recorded between 5-7 June 2026.', attachments: JSON.stringify(['Updated_Programme_RevF.pdf', 'Rainfall_Records_W23.pdf']) },
      { id: 'sub-0142', subject: 'Submittal — curtain wall shop drawings package 2', type: 'Submittal', direction: 'outgoing', status: 'responded', fromParty: 'Buildflex Construction Ltd', toParty: 'Lena Hassan (Architect)', project: 'Westside Tower', date: '2026-06-06', body: 'Please find attached curtain wall shop drawings package 2 covering elevations N2-N5 for review and approval.', attachments: JSON.stringify(['CW_ShopDwgs_Pkg2.pdf']) },
      { id: 'trn-0231', subject: 'Transmittal — revised structural drawings S-201 Rev D', type: 'Transmittal', direction: 'incoming', status: 'received', fromParty: 'David Kim (Engineer)', toParty: 'Buildflex Construction Ltd', project: 'Riverside Mall', date: '2026-06-04', body: 'Transmitting revised drawing S-201 Rev D incorporating concrete grade clarification per RFI-044.', attachments: JSON.stringify(['S-201_RevD.pdf']) },
    ],
  });

  await prisma.crew.createMany({
    data: [
      { id: 'crew-1', name: 'Concrete Crew A', trade: 'Concrete', foreman: 'Samuel Kariuki', project: 'Westside Tower', location: 'Tower core — Level 12', shift: 'Day', status: 'on_site', members: JSON.stringify([{ id: 'm1', name: 'Samuel Kariuki', trade: 'Foreman' }, { id: 'm2', name: 'Brian Omondi', trade: 'Steel Fixer' }, { id: 'm3', name: 'Dennis Mutua', trade: 'Concrete Finisher' }]) },
      { id: 'crew-2', name: 'MEP Rough-in Team', trade: 'MEP', foreman: 'Yuki Tanaka', project: 'Riverside Mall', location: 'Podium — 2F', shift: 'Day', status: 'on_site', members: JSON.stringify([{ id: 'm1', name: 'Yuki Tanaka', trade: 'Foreman' }, { id: 'm2', name: 'Carlos Mendez', trade: 'Plumber' }]) },
      { id: 'crew-3', name: 'Finishes Crew', trade: 'Finishes', foreman: 'Liam Park', project: 'Westside Tower', location: 'Lobby', shift: 'Night', status: 'off_site', members: JSON.stringify([{ id: 'm1', name: 'Liam Park', trade: 'Painter' }]) },
    ],
  });

  await prisma.directoryContact.createMany({
    data: [
      { id: 'dc-1', name: 'Lena Hassan', company: 'Hassan & Partners Architects', role: 'Lead Architect', category: 'Consultant', phone: '+254 712 345 678', email: 'lena@hassanpartners.co.ke', projects: JSON.stringify(['Westside Tower']) },
      { id: 'dc-2', name: 'David Kim', company: 'StructEng Consulting', role: 'Structural Engineer', category: 'Consultant', phone: '+254 723 456 789', email: 'dkim@structeng.co.ke', projects: JSON.stringify(['Westside Tower', 'Riverside Mall']) },
      { id: 'dc-3', name: 'Sarah Wairimu', company: 'Westside Developments Ltd', role: 'Development Manager', category: 'Client', phone: '+254 734 567 890', email: 's.wairimu@westside.co.ke', projects: JSON.stringify(['Westside Tower']) },
      { id: 'dc-4', name: 'Patrick Odhiambo', company: 'PowerVolt Electrical Ltd', role: 'Director', category: 'Subcontractor', phone: '+254 745 678 901', email: 'patrick@powervolt.co.ke', projects: JSON.stringify(['Westside Tower', 'Riverside Mall']) },
      { id: 'dc-5', name: 'Janet Muthoni', company: 'Bamburi Cement', role: 'Account Manager', category: 'Supplier', phone: '+254 756 789 012', email: 'j.muthoni@bamburi.co.ke', projects: JSON.stringify(['Riverside Mall']) },
    ],
  });

  await prisma.companyDoc.createMany({
    data: [
      { id: 'cd-1', name: 'Health & Safety Policy 2026.pdf', category: 'Policies', type: 'pdf', size: '1.2 MB', uploadedBy: 'Marcus Rivera', date: '2026-01-15' },
      { id: 'cd-2', name: 'Quality Management Manual.pdf', category: 'Policies', type: 'pdf', size: '3.4 MB', uploadedBy: 'Marcus Rivera', date: '2026-01-15' },
      { id: 'cd-3', name: 'Daily Site Report Template.xlsx', category: 'Templates', type: 'xlsx', size: '84 KB', uploadedBy: 'Grace Njeri', date: '2026-02-20' },
      { id: 'cd-4', name: 'ISO 9001:2015 Certificate.pdf', category: 'Certifications', type: 'pdf', size: '890 KB', uploadedBy: 'Marcus Rivera', date: '2026-01-10' },
      { id: 'cd-5', name: 'Contractors All-Risk Policy.pdf', category: 'Insurance', type: 'pdf', size: '2.1 MB', uploadedBy: 'Finance Team', date: '2026-01-20' },
      { id: 'cd-6', name: 'Employee Handbook 2026.pdf', category: 'HR', type: 'pdf', size: '4.8 MB', uploadedBy: 'HR Team', date: '2026-02-01' },
    ],
  });

  await prisma.announcement.createMany({
    data: [
      { id: 'ann-1', title: 'Site-wide safety stand-down — Friday 9am', body: 'Mandatory toolbox talk for all crews following the W23 scaffold findings. Attendance will be recorded.', author: 'Marcus Rivera', authorRole: 'Contractor', date: '2026-06-11', pinned: true, priority: 'urgent', audience: 'company', requireAck: true, ackCount: 18, readBy: 32, totalRecipients: 46 },
      { id: 'ann-2', title: 'Updated concrete pour schedule — Level 13', body: 'Pour window moved to Saturday 6am due to pump availability. Concrete crew to confirm readiness.', author: 'Grace Njeri', authorRole: 'Project Manager', date: '2026-06-10', pinned: false, priority: 'high', audience: 'project', project: 'Westside Tower', ackCount: 0, readBy: 12, totalRecipients: 20 },
      { id: 'ann-3', title: 'New timesheet submission cut-off', body: 'Timesheets are now due by 5pm every Friday. Late submissions will be processed in the next cycle.', author: 'HR Team', authorRole: 'Contractor', date: '2026-06-08', pinned: false, priority: 'normal', audience: 'company', ackCount: 0, readBy: 40, totalRecipients: 46 },
    ],
  });

  console.log('Seeded demo data');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
