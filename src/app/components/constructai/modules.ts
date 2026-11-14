// The four modules under Buildsasa AI. The page list is fixed by idea.md
// (section 5.1); nothing else may appear in navigation. Kept short on purpose: the AI is the
// front door and does most of the work from chat; these are the places to look
// things up. Pages hidden for the Kenyan market live in config/features.ts
// (HIDDEN_VIEWS) and are left out here.
import { FolderKanban, HardHat, Users, Wallet } from "lucide-react";
import type { View } from "./Sidebar";

export type ModuleTab = { key: View; label: string };
export type Module = { id: string; label: string; icon: any; hint: string; /** Placeholder for the ask-AI bar. */ ask: string; tabs: ModuleTab[] };

export const MODULES: Module[] = [
  { id: "projects", label: "Projects", icon: FolderKanban, hint: "Your sites and their programme", ask: "Plan a project, draft a programme, price a variation…", tabs: [
    { key: "projects", label: "All projects" },
    { key: "schedule", label: "Schedule" },
    { key: "floor-plan", label: "Floor plans" },
  ] },
  { id: "site", label: "Site", icon: HardHat, hint: "Daily logs, snags, checklists and the labour muster", ask: "Tell me what happened on site today…", tabs: [
    { key: "daily-log", label: "Daily log" },
    { key: "punch-list", label: "Snags" },
    { key: "checklists", label: "Checklists" },
    { key: "attendance", label: "Attendance" },
  ] },
  { id: "money", label: "Money", icon: Wallet, hint: "Quotes, invoices, spending and materials", ask: "Price a job in KES, find overdue invoices…", tabs: [
    { key: "quotes", label: "Quotes" },
    { key: "cost-estimate", label: "Cost estimate" },
    { key: "invoicing", label: "Invoices" },
    { key: "financials", label: "Budget & spending" },
    { key: "equipment", label: "Materials" },
  ] },
  { id: "people", label: "People", icon: Users, hint: "Your team and company documents", ask: "Invite someone, find a supplier's number…", tabs: [
    { key: "team", label: "Team" },
    { key: "company-docs", label: "Company documents" },
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
  v === "project-detail" ? MODULES[0] : MODULES.find((m) => m.tabs.some((t) => t.key === v));

/** Every page the AI may open, for the assistant's prompt and to check its answers. */
export const AI_VIEWS: ModuleTab[] = [...MODULES.flatMap((m) => m.tabs), { key: "billing", label: "Billing & plan" }, { key: "buildflex-ai", label: "Buildsasa AI" }];
