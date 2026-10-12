import type { View } from "./Sidebar";

export type Role =
  | "Contractor"
  | "Owner"
  | "Client"
  | "Executive"
  | "Project Manager"
  | "Site Engineer"
  | "Superintendent"
  | "Trade Lead"
  | "Foreman"
  | "Worker"
  | "Architect"
  | "Quantity Surveyor"
  | "QA/QC Officer"
  | "Viewer";

// Construction trades, one list for the whole app (crews, checklists, punch
// list, schedule, bidding, profiles). Ordered by how often Kenyan sites use
// them, so the common ones are at the top of every dropdown; grouped so a long
// list stays scannable. Existing names are kept exactly as before so records
// already saved keep their trade and colour. "Other" lets anyone type their own.
export type Trade = string;
export type TradeGroup = "Most common" | "Structure & envelope" | "Services (MEP)" | "Finishes & interiors" | "Civil & site works" | "Specialist";

export const TRADES: { name: Trade; group: TradeGroup; color: string; icon: string }[] = [
  // Most common first
  { name: "General",            group: "Most common", color: "#FF6B1A", icon: "🏗" },
  { name: "Masonry",            group: "Most common", color: "#78716C", icon: "🧱" },
  { name: "Concrete",           group: "Most common", color: "#525252", icon: "◼" },
  { name: "Steel Fixing",       group: "Most common", color: "#64748B", icon: "🔩" },
  { name: "Carpentry",          group: "Most common", color: "#A16207", icon: "🪵" },
  { name: "Electrical",         group: "Most common", color: "#F5A623", icon: "⚡" },
  { name: "Plumbing",           group: "Most common", color: "#3B82F6", icon: "🚰" },
  { name: "Painting",           group: "Most common", color: "#8B5CF6", icon: "🎨" },
  { name: "Tiling & Flooring",  group: "Most common", color: "#0EA5E9", icon: "▦" },
  // Structure & envelope
  { name: "Roofing",            group: "Structure & envelope", color: "#EF4444", icon: "🏠" },
  { name: "Structural Steel",   group: "Structure & envelope", color: "#475569", icon: "🏗" },
  { name: "Welding & Fabrication", group: "Structure & envelope", color: "#F97316", icon: "🔥" },
  { name: "Glazing & Aluminium", group: "Structure & envelope", color: "#38BDF8", icon: "🪟" },
  { name: "Waterproofing",      group: "Structure & envelope", color: "#0284C7", icon: "💧" },
  { name: "Scaffolding",        group: "Structure & envelope", color: "#A3A3A3", icon: "🪜" },
  { name: "Demolition",         group: "Structure & envelope", color: "#B91C1C", icon: "🔨" },
  // Services (MEP)
  { name: "HVAC",               group: "Services (MEP)", color: "#06B6D4", icon: "❄️" },
  { name: "Fire & Security Systems", group: "Services (MEP)", color: "#DC2626", icon: "🧯" },
  { name: "Solar & Energy",     group: "Services (MEP)", color: "#EAB308", icon: "☀️" },
  { name: "Lifts & Escalators", group: "Services (MEP)", color: "#6366F1", icon: "🛗" },
  { name: "Data & Telecoms",    group: "Services (MEP)", color: "#14B8A6", icon: "📡" },
  // Finishes & interiors
  { name: "Plastering",         group: "Finishes & interiors", color: "#D6D3D1", icon: "🧰" },
  { name: "Drywall",            group: "Finishes & interiors", color: "#94A3B8", icon: "▭" },
  { name: "Ceilings & Partitions", group: "Finishes & interiors", color: "#CBD5E1", icon: "▤" },
  { name: "Joinery & Cabinetry", group: "Finishes & interiors", color: "#92400E", icon: "🚪" },
  { name: "Interior Design & Decor", group: "Finishes & interiors", color: "#EC4899", icon: "🛋" },
  { name: "Wallpaper & Finishes", group: "Finishes & interiors", color: "#C084FC", icon: "🖌" },
  // Civil & site works
  { name: "Earthwork",          group: "Civil & site works", color: "#8B6914", icon: "🚜" },
  { name: "Grading",            group: "Civil & site works", color: "#B45309", icon: "📐" },
  { name: "Drainage",           group: "Civil & site works", color: "#2563EB", icon: "🕳" },
  { name: "Asphalt & Paving",   group: "Civil & site works", color: "#1F2937", icon: "🛣" },
  { name: "Landscaping",        group: "Civil & site works", color: "#22C55E", icon: "🌿" },
  { name: "Fencing",            group: "Civil & site works", color: "#65A30D", icon: "🚧" },
  { name: "Bridge",             group: "Civil & site works", color: "#6B7280", icon: "🌉" },
  { name: "Traffic Control",    group: "Civil & site works", color: "#DC2626", icon: "🚧" },
  // Specialist
  { name: "Surveying",          group: "Specialist", color: "#0D9488", icon: "📏" },
  { name: "Cleaning & Handover", group: "Specialist", color: "#10B981", icon: "🧹" },
  { name: "Other",              group: "Specialist", color: "#5B6675", icon: "•" },
];
export const TRADE_GROUPS: TradeGroup[] = ["Most common", "Structure & envelope", "Services (MEP)", "Finishes & interiors", "Civil & site works", "Specialist"];
export const TRADE_NAMES: string[] = TRADES.map((t) => t.name);

export const TRADE_COLOR = (t: Trade) => TRADES.find((x) => x.name === t)?.color ?? "#5B6675";

export type Permissions = {
  views: View[];
  financials: boolean;
  approveAny: boolean;
  approveLimit: number;
  createCO: boolean;
  manageTeam: boolean;
  sharePlans: boolean;
  viewReports: boolean;
  viewAuditTrail: boolean;
  viewKanban: boolean;
  viewFieldApp: boolean;
  assignTasks: boolean;
  completeTasks: boolean;
  viewChecklists: boolean;
  useAI: boolean;
  isWorkspaceOwner: boolean;
  canCreateInspection: boolean;
  canFillInspection: boolean;
  canApproveInspection: boolean;
  canViewInspectionReports: boolean;
};

// ---------------------------------------------------------------------------
// Bidding / tendering permissions
// ---------------------------------------------------------------------------
// Bidding.tsx used to gate its manage buttons on `manageTeam || financials`,
// which did NOT match the backend's allow-list. An Architect and a Quantity
// Surveyor both pass that test, so both were shown "New tender", "Share bid
// link", "Award" and "Delete" — and every one of those calls came back 403.
// Two roles out of fourteen had a screen full of buttons that could not work.
//
// The two capabilities are now separate and explicit, because they are different
// decisions:
//
//   RUN the tender  — write the package, publish the link, log offline bids,
//                     shortlist and decline. This is tender administration; a QS
//                     or Architect does it in normal practice, so both are
//                     included (which is what the old UI already implied).
//
//   AWARD the work  — commit the company to a contract. Reserved to the
//                     principals. A QS or Architect recommends; they do not sign.
//
// IMPORTANT: these two lists are mirrored in backend/src/server.js as
// CAN_MANAGE_BIDS and CAN_AWARD_BIDS. Change one, change the other, or the UI
// will offer an action the API rejects — which is the bug this replaced.
export const BID_MANAGER_ROLES: Role[] = [
  "Contractor", "Owner", "Executive", "Project Manager", "Superintendent",
  "Quantity Surveyor", "Architect",
];
export const BID_AWARDER_ROLES: Role[] = [
  "Contractor", "Owner", "Executive", "Project Manager", "Superintendent",
];

export const canManageBids = (role: Role) => BID_MANAGER_ROLES.includes(role);
export const canAwardBids = (role: Role) => BID_AWARDER_ROLES.includes(role);

export const ROLES: Record<Role, Permissions> = {
  Contractor: {
    views: ["dashboard", "billing", "projects", "schedule","change-orders", "plans", "tasks", "documents", "daily-log", "attendance", "punch-list", "commitments", "financials", "reports", "team", "field-view", "inbox", "announcements", "observations", "action-plans", "coordination", "correspondence", "crews", "directory", "subcontractors", "company-docs", "role-manager", "jobs", "bidding", "quotes", "invoicing", "inspections", "checklists", "safety-incidents", "equipment", "buildflex-ai"],
    financials: true, approveAny: true, approveLimit: Infinity, createCO: true, manageTeam: true,
    sharePlans: true, viewReports: true, viewAuditTrail: true, viewKanban: true, viewFieldApp: true,
    assignTasks: true, completeTasks: true, viewChecklists: true, useAI: true, isWorkspaceOwner: true,
    canCreateInspection: true, canFillInspection: true, canApproveInspection: true, canViewInspectionReports: true,
  },
  Client: {
    views: ["dashboard", "projects", "schedule","plans", "documents", "reports", "inbox", "announcements", "observations", "coordination", "correspondence", "directory", "subcontractors", "company-docs", "inspections", "checklists", "buildflex-ai"],
    financials: false, approveAny: false, approveLimit: 0, createCO: false, manageTeam: false,
    sharePlans: false, viewReports: true, viewAuditTrail: false, viewKanban: false, viewFieldApp: false,
    assignTasks: false, completeTasks: false, viewChecklists: false, useAI: true, isWorkspaceOwner: false,
    canCreateInspection: false, canFillInspection: false, canApproveInspection: false, canViewInspectionReports: true,
  },
  Architect: {
    views: ["dashboard", "projects", "schedule","change-orders", "plans", "tasks", "documents", "daily-log", "attendance", "punch-list", "commitments", "financials", "team", "reports", "inbox", "announcements", "observations", "action-plans", "coordination", "correspondence", "directory", "subcontractors", "company-docs", "role-manager", "jobs", "bidding", "quotes", "invoicing", "inspections", "checklists", "safety-incidents", "equipment", "buildflex-ai"],
    financials: true, approveAny: false, approveLimit: 0, createCO: false, manageTeam: false,
    sharePlans: true, viewReports: true, viewAuditTrail: true, viewKanban: true, viewFieldApp: true,
    assignTasks: false, completeTasks: false, viewChecklists: true, useAI: true, isWorkspaceOwner: false,
    canCreateInspection: false, canFillInspection: true, canApproveInspection: true, canViewInspectionReports: true,
  },
  "Quantity Surveyor": {
    views: ["dashboard", "projects", "schedule","change-orders", "plans", "tasks", "documents", "daily-log", "attendance", "punch-list", "commitments", "financials", "reports", "team", "inbox", "announcements", "observations", "action-plans", "coordination", "correspondence", "directory", "subcontractors", "company-docs", "role-manager", "jobs", "bidding", "quotes", "invoicing", "inspections", "checklists", "safety-incidents", "equipment", "buildflex-ai"],
    financials: true, approveAny: false, approveLimit: 0, createCO: true, manageTeam: false,
    sharePlans: true, viewReports: true, viewAuditTrail: true, viewKanban: true, viewFieldApp: true,
    assignTasks: false, completeTasks: false, viewChecklists: true, useAI: true, isWorkspaceOwner: false,
    canCreateInspection: false, canFillInspection: true, canApproveInspection: true, canViewInspectionReports: true,
  },
  "QA/QC Officer": {
    views: ["projects", "schedule","plans", "tasks", "documents", "daily-log", "attendance", "punch-list", "field-view", "inbox", "announcements", "observations", "action-plans", "coordination", "correspondence", "directory", "subcontractors", "company-docs", "inspections", "checklists", "safety-incidents", "equipment", "buildflex-ai"],
    financials: false, approveAny: false, approveLimit: 0, createCO: false, manageTeam: false,
    sharePlans: true, viewReports: false, viewAuditTrail: true, viewKanban: true, viewFieldApp: true,
    assignTasks: false, completeTasks: true, viewChecklists: true, useAI: true, isWorkspaceOwner: false,
    canCreateInspection: true, canFillInspection: true, canApproveInspection: true, canViewInspectionReports: true,
  },
  Owner: {
    views: ["dashboard", "billing", "projects", "schedule","change-orders", "plans", "documents", "daily-log", "attendance", "punch-list", "commitments", "financials", "reports", "inbox", "announcements", "observations", "action-plans", "coordination", "correspondence", "directory", "subcontractors", "company-docs", "role-manager", "jobs", "bidding", "quotes", "invoicing", "inspections", "checklists", "safety-incidents", "equipment", "buildflex-ai"],
    financials: true, approveAny: true, approveLimit: Infinity, createCO: false, manageTeam: false,
    sharePlans: false, viewReports: true, viewAuditTrail: true, viewKanban: false, viewFieldApp: false,
    assignTasks: false, completeTasks: false, viewChecklists: true, useAI: true, isWorkspaceOwner: false,
    canCreateInspection: false, canFillInspection: false, canApproveInspection: false, canViewInspectionReports: true,
  },
  Executive: {
    views: ["dashboard", "billing", "projects", "schedule","change-orders", "plans", "tasks", "documents", "daily-log", "attendance", "punch-list", "commitments", "financials", "reports", "team", "inbox", "announcements", "observations", "action-plans", "coordination", "correspondence", "crews", "directory", "subcontractors", "company-docs", "role-manager", "jobs", "bidding", "quotes", "invoicing", "inspections", "checklists", "safety-incidents", "equipment", "buildflex-ai"],
    financials: true, approveAny: true, approveLimit: 500_000, createCO: true, manageTeam: true,
    sharePlans: true, viewReports: true, viewAuditTrail: true, viewKanban: true, viewFieldApp: false,
    assignTasks: true, completeTasks: false, viewChecklists: true, useAI: true, isWorkspaceOwner: false,
    canCreateInspection: true, canFillInspection: true, canApproveInspection: false, canViewInspectionReports: true,
  },
  "Project Manager": {
    views: ["dashboard", "projects", "schedule","change-orders", "plans", "tasks", "documents", "daily-log", "attendance", "punch-list", "commitments", "financials", "team", "inbox", "announcements", "observations", "action-plans", "coordination", "correspondence", "crews", "directory", "subcontractors", "company-docs", "role-manager", "jobs", "bidding", "quotes", "invoicing", "inspections", "checklists", "safety-incidents", "equipment", "buildflex-ai"],
    financials: true, approveAny: true, approveLimit: 250_000, createCO: true, manageTeam: false,
    sharePlans: true, viewReports: false, viewAuditTrail: true, viewKanban: true, viewFieldApp: true,
    assignTasks: true, completeTasks: false, viewChecklists: true, useAI: true, isWorkspaceOwner: false,
    canCreateInspection: true, canFillInspection: true, canApproveInspection: false, canViewInspectionReports: true,
  },
  "Site Engineer": {
    views: ["projects", "schedule","plans", "tasks", "documents", "daily-log", "attendance", "punch-list", "field-view", "inbox", "announcements", "observations", "action-plans", "coordination", "correspondence", "crews", "directory", "subcontractors", "company-docs", "inspections", "checklists", "safety-incidents", "equipment", "buildflex-ai"],
    financials: false, approveAny: false, approveLimit: 0, createCO: false, manageTeam: false,
    sharePlans: true, viewReports: false, viewAuditTrail: false, viewKanban: true, viewFieldApp: true,
    assignTasks: true, completeTasks: true, viewChecklists: true, useAI: true, isWorkspaceOwner: false,
    canCreateInspection: true, canFillInspection: true, canApproveInspection: false, canViewInspectionReports: true,
  },
  Superintendent: {
    views: ["projects", "schedule","change-orders", "plans", "tasks", "documents", "daily-log", "attendance", "punch-list", "commitments", "financials", "field-view", "inbox", "announcements", "observations", "action-plans", "coordination", "correspondence", "crews", "directory", "subcontractors", "company-docs", "role-manager", "jobs", "bidding", "quotes", "invoicing", "inspections", "checklists", "safety-incidents", "equipment", "buildflex-ai"],
    financials: true, approveAny: false, approveLimit: 0, createCO: true, manageTeam: false,
    sharePlans: true, viewReports: false, viewAuditTrail: true, viewKanban: true, viewFieldApp: true,
    assignTasks: true, completeTasks: true, viewChecklists: true, useAI: true, isWorkspaceOwner: false,
    canCreateInspection: true, canFillInspection: true, canApproveInspection: false, canViewInspectionReports: true,
  },
  "Trade Lead": {
    views: ["projects", "schedule","plans", "tasks", "documents", "daily-log", "attendance", "punch-list", "field-view", "inbox", "announcements", "observations", "action-plans", "coordination", "correspondence", "crews", "directory", "subcontractors", "company-docs", "role-manager", "bidding", "invoicing", "inspections", "checklists", "safety-incidents", "equipment", "buildflex-ai"],
    financials: false, approveAny: false, approveLimit: 0, createCO: true, manageTeam: false,
    sharePlans: false, viewReports: false, viewAuditTrail: false, viewKanban: false, viewFieldApp: true,
    assignTasks: true, completeTasks: true, viewChecklists: false, useAI: true, isWorkspaceOwner: false,
    canCreateInspection: true, canFillInspection: true, canApproveInspection: false, canViewInspectionReports: false,
  },
  Foreman: {
    views: ["projects", "schedule","plans", "tasks", "documents", "daily-log", "attendance", "punch-list", "field-view", "inbox", "announcements", "observations", "action-plans", "coordination", "correspondence", "crews", "directory", "subcontractors", "company-docs", "inspections", "checklists", "safety-incidents", "equipment", "buildflex-ai"],
    financials: false, approveAny: false, approveLimit: 0, createCO: false, manageTeam: false,
    sharePlans: false, viewReports: false, viewAuditTrail: false, viewKanban: false, viewFieldApp: true,
    assignTasks: false, completeTasks: true, viewChecklists: false, useAI: true, isWorkspaceOwner: false,
    canCreateInspection: true, canFillInspection: true, canApproveInspection: false, canViewInspectionReports: false,
  },
  Worker: {
    views: ["tasks", "plans", "documents", "daily-log", "attendance", "punch-list", "field-view", "attendance", "inbox", "announcements", "observations", "action-plans", "inspections", "checklists", "safety-incidents", "equipment", "buildflex-ai"],
    financials: false, approveAny: false, approveLimit: 0, createCO: false, manageTeam: false,
    sharePlans: false, viewReports: false, viewAuditTrail: false, viewKanban: false, viewFieldApp: true,
    assignTasks: false, completeTasks: true, viewChecklists: false, useAI: true, isWorkspaceOwner: false,
    canCreateInspection: false, canFillInspection: true, canApproveInspection: false, canViewInspectionReports: false,
  },
  Viewer: {
    views: ["dashboard", "projects", "schedule","change-orders", "plans", "documents", "daily-log", "attendance", "punch-list", "commitments", "inbox", "announcements", "observations", "coordination", "correspondence", "directory", "subcontractors", "company-docs", "role-manager", "bidding", "invoicing", "inspections", "checklists", "safety-incidents", "equipment", "buildflex-ai"],
    financials: false, approveAny: false, approveLimit: 0, createCO: false, manageTeam: false,
    sharePlans: false, viewReports: false, viewAuditTrail: true, viewKanban: false, viewFieldApp: false,
    assignTasks: false, completeTasks: false, viewChecklists: false, useAI: false, isWorkspaceOwner: false,
    canCreateInspection: false, canFillInspection: false, canApproveInspection: false, canViewInspectionReports: true,
  },
};

export const ROLE_COLORS: Record<Role, string> = {
  Contractor: "#FF6B1A",
  Owner: "#8B5CF6",
  Client: "#A78BFA",
  Executive: "#EF4444",
  "Project Manager": "#3B82F6",
  "Site Engineer": "#6366F1",
  Superintendent: "#F5A623",
  Architect: "#14B8A6",
  "Quantity Surveyor": "#F59E0B",
  "QA/QC Officer": "#EC4899",
  "Trade Lead": "#06B6D4",
  Foreman: "#0EA5E9",
  Worker: "#22C55E",
  Viewer: "#5B6675",
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  Contractor: "Workspace owner · the GC running the build. Can also be the project Owner.",
  Owner: "Client / developer paying for the project. Approves budget & change orders.",
  Client: "Project client with read access to progress, reports, and inspection results.",
  Executive: "Office leadership / assistant. Helps the Contractor manage projects & approvals.",
  "Project Manager": "Runs day-to-day on one or more projects. Approves change orders up to a configured limit.",
  "Site Engineer": "On-site technical lead. Coordinates inspections, tasks, and quality readiness.",
  Superintendent: "Jobsite lead. Assigns daily tasks to crews & trade leads.",
  Architect: "Design lead. Reviews plans, comments, and coordinates field clarifications.",
  "Quantity Surveyor": "Cost control. Tracks BOQs, validates quantities, and supports financial reporting.",
  "QA/QC Officer": "Quality assurance specialist. Creates inspections, fills checklists, and verifies compliance.",
  "Trade Lead": "Head of a sub-crew (Electrical, Plumbing, HVAC, etc.). Accepts & assigns tasks.",
  Foreman: "Crew foreman. Oversees workers on site and supports task completion.",
  Worker: "Tradesperson on the jobsite. Mobile-first: view tasks, mark done, upload photos.",
  Viewer: "Read-only: architect, inspector, lender, or stakeholder.",
};
