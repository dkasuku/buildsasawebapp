// The six modules the workspace is organised into. Every page still exists; it
// now lives as a tab inside one module instead of its own sidebar row, so the
// sidebar stays short and Buildsasa AI (docked on the right) does the walking.
import { FolderKanban, FileText, HardHat, LayoutDashboard, Users, Wallet } from "lucide-react";
import type { View } from "./Sidebar";

export type ModuleTab = { key: View; label: string };
export type Module = { id: string; label: string; icon: any; hint: string; tabs: ModuleTab[] };

export const MODULES: Module[] = [
  { id: "home", label: "Home", icon: LayoutDashboard, hint: "Dashboard, inbox and announcements", tabs: [
    { key: "dashboard", label: "Dashboard" },
    { key: "inbox", label: "Inbox" },
    { key: "announcements", label: "Announcements" },
  ] },
  { id: "projects", label: "Projects", icon: FolderKanban, hint: "Projects, schedule, drawings and changes", tabs: [
    { key: "projects", label: "All projects" },
    { key: "schedule", label: "Schedule" },
    { key: "plans", label: "Plans & drawings" },
    { key: "change-orders", label: "Change orders" },
    { key: "coordination", label: "Coordination" },
    { key: "correspondence", label: "Correspondence" },
  ] },
  { id: "site", label: "Site", icon: HardHat, hint: "Daily logs, checks, quality and safety", tabs: [
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
  { id: "money", label: "Money", icon: Wallet, hint: "Financials, quotes, invoices and stock", tabs: [
    { key: "financials", label: "Financials" },
    { key: "commitments", label: "Commitments" },
    { key: "quotes", label: "Quotes" },
    { key: "invoicing", label: "Invoices" },
    { key: "equipment", label: "Inventory" },
    { key: "billing", label: "Billing & plan" },
  ] },
  { id: "people", label: "People", icon: Users, hint: "Team, crews, subcontractors and contacts", tabs: [
    { key: "team", label: "Team" },
    { key: "crews", label: "Crews" },
    { key: "subcontractors", label: "Subcontractors" },
    { key: "directory", label: "Directory" },
    { key: "role-manager", label: "Roles" },
  ] },
  { id: "files", label: "Files & reports", icon: FileText, hint: "Reports and documents", tabs: [
    { key: "reports", label: "Reports" },
    { key: "company-docs", label: "Company documents" },
    { key: "documents", label: "Unfiled documents" },
  ] },
];

/** The module a page belongs to. A project's own page sits under Projects. */
export const moduleOf = (v: View): Module | undefined =>
  v === "project-detail" ? MODULES[1] : MODULES.find((m) => m.tabs.some((t) => t.key === v));

/** Every page the AI may open, for the assistant's prompt and to check its answers. */
export const AI_VIEWS: ModuleTab[] = [...MODULES.flatMap((m) => m.tabs), { key: "buildflex-ai", label: "Buildsasa AI" }];
