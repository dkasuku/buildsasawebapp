// The six modules the workspace is organised into. Every page still exists; it
// now lives as a tab inside one module instead of its own sidebar row, so the
// sidebar stays short and Buildsasa AI (docked on the right) does the walking.
import { FolderKanban, FileText, HardHat, LayoutDashboard, Users, Wallet } from "lucide-react";
import type { View } from "./Sidebar";

export type ModuleTab = { key: View; label: string };
export type Module = { id: string; label: string; icon: any; hint: string; /** Placeholder for the ask-AI bar. */ ask: string; tabs: ModuleTab[] };

export const MODULES: Module[] = [
  { id: "home", label: "Home", icon: LayoutDashboard, hint: "Dashboard, inbox and announcements", ask: "Ask how your projects are doing, or what needs you today…", tabs: [
    { key: "dashboard", label: "Dashboard" },
    { key: "inbox", label: "Inbox" },
    { key: "announcements", label: "Announcements" },
  ] },
  { id: "projects", label: "Projects", icon: FolderKanban, hint: "Projects, schedule, drawings and changes", ask: "Plan a project, draft a programme, summarise a change order…", tabs: [
    { key: "projects", label: "All projects" },
    { key: "schedule", label: "Schedule" },
    { key: "plans", label: "Plans & drawings" },
    { key: "change-orders", label: "Change orders" },
    { key: "coordination", label: "Coordination" },
    { key: "correspondence", label: "Correspondence" },
  ] },
  { id: "site", label: "Site", icon: HardHat, hint: "Daily logs, checks, quality and safety", ask: "Write today's daily log, build a checklist, open the punch list…", tabs: [
    { key: "daily-log", label: "Daily log" },
    { key: "checklists", label: "Checklists" },
    { key: "tasks", label: "Assignments" },
    { key: "punch-list", label: "Punch list" },
    { key: "inspections", label: "Inspections" },
    { key: "observations", label: "Observations" },
    { key: "action-plans", label: "Action plans" },
    { key: "safety-incidents", label: "Safety" },
    { key: "attendance", label: "Attendance" },
    { key: "field-view", label: "Field view" },
  ] },
  { id: "money", label: "Money", icon: Wallet, hint: "Financials, quotes, invoices and stock", ask: "Estimate a job in KES, find overdue invoices…", tabs: [
    { key: "financials", label: "Financials" },
    { key: "commitments", label: "Commitments" },
    { key: "quotes", label: "Quotes" },
    { key: "invoicing", label: "Invoices" },
    { key: "equipment", label: "Inventory" },
    { key: "billing", label: "Billing & plan" },
  ] },
  { id: "people", label: "People", icon: Users, hint: "Team, crews, subcontractors and contacts", ask: "Find a subcontractor, check who was on site…", tabs: [
    { key: "team", label: "Team" },
    { key: "crews", label: "Crews" },
    { key: "subcontractors", label: "Subcontractors" },
    { key: "directory", label: "Directory" },
    { key: "role-manager", label: "Roles" },
  ] },
  { id: "files", label: "Files & reports", icon: FileText, hint: "Reports and documents", ask: "Write a progress report, summarise a document…", tabs: [
    { key: "reports", label: "Reports" },
    { key: "company-docs", label: "Company documents" },
    { key: "documents", label: "Unfiled documents" },
  ] },
];

// The ask bar's question and hint on each page, so it fits what you're doing.
const ASK: Partial<Record<View, { q: string; hint: string }>> = {
  "projects": { q: "Which project can I help with?", hint: "How is Kitengela House doing? Which projects are behind schedule?" },
  "project-detail": { q: "What do you need on this project?", hint: "Summarise progress, list open issues, draft a client update…" },
  "schedule": { q: "What should we plan?", hint: "Draft a programme for a 4-bedroom maisonette, or what's on the critical path?" },
  "plans": { q: "What do you need from the drawings?", hint: "List the latest revisions, or what's changed on the structural set?" },
  "change-orders": { q: "Which change can I help with?", hint: "Summarise pending change orders, or draft one for extra excavation…" },
  "coordination": { q: "What issue needs sorting out?", hint: "Which coordination issues are overdue? Draft a clash report…" },
  "correspondence": { q: "What would you like to write?", hint: "Draft a delay notice to the client, or summarise recent letters…" },
  "daily-log": { q: "What happened on site today?", hint: "12 workers, first-floor slab formwork, cement delivered at 10am…" },
  "checklists": { q: "What should we check?", hint: "Create a pre-pour concrete checklist, or an electrical first-fix checklist…" },
  "tasks": { q: "Who needs to do what?", hint: "Which checklists are overdue? Who is assigned to roofing?" },
  "punch-list": { q: "What needs fixing before handover?", hint: "Which snags are still open? Summarise the punch list by trade…" },
  "inspections": { q: "What are we inspecting?", hint: "Plan an inspection for the ring beam, or summarise failed inspections…" },
  "observations": { q: "What did you notice on site?", hint: "Log a safety observation, or which observations are still open?" },
  "action-plans": { q: "What needs a plan of action?", hint: "Draft corrective actions for a poor concrete finish…" },
  "safety-incidents": { q: "What happened, or how do we stay safe?", hint: "Report a near miss, or what PPE does a roofing crew need?" },
  "attendance": { q: "Who was on site?", hint: "Who was absent this week? How many labour-days on Kitengela House?" },
  "field-view": { q: "What do you need in the field?", hint: "What's my work for today? Show open items on my site…" },
  "financials": { q: "What would you like to know about money?", hint: "Which projects are over budget? What's my cash position?" },
  "commitments": { q: "Which order or subcontract?", hint: "What do we still owe subcontractors? Summarise open purchase orders…" },
  "quotes": { q: "What would you like to price?", hint: "Estimate materials for a 3-bedroom bungalow, or price a 50 m perimeter wall…" },
  "invoicing": { q: "Which invoice can I help with?", hint: "Which invoices are overdue? Draft an invoice for the roofing stage…" },
  "equipment": { q: "What do you need in stock?", hint: "What's running low? How much cement did we waste last month?" },
  "billing": { q: "Questions about your plan?", hint: "What does my plan include? How many Sasa Credits do I have left?" },
  "team": { q: "Who are you looking for?", hint: "Who is on the Kitengela House team? Who can approve change orders?" },
  "crews": { q: "Which crew can I help with?", hint: "Which crew is free next week? Plan crews for the roofing stage…" },
  "subcontractors": { q: "Which subcontractor do you need?", hint: "Find an electrical subcontractor, or compare plumbing bids…" },
  "directory": { q: "Who do you need to contact?", hint: "Find the structural engineer's number, or list our suppliers…" },
  "role-manager": { q: "Who should see what?", hint: "What can a site manager do? Who has access to financials?" },
  "reports": { q: "What report do you need?", hint: "Write a weekly progress report for Kitengela House…" },
  "company-docs": { q: "Which document are you after?", hint: "Find our NCA certificate, or which documents expire soon?" },
  "documents": { q: "Where should these files go?", hint: "Which unfiled documents belong to which project?" },
};
/** The ask bar's wording for a page, falling back to its module's hint. */
export const askFor = (v: View) => ASK[v] || { q: "What would you like to create?", hint: moduleOf(v)?.ask || "Ask Buildsasa AI…" };

/** The module a page belongs to. A project's own page sits under Projects. */
export const moduleOf = (v: View): Module | undefined =>
  v === "project-detail" ? MODULES[1] : MODULES.find((m) => m.tabs.some((t) => t.key === v));

/** Every page the AI may open, for the assistant's prompt and to check its answers. */
export const AI_VIEWS: ModuleTab[] = [...MODULES.flatMap((m) => m.tabs), { key: "buildflex-ai", label: "Buildsasa AI" }];
