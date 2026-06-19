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

export type Trade =
  | "General"
  | "Electrical"
  | "Plumbing"
  | "Painting"
  | "Carpentry"
  | "HVAC"
  | "Masonry"
  | "Roofing"
  | "Drywall"
  | "Concrete"
  | "Landscaping"
  | "Earthwork"
  | "Asphalt & Paving"
  | "Grading"
  | "Drainage"
  | "Bridge"
  | "Traffic Control";

export const TRADES: { name: Trade; color: string; icon: string }[] = [
  { name: "General",     color: "#FF6B1A", icon: "🏗" },
  { name: "Electrical",  color: "#F5A623", icon: "⚡" },
  { name: "Plumbing",    color: "#3B82F6", icon: "🚰" },
  { name: "Painting",    color: "#8B5CF6", icon: "🎨" },
  { name: "Carpentry",   color: "#A16207", icon: "🪵" },
  { name: "HVAC",        color: "#06B6D4", icon: "❄️" },
  { name: "Masonry",     color: "#78716C", icon: "🧱" },
  { name: "Roofing",     color: "#EF4444", icon: "🏠" },
  { name: "Drywall",     color: "#94A3B8", icon: "▭" },
  { name: "Concrete",    color: "#525252", icon: "◼" },
  { name: "Landscaping", color: "#22C55E", icon: "🌿" },
  { name: "Earthwork",         color: "#8B6914", icon: "🚜" },
  { name: "Asphalt & Paving",  color: "#1F2937", icon: "🛣" },
  { name: "Grading",           color: "#B45309", icon: "📐" },
  { name: "Drainage",          color: "#2563EB", icon: "🕳" },
  { name: "Bridge",            color: "#6B7280", icon: "🌉" },
  { name: "Traffic Control",   color: "#DC2626", icon: "🚧" },
];

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

export const ROLES: Record<Role, Permissions> = {
  Contractor: {
    views: ["dashboard", "billing", "projects", "change-order", "change-orders", "plans", "tasks", "documents", "daily-log", "attendance", "punch-list", "commitments", "financials", "reports", "team", "mobile-create", "field-view", "inbox", "announcements", "observations", "action-plans", "coordination", "correspondence", "crews", "directory", "company-docs", "role-manager", "bidding", "invoicing", "inspections", "checklists", "safety-incidents", "equipment", "buildflex-ai"],
    financials: true, approveAny: true, approveLimit: Infinity, createCO: true, manageTeam: true,
    sharePlans: true, viewReports: true, viewAuditTrail: true, viewKanban: true, viewFieldApp: true,
    assignTasks: true, completeTasks: true, viewChecklists: true, useAI: true, isWorkspaceOwner: true,
    canCreateInspection: true, canFillInspection: true, canApproveInspection: true, canViewInspectionReports: true,
  },
  Client: {
    views: ["dashboard", "projects", "plans", "documents", "reports", "inbox", "announcements", "observations", "coordination", "correspondence", "directory", "company-docs", "inspections", "checklists", "buildflex-ai"],
    financials: false, approveAny: false, approveLimit: 0, createCO: false, manageTeam: false,
    sharePlans: false, viewReports: true, viewAuditTrail: false, viewKanban: false, viewFieldApp: false,
    assignTasks: false, completeTasks: false, viewChecklists: false, useAI: true, isWorkspaceOwner: false,
    canCreateInspection: false, canFillInspection: false, canApproveInspection: false, canViewInspectionReports: true,
  },
  Architect: {
    views: ["dashboard", "projects", "change-order", "change-orders", "plans", "tasks", "documents", "daily-log", "attendance", "punch-list", "commitments", "financials", "team", "reports", "inbox", "announcements", "observations", "action-plans", "coordination", "correspondence", "directory", "company-docs", "role-manager", "bidding", "invoicing", "inspections", "checklists", "safety-incidents", "equipment", "buildflex-ai"],
    financials: true, approveAny: false, approveLimit: 0, createCO: false, manageTeam: false,
    sharePlans: true, viewReports: true, viewAuditTrail: true, viewKanban: true, viewFieldApp: true,
    assignTasks: false, completeTasks: false, viewChecklists: true, useAI: true, isWorkspaceOwner: false,
    canCreateInspection: false, canFillInspection: true, canApproveInspection: true, canViewInspectionReports: true,
  },
  "Quantity Surveyor": {
    views: ["dashboard", "projects", "change-order", "change-orders", "plans", "tasks", "documents", "daily-log", "attendance", "punch-list", "commitments", "financials", "reports", "team", "inbox", "announcements", "observations", "action-plans", "coordination", "correspondence", "directory", "company-docs", "role-manager", "bidding", "invoicing", "inspections", "checklists", "safety-incidents", "equipment", "buildflex-ai"],
    financials: true, approveAny: false, approveLimit: 0, createCO: true, manageTeam: false,
    sharePlans: true, viewReports: true, viewAuditTrail: true, viewKanban: true, viewFieldApp: true,
    assignTasks: false, completeTasks: false, viewChecklists: true, useAI: true, isWorkspaceOwner: false,
    canCreateInspection: false, canFillInspection: true, canApproveInspection: true, canViewInspectionReports: true,
  },
  "QA/QC Officer": {
    views: ["projects", "plans", "tasks", "documents", "daily-log", "attendance", "punch-list", "field-view", "mobile-create", "inbox", "announcements", "observations", "action-plans", "coordination", "correspondence", "directory", "company-docs", "inspections", "checklists", "safety-incidents", "equipment", "buildflex-ai"],
    financials: false, approveAny: false, approveLimit: 0, createCO: false, manageTeam: false,
    sharePlans: true, viewReports: false, viewAuditTrail: true, viewKanban: true, viewFieldApp: true,
    assignTasks: false, completeTasks: true, viewChecklists: true, useAI: true, isWorkspaceOwner: false,
    canCreateInspection: true, canFillInspection: true, canApproveInspection: true, canViewInspectionReports: true,
  },
  Owner: {
    views: ["dashboard", "billing", "projects", "change-order", "change-orders", "plans", "documents", "daily-log", "attendance", "punch-list", "commitments", "financials", "reports", "inbox", "announcements", "observations", "action-plans", "coordination", "correspondence", "directory", "company-docs", "role-manager", "bidding", "invoicing", "inspections", "checklists", "safety-incidents", "equipment", "buildflex-ai"],
    financials: true, approveAny: true, approveLimit: Infinity, createCO: false, manageTeam: false,
    sharePlans: false, viewReports: true, viewAuditTrail: true, viewKanban: false, viewFieldApp: false,
    assignTasks: false, completeTasks: false, viewChecklists: true, useAI: true, isWorkspaceOwner: false,
    canCreateInspection: false, canFillInspection: false, canApproveInspection: false, canViewInspectionReports: true,
  },
  Executive: {
    views: ["dashboard", "billing", "projects", "change-order", "change-orders", "plans", "tasks", "documents", "daily-log", "attendance", "punch-list", "commitments", "financials", "reports", "team", "inbox", "announcements", "observations", "action-plans", "coordination", "correspondence", "crews", "directory", "company-docs", "role-manager", "bidding", "invoicing", "inspections", "checklists", "safety-incidents", "equipment", "buildflex-ai"],
    financials: true, approveAny: true, approveLimit: 500_000, createCO: true, manageTeam: true,
    sharePlans: true, viewReports: true, viewAuditTrail: true, viewKanban: true, viewFieldApp: false,
    assignTasks: true, completeTasks: false, viewChecklists: true, useAI: true, isWorkspaceOwner: false,
    canCreateInspection: true, canFillInspection: true, canApproveInspection: false, canViewInspectionReports: true,
  },
  "Project Manager": {
    views: ["dashboard", "projects", "change-order", "change-orders", "plans", "tasks", "documents", "daily-log", "attendance", "punch-list", "commitments", "financials", "team", "mobile-create", "inbox", "announcements", "observations", "action-plans", "coordination", "correspondence", "crews", "directory", "company-docs", "role-manager", "bidding", "invoicing", "inspections", "checklists", "safety-incidents", "equipment", "buildflex-ai"],
    financials: true, approveAny: true, approveLimit: 250_000, createCO: true, manageTeam: false,
    sharePlans: true, viewReports: false, viewAuditTrail: true, viewKanban: true, viewFieldApp: true,
    assignTasks: true, completeTasks: false, viewChecklists: true, useAI: true, isWorkspaceOwner: false,
    canCreateInspection: true, canFillInspection: true, canApproveInspection: false, canViewInspectionReports: true,
  },
  "Site Engineer": {
    views: ["projects", "plans", "tasks", "documents", "daily-log", "attendance", "punch-list", "field-view", "mobile-create", "inbox", "announcements", "observations", "action-plans", "coordination", "correspondence", "crews", "directory", "company-docs", "inspections", "checklists", "safety-incidents", "equipment", "buildflex-ai"],
    financials: false, approveAny: false, approveLimit: 0, createCO: false, manageTeam: false,
    sharePlans: true, viewReports: false, viewAuditTrail: false, viewKanban: true, viewFieldApp: true,
    assignTasks: true, completeTasks: true, viewChecklists: true, useAI: true, isWorkspaceOwner: false,
    canCreateInspection: true, canFillInspection: true, canApproveInspection: false, canViewInspectionReports: true,
  },
  Superintendent: {
    views: ["projects", "change-order", "change-orders", "plans", "tasks", "documents", "daily-log", "attendance", "punch-list", "commitments", "financials", "field-view", "mobile-create", "inbox", "announcements", "observations", "action-plans", "coordination", "correspondence", "crews", "directory", "company-docs", "role-manager", "bidding", "invoicing", "inspections", "checklists", "safety-incidents", "equipment", "buildflex-ai"],
    financials: true, approveAny: false, approveLimit: 0, createCO: true, manageTeam: false,
    sharePlans: true, viewReports: false, viewAuditTrail: true, viewKanban: true, viewFieldApp: true,
    assignTasks: true, completeTasks: true, viewChecklists: true, useAI: true, isWorkspaceOwner: false,
    canCreateInspection: true, canFillInspection: true, canApproveInspection: false, canViewInspectionReports: true,
  },
  "Trade Lead": {
    views: ["projects", "plans", "tasks", "documents", "daily-log", "attendance", "punch-list", "field-view", "mobile-create", "inbox", "announcements", "observations", "action-plans", "coordination", "correspondence", "crews", "directory", "company-docs", "role-manager", "bidding", "invoicing", "inspections", "checklists", "safety-incidents", "equipment", "buildflex-ai"],
    financials: false, approveAny: false, approveLimit: 0, createCO: true, manageTeam: false,
    sharePlans: false, viewReports: false, viewAuditTrail: false, viewKanban: false, viewFieldApp: true,
    assignTasks: true, completeTasks: true, viewChecklists: false, useAI: true, isWorkspaceOwner: false,
    canCreateInspection: true, canFillInspection: true, canApproveInspection: false, canViewInspectionReports: false,
  },
  Foreman: {
    views: ["projects", "plans", "tasks", "documents", "daily-log", "attendance", "punch-list", "field-view", "mobile-create", "inbox", "announcements", "observations", "action-plans", "coordination", "correspondence", "crews", "directory", "company-docs", "inspections", "checklists", "safety-incidents", "equipment", "buildflex-ai"],
    financials: false, approveAny: false, approveLimit: 0, createCO: false, manageTeam: false,
    sharePlans: false, viewReports: false, viewAuditTrail: false, viewKanban: false, viewFieldApp: true,
    assignTasks: false, completeTasks: true, viewChecklists: false, useAI: true, isWorkspaceOwner: false,
    canCreateInspection: true, canFillInspection: true, canApproveInspection: false, canViewInspectionReports: false,
  },
  Worker: {
    views: ["tasks", "plans", "documents", "daily-log", "attendance", "punch-list", "field-view", "mobile-create", "attendance", "inbox", "announcements", "observations", "action-plans", "inspections", "checklists", "safety-incidents", "equipment", "buildflex-ai"],
    financials: false, approveAny: false, approveLimit: 0, createCO: false, manageTeam: false,
    sharePlans: false, viewReports: false, viewAuditTrail: false, viewKanban: false, viewFieldApp: true,
    assignTasks: false, completeTasks: true, viewChecklists: false, useAI: true, isWorkspaceOwner: false,
    canCreateInspection: false, canFillInspection: true, canApproveInspection: false, canViewInspectionReports: false,
  },
  Viewer: {
    views: ["dashboard", "projects", "change-order", "change-orders", "plans", "documents", "daily-log", "attendance", "punch-list", "commitments", "inbox", "announcements", "observations", "coordination", "correspondence", "directory", "company-docs", "role-manager", "bidding", "invoicing", "inspections", "checklists", "safety-incidents", "equipment", "buildflex-ai"],
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
