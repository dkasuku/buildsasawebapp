// Buildsasa AI as the user's hands: actions the AI proposes ([[do:…]] tags) and
// the card that runs them. Every action goes through the same API calls (and
// the same server-side permission checks) as the page it belongs to, and only
// after the user taps "Do it", so nothing happens behind their back.
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowUpRight, Check, Copy, Loader2, MessageCircle, Plus, Trash2, X, Zap } from "lucide-react";
import api, { type ProjectDto, type UnitDto } from "../../services/api";
import { clientApi } from "./client/clientData";
import type { AiAction } from "./AiAssistantPanel";

type Field = { k: string; label: string; type?: "text" | "number" | "date" | "area" | "email" | "project" | "lines" | "select"; options?: string[]; half?: boolean; optional?: boolean };
type Done = NonNullable<Extract<AiAction, { kind: "do" }>["done"]>;
type Spec = { title: string; verb: string; view: string; fields: Field[]; run: (d: Record<string, any>, ctx: { projects: ProjectDto[] }) => Promise<Done> };

const ROLES = ["Project Manager", "Site Engineer", "Superintendent", "Foreman", "Trade Lead", "Worker", "Architect", "Quantity Surveyor", "QA/QC Officer", "Executive", "Owner", "Viewer"];
const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const num = (v: any) => (v === "" || v == null ? null : Number(String(v).replace(/[, ]/g, "")) || 0);
const portalUrl = (token: string) => `${window.location.origin}/?portal=${token}`;
const linesTotal = (items: any[]) => (items || []).reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.rate) || 0), 0);
const need = (v: any, what: string) => { if (!String(v ?? "").trim()) throw new Error(`Add ${what} first.`); };
const listOf = (v: any): string[] => (Array.isArray(v) ? v : String(v ?? "").split(",")).map((x) => String(x).trim()).filter(Boolean);
const squash = (s: string) => s.toLowerCase().replace(/[\s\-_.]/g, "");
/** A unit by its number as the AI or the user wrote it ("A-12", "a12", "house 7"). */
async function findUnit(projectId: string, code: string): Promise<UnitDto> {
  need(code, "the unit number");
  const units = await api.getUnits(projectId);
  const u = units.find((x) => squash(x.code) === squash(code)) || units.find((x) => squash(x.code).endsWith(squash(code)));
  if (!u) throw new Error(`No unit "${code}" on this project. Add it in the project's Units tab.`);
  return u;
}
const UNIT_STATUS = ["not_started", "in_progress", "snagging", "ready", "handed_over"];
const UPDATE_STAGES = ["foundation", "walling", "roofing", "services", "finishes", "handover", "other"];

export const AGENT: Record<string, Spec> = {
  "create-project": {
    title: "Create project", verb: "Create project", view: "projects",
    fields: [{ k: "name", label: "Project name" }, { k: "city", label: "Location", half: true }, { k: "clientName", label: "Client", half: true, optional: true },
      { k: "contractSumKES", label: "Contract sum (KES)", type: "number", half: true, optional: true }, { k: "status", label: "Status", type: "select", options: ["Planning", "Active", "On hold", "Completed"], half: true },
      { k: "startDate", label: "Start", type: "date", half: true, optional: true }, { k: "targetEndDate", label: "Target finish", type: "date", half: true, optional: true },
      { k: "description", label: "Description", type: "area", optional: true }],
    run: async (d) => {
      need(d.name, "the project name");
      const code = (String(d.name).split(/\s+/).map((w) => w[0]).join("").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3) || "PRJ") + "-" + String(Date.now()).slice(-4);
      const p = await api.createProject({ name: d.name, code, city: d.city || "—", status: d.status || "Planning", progress: 0, value: d.contractSumKES ? `KES ${Number(d.contractSumKES).toLocaleString("en-KE")}` : "", contractSumKES: num(d.contractSumKES), startDate: d.startDate || null, targetEndDate: d.targetEndDate || null, description: [d.description, d.clientName ? `Client: ${d.clientName}` : ""].filter(Boolean).join("\n") || null } as any);
      return { id: p.id, note: `${p.name} (${p.code})` };
    },
  },
  "invite-member": {
    title: "Invite team member", verb: "Send invite", view: "team",
    fields: [{ k: "name", label: "Name", half: true }, { k: "email", label: "Email", type: "email", half: true }, { k: "role", label: "Role", type: "select", options: ROLES, half: true }, { k: "trade", label: "Trade", half: true, optional: true }],
    run: async (d) => {
      need(d.name, "their name"); need(d.email, "their email");
      const r = await api.inviteUser({ name: d.name, email: String(d.email).trim(), role: d.role || "Worker", trade: d.trade || undefined });
      return { id: r.user?.id, note: r.emailed ? `Invite emailed to ${d.email}.` : r.tempPassword ? `Email isn't set up, so share this temporary password with ${d.name}: ${r.tempPassword}` : `Added ${d.name}.` };
    },
  },
  "set-role": {
    title: "Change role", verb: "Change role", view: "team",
    fields: [{ k: "email", label: "Team member's email", type: "email" }, { k: "role", label: "New role", type: "select", options: ROLES }],
    run: async (d) => {
      const users = await api.getUsers();
      const u = users.find((x: any) => String(x.email).toLowerCase() === String(d.email || "").toLowerCase().trim() || String(x.name).toLowerCase() === String(d.email || "").toLowerCase().trim());
      if (!u) throw new Error("No team member with that email. Invite them instead.");
      await api.updateUserRole(u.id, d.role);
      return { id: u.id, note: `${u.name} is now ${d.role}.` };
    },
  },
  "share-portal": {
    title: "Client portal link", verb: "Create link", view: "projects",
    fields: [{ k: "projectId", label: "Project", type: "project" }],
    run: async (d, { projects }) => {
      const r = await api.shareProjectPortal(d.projectId);
      return { id: d.projectId, link: portalUrl(r.portalToken), note: `Send this to the client of ${projects.find((p) => p.id === d.projectId)?.name || "the project"}.` };
    },
  },
  "create-invoice": {
    title: "Payment request", verb: "Create payment request", view: "invoicing",
    fields: [{ k: "projectId", label: "Project", type: "project" }, { k: "clientName", label: "Client", half: true }, { k: "dueDate", label: "Due date", type: "date", half: true },
      { k: "taxRate", label: "VAT %", type: "number", half: true, optional: true }, { k: "items", label: "Lines", type: "lines" }, { k: "notes", label: "Notes", type: "area", optional: true }],
    run: async (d) => {
      need(d.clientName, "the client");
      const items = (d.items || []).filter((l: any) => String(l.description || "").trim() && linesTotal([l]) > 0);
      if (!items.length) throw new Error("Add at least one priced line.");
      const subtotal = linesTotal(items), tax = subtotal * ((Number(d.taxRate) || 0) / 100);
      const r = await api.createInvoice(d.projectId, { invoiceNumber: `INV-${new Date().toISOString().slice(2, 10).replace(/-/g, "")}-${String(Date.now()).slice(-3)}`, clientName: d.clientName, status: "draft", issueDate: today(), dueDate: d.dueDate || plusDays(14),
        items: JSON.stringify(items.map((l: any) => ({ description: l.description, quantity: Number(l.quantity) || 0, rate: Number(l.rate) || 0 }))), subtotal, taxRate: num(d.taxRate), amount: Math.round(subtotal + tax), paidAmount: 0, notes: d.notes || null } as any);
      return { id: r.id, note: `${r.invoiceNumber} · KES ${Math.round(subtotal + tax).toLocaleString("en-KE")} (draft)` };
    },
  },
  "add-material": {
    title: "Add material to inventory", verb: "Add material", view: "equipment",
    fields: [{ k: "name", label: "Material", half: true }, { k: "category", label: "Category", half: true, optional: true }, { k: "unit", label: "Unit", half: true }, { k: "currentStock", label: "In stock", type: "number", half: true },
      { k: "unitCostKES", label: "Unit cost (KES)", type: "number", half: true, optional: true }, { k: "reorderLevel", label: "Reorder at", type: "number", half: true, optional: true }, { k: "supplier", label: "Supplier", optional: true }],
    run: async (d) => {
      need(d.name, "the material"); need(d.unit, "the unit");
      const r = await api.createInventoryItem({ name: d.name, category: d.category || null, unit: d.unit, currentStock: Number(d.currentStock) || 0, unitCostKES: num(d.unitCostKES), reorderLevel: num(d.reorderLevel), supplier: d.supplier || null } as any);
      return { id: r.id, note: `${r.name}: ${r.currentStock} ${r.unit}` };
    },
  },
  "add-equipment": {
    title: "Add equipment", verb: "Add equipment", view: "equipment",
    fields: [{ k: "name", label: "Equipment", half: true }, { k: "category", label: "Category", half: true }, { k: "status", label: "Status", type: "select", options: ["available", "in_use", "maintenance"], half: true },
      { k: "ownership", label: "Owned or hired", type: "select", options: ["owned", "hired"], half: true }, { k: "location", label: "Location", half: true, optional: true }, { k: "hireRate", label: "Hire rate (KES/day)", type: "number", half: true, optional: true }],
    run: async (d) => {
      need(d.name, "the equipment name");
      const r = await api.createEquipment({ name: d.name, category: d.category || "Other", status: d.status || "available", ownership: d.ownership || "owned", location: d.location || null, hireRate: num(d.hireRate), hireRateUnit: d.hireRate ? "day" : null } as any);
      return { id: r.id, note: r.name };
    },
  },
  "add-budget": {
    title: "Add budget to project", verb: "Add budget", view: "financials",
    fields: [{ k: "projectId", label: "Project", type: "project" }, { k: "section", label: "Budget section" }, { k: "items", label: "Lines", type: "lines" }],
    run: async (d) => {
      need(d.section, "a section name");
      const items = (d.items || []).filter((l: any) => String(l.description || "").trim());
      if (!items.length) throw new Error("Add at least one line.");
      const sec = await api.addBoqSection(d.projectId, { title: d.section });
      for (const l of items) await api.addBoqItem(sec.id, { description: l.description, unit: l.unit || "item", quantity: Number(l.quantity) || 0, rate: Number(l.rate) || 0 });
      return { id: sec.id, note: `${d.section}: ${items.length} lines · KES ${Math.round(linesTotal(items)).toLocaleString("en-KE")}` };
    },
  },
  "add-task": {
    title: "Add to schedule", verb: "Add task", view: "schedule",
    fields: [{ k: "projectId", label: "Project", type: "project" }, { k: "name", label: "Task" }, { k: "startDate", label: "Start", type: "date", half: true }, { k: "endDate", label: "Finish", type: "date", half: true }, { k: "trade", label: "Trade", half: true, optional: true }, { k: "type", label: "Type", type: "select", options: ["task", "milestone"], half: true }],
    run: async (d) => {
      need(d.name, "the task name");
      const r = await api.createScheduleItem(d.projectId, { name: d.name, type: d.type || "task", startDate: d.startDate || today(), endDate: d.endDate || d.startDate || plusDays(7), trade: d.trade || null, status: "not_started", percent: 0 } as any);
      return { id: (r as any).id, note: d.name };
    },
  },
  "add-variation": {
    title: "Change order / variation", verb: "Create variation", view: "change-orders",
    fields: [{ k: "projectId", label: "Project", type: "project" }, { k: "title", label: "Title" }, { k: "amountKES", label: "Amount (KES)", type: "number", half: true }, { k: "scheduleImpactDays", label: "Time impact (days)", type: "number", half: true }, { k: "description", label: "Description", type: "area", optional: true }],
    run: async (d) => {
      need(d.title, "a title");
      const r = await api.createVariation(d.projectId, { title: d.title, amountKES: Number(d.amountKES) || 0, cause: d.cause || undefined, description: d.description || undefined, scheduleImpactDays: Number(d.scheduleImpactDays) || 0 });
      return { id: (r as any).id, note: d.title };
    },
  },
  "add-crew": {
    title: "Add crew", verb: "Add crew", view: "crews",
    fields: [{ k: "name", label: "Crew name", half: true }, { k: "trade", label: "Trade", half: true }, { k: "foreman", label: "Foreman", half: true, optional: true }, { k: "projectId", label: "Project", type: "project", optional: true }],
    run: async (d, { projects }) => {
      need(d.name, "the crew name");
      const r = await api.createCrew({ name: d.name, trade: d.trade || "General", foreman: d.foreman || null, projectId: d.projectId || null, project: projects.find((p) => p.id === d.projectId)?.name || null, status: "active" });
      return { id: r.id, note: d.name };
    },
  },
  "add-contact": {
    title: "Add to directory", verb: "Add contact", view: "directory",
    fields: [{ k: "name", label: "Name", half: true }, { k: "company", label: "Company", half: true, optional: true }, { k: "category", label: "Type", type: "select", options: ["Supplier", "Subcontractor", "Consultant", "Client", "Authority", "Other"], half: true }, { k: "role", label: "Role", half: true, optional: true }, { k: "phone", label: "Phone", half: true, optional: true }, { k: "email", label: "Email", type: "email", half: true, optional: true }],
    run: async (d) => {
      need(d.name, "the name");
      const r = await api.createDirectoryContact({ name: d.name, company: d.company || null, role: d.role || null, category: d.category || "Other", phone: d.phone || null, email: d.email || null });
      return { id: r.id, note: d.name };
    },
  },
  "schedule-inspection": {
    title: "Schedule inspection", verb: "Schedule", view: "inspections",
    fields: [{ k: "projectId", label: "Project", type: "project" }, { k: "type", label: "Inspection" }, { k: "date", label: "Date", type: "date", half: true }, { k: "inspector", label: "Inspector", half: true, optional: true }],
    run: async (d) => {
      need(d.type, "the inspection type");
      const r = await api.createInspection(d.projectId, { type: d.type, date: d.date || today(), inspector: d.inspector || "", status: "draft" } as any);
      return { id: (r as any).id, note: `${d.type} on ${d.date || today()}` };
    },
  },
  "report-incident": {
    title: "Report safety incident", verb: "Report", view: "safety-incidents",
    fields: [{ k: "projectId", label: "Project", type: "project" }, { k: "incidentType", label: "Type", type: "select", options: ["near_miss", "injury", "property_damage", "environmental", "other"], half: true }, { k: "severity", label: "Severity", type: "select", options: ["minor", "moderate", "major"], half: true }, { k: "date", label: "Date", type: "date", half: true }, { k: "description", label: "What happened", type: "area" }, { k: "correctiveAction", label: "Corrective action", type: "area", optional: true }],
    run: async (d) => {
      need(d.description, "what happened");
      const r = await api.createSafetyIncident(d.projectId, { incidentType: d.incidentType || "other", severity: d.severity || "minor", date: d.date || today(), description: d.description, correctiveAction: d.correctiveAction || null, status: "open" } as any);
      return { id: (r as any).id, note: "Incident recorded" };
    },
  },
  "add-labourer": {
    title: "Add worker to the muster", verb: "Add worker", view: "attendance",
    fields: [{ k: "name", label: "Name", half: true }, { k: "trade", label: "Trade", half: true, optional: true }, { k: "dailyRate", label: "Daily rate (KES)", type: "number", half: true, optional: true },
      { k: "phone", label: "Phone (M-Pesa)", half: true, optional: true }, { k: "projectId", label: "Usual site", type: "project", optional: true }],
    run: async (d) => {
      need(d.name, "the worker's name");
      const [w] = await api.addLabourers([{ name: d.name, trade: d.trade || undefined, dailyRate: num(d.dailyRate) || 0, phone: d.phone || undefined, projectId: d.projectId || undefined }]);
      return { id: w.id, note: `${w.name}${w.trade ? `, ${w.trade}` : ""}${w.dailyRate ? `, KES ${w.dailyRate.toLocaleString("en-KE")} a day` : ""}` };
    },
  },
  muster: {
    title: "Mark the muster", verb: "Save muster", view: "attendance",
    fields: [{ k: "projectId", label: "Project", type: "project" }, { k: "date", label: "Day", type: "date", half: true },
      { k: "present", label: "Present (names, comma separated)" }, { k: "half", label: "Half day", optional: true }, { k: "absent", label: "Absent", optional: true }],
    run: async (d) => {
      const date = d.date || today();
      const m = await api.muster(d.projectId, date);
      const find = (n: string) => m.workers.find((w) => squash(w.name) === squash(n)) || m.workers.find((w) => squash(w.name).startsWith(squash(n)) || squash(n).startsWith(squash(w.name)));
      const marks: { labourerId: string; status: "present" | "half" | "absent" }[] = [];
      const unknown: string[] = [];
      for (const [k, st] of [["present", "present"], ["half", "half"], ["absent", "absent"]] as const) {
        for (const n of listOf(d[k])) { const w = find(n); if (w) marks.push({ labourerId: w.id, status: st }); else unknown.push(n); }
      }
      if (/^(all|everyone|wote)$/i.test(String(d.present || "").trim())) m.workers.forEach((w) => { if (!marks.some((x) => x.labourerId === w.id)) marks.push({ labourerId: w.id, status: "present" }); });
      if (!marks.length) throw new Error(unknown.length ? `${unknown.join(", ")} ${unknown.length === 1 ? "isn't" : "aren't"} on this site's muster. Add them first.` : "Name who was present.");
      await api.saveMuster(d.projectId, date, marks);
      const p = marks.filter((x) => x.status === "present").length, h = marks.filter((x) => x.status === "half").length;
      return { id: d.projectId, note: `${p} present${h ? `, ${h} half day` : ""}${unknown.length ? `. Not on the muster: ${unknown.join(", ")}` : ""}` };
    },
  },
  "add-units": {
    title: "Add units", verb: "Add units", view: "projects",
    fields: [{ k: "projectId", label: "Project", type: "project" }, { k: "type", label: "Unit type", half: true, optional: true }, { k: "block", label: "Block", half: true, optional: true },
      { k: "floors", label: "Floors above ground", type: "number", half: true, optional: true }, { k: "perFloor", label: "Units per floor", type: "number", half: true, optional: true },
      { k: "count", label: "Or: number of houses", type: "number", half: true, optional: true }, { k: "prefix", label: "Name them", half: true, optional: true }],
    run: async (d) => {
      const generate = Number(d.count) > 0
        ? { count: Number(d.count), prefix: d.prefix ?? undefined, type: d.type || undefined, block: d.block || undefined }
        : { block: d.block || undefined, floors: Number(d.floors) || 0, perFloor: Number(d.perFloor) || 0, groundFloor: d.groundFloor !== false, type: d.type || undefined };
      if (!("count" in generate) && (!generate.floors || !generate.perFloor)) throw new Error("Say how many floors and units per floor, or how many houses.");
      const r = await api.addUnits(d.projectId, { generate });
      return { id: d.projectId, note: `${r.added} unit${r.added === 1 ? "" : "s"} added${r.skipped ? ` (${r.skipped} already existed)` : ""}. Add each buyer in the project's Units tab.` };
    },
  },
  "update-unit": {
    title: "Update unit", verb: "Save unit", view: "projects",
    fields: [{ k: "projectId", label: "Project", type: "project" }, { k: "unit", label: "Unit", half: true }, { k: "status", label: "Status", type: "select", options: UNIT_STATUS, half: true, optional: true },
      { k: "done", label: "Stages finished (comma separated)", optional: true },
      { k: "clientName", label: "Buyer", half: true, optional: true }, { k: "clientPhone", label: "Buyer's phone", half: true, optional: true }, { k: "clientEmail", label: "Buyer's email", type: "email", optional: true }],
    run: async (d) => {
      const u = await findUnit(d.projectId, d.unit);
      const payload: Record<string, any> = { done: listOf(d.done) };
      for (const k of ["status", "clientName", "clientPhone", "clientEmail"]) if (String(d[k] ?? "").trim()) payload[k] = d[k];
      const r = await api.updateUnit(d.projectId, u.id, payload);
      return { id: r.id, note: `${r.code}: ${r.progress}% · ${r.statusLabel || r.status}` };
    },
  },
  "share-update": {
    title: "Share update with client", verb: "Share update", view: "projects",
    fields: [{ k: "projectId", label: "Project", type: "project" }, { k: "unit", label: "Unit (empty = everyone)", half: true, optional: true }, { k: "stage", label: "Stage", type: "select", options: UPDATE_STAGES, half: true },
      { k: "title", label: "Title" }, { k: "body", label: "Details", type: "area", optional: true }],
    run: async (d) => {
      need(d.title, "a title");
      if (String(d.unit ?? "").trim()) {
        const u = await findUnit(d.projectId, d.unit);
        const r = await api.postUnitUpdate(d.projectId, u.id, { title: d.title, body: d.body || undefined, stage: d.stage || "finishes" });
        return { id: r.id, note: `Shared with unit ${u.code}'s buyer.` };
      }
      const r = await clientApi.postUpdate(d.projectId, { stage: d.stage || "other", kind: "progress", title: d.title, body: d.body || "", media: [] });
      return { id: r.id, note: "Shared with the project's clients." };
    },
  },
  "unit-report": {
    title: "Send unit progress report", verb: "Send report", view: "projects",
    fields: [{ k: "projectId", label: "Project", type: "project" }, { k: "unit", label: "Unit (ALL = every buyer)" }],
    run: async (d) => {
      need(d.unit, "the unit, or ALL");
      if (/^all$/i.test(String(d.unit).trim())) {
        const r = await api.unitReportAll(d.projectId);
        return { id: d.projectId, note: `Reports emailed to ${r.sent} buyer${r.sent === 1 ? "" : "s"}${r.skipped ? `; ${r.skipped} unit${r.skipped === 1 ? " has" : "s have"} no buyer email yet` : ""}.` };
      }
      const u = await findUnit(d.projectId, d.unit);
      const r = await api.unitReport(d.projectId, u.id);
      return { id: u.id, link: r.link, share: r.text, phone: r.phone, note: r.emailed.length ? `Emailed to ${r.emailed.join(", ")}. Send it on WhatsApp too:` : `No email on file for ${u.code}. Send it on WhatsApp:` };
    },
  },
  announce: {
    title: "Post announcement", verb: "Post", view: "announcements",
    fields: [{ k: "title", label: "Title" }, { k: "body", label: "Message", type: "area" }, { k: "priority", label: "Priority", type: "select", options: ["normal", "high"], half: true }],
    run: async (d) => {
      need(d.title, "a title");
      const r = await api.createAnnouncement({ title: d.title, body: d.body || "", priority: d.priority || "normal", date: today(), audience: "all" });
      return { id: r.id, note: d.title };
    },
  },
};

let projectsP: Promise<ProjectDto[]> | null = null;
export const loadProjects = (fresh = false) => { if (fresh) projectsP = null; return (projectsP ||= api.getProjects().catch(() => { projectsP = null; return []; })); };

/** The confirm card for one action. `newProjectId` resolves "projectId":"new". */
/** Run one action straight away ("Do all"). Throws with a plain reason. */
export async function runAction(action: Extract<AiAction, { kind: "do" }>, newProjectId?: string): Promise<Done> {
  const spec = AGENT[action.action];
  if (!spec) throw new Error(`I can't do "${action.label}" yet.`);
  const projects = await loadProjects(!!newProjectId);
  const d = { ...action.data };
  const pf = spec.fields.find((f) => f.type === "project");
  if (pf) {
    if (d.projectId === "new") d.projectId = newProjectId || "";
    if (d.projectId && !projects.some((p) => p.id === d.projectId)) d.projectId = projects.find((p) => p.name.toLowerCase() === String(d.projectId).toLowerCase())?.id || "";
    if (!d.projectId && projects.length === 1) d.projectId = projects[0].id;
    if (!d.projectId && !pf.optional) throw new Error(`${spec.title}: pick the project on the card.`);
  }
  return spec.run(d, { projects });
}

export function ActionCard({ action, newProjectId, onDone, onDismiss, onOpen, onChange }: {
  action: Extract<AiAction, { kind: "do" }>; newProjectId?: string;
  onDone: (done: Done) => void; onDismiss: () => void; onOpen: (view: string) => void;
  /** Edits on the card, kept on the message (so "Do all" and history use them). */
  onChange?: (data: Record<string, any>) => void;
}) {
  const spec = AGENT[action.action];
  // Sensible defaults for anything the AI left out: the first option, today,
  // an invoice due in two weeks, a task lasting a week.
  const [d, setD] = useState<Record<string, any>>(() => {
    const x: Record<string, any> = { ...action.data };
    for (const f of spec?.fields || []) {
      if (x[f.k] != null && x[f.k] !== "") continue;
      if (f.type === "select" && !f.optional && f.options?.length) x[f.k] = f.options[0];
      else if (f.type === "date" && !f.optional) x[f.k] = f.k === "dueDate" ? plusDays(14) : f.k === "endDate" ? plusDays(7) : today();
    }
    return x;
  });
  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [busy, setBusy] = useState(false);
  const needsProject = !!spec?.fields.some((f) => f.type === "project");
  useEffect(() => { if (needsProject) loadProjects(!!newProjectId).then(setProjects); }, [needsProject, newProjectId]);
  // A project picked by name, or the one this reply just created.
  useEffect(() => {
    if (!needsProject) return;
    setD((x) => {
      if (x.projectId === "new") return newProjectId ? { ...x, projectId: newProjectId } : x;
      if (x.projectId && projects.some((p) => p.id === x.projectId)) return x;
      const byName = projects.find((p) => x.projectId && p.name.toLowerCase() === String(x.projectId).toLowerCase());
      return { ...x, projectId: byName?.id || (projects.length === 1 ? projects[0].id : x.projectId === "new" ? "new" : "") };
    });
  }, [projects, newProjectId, needsProject]);
  if (!spec) return null;
  const set = (k: string, v: any) => { const n = { ...d, [k]: v }; setD(n); onChange?.(n); };
  const waitingForProject = d.projectId === "new" && !newProjectId;

  const run = async () => {
    const pf = spec.fields.find((f) => f.type === "project");
    if (pf && !pf.optional && (!d.projectId || d.projectId === "new")) return toast.error(waitingForProject ? "Create the project above first." : "Pick the project first.");
    setBusy(true);
    try { const done = await spec.run(d, { projects }); onDone(done); toast.success(`${spec.title}: done`); }
    catch (e: any) { toast.error(e?.message || "That didn't work."); }
    setBusy(false);
  };

  if (action.done) return (
    <div className="mt-2.5 rounded-xl border border-[#22C55E]/30 bg-[#22C55E]/5 px-3.5 py-2.5 text-[12.5px] text-[#C2CAD6]">
      <div className="flex items-center gap-2"><Check className="w-4 h-4 text-[#22C55E] shrink-0" /><span className="min-w-0 flex-1"><b className="text-white font-medium">{spec.title}</b>{action.done.note ? ` · ${action.done.note}` : ""}</span>
        <button onClick={() => onOpen(spec.view)} className="text-[#FF8A47] hover:underline inline-flex items-center gap-1 shrink-0">Open <ArrowUpRight className="w-3.5 h-3.5" /></button></div>
      {action.done.link && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <code className="flex-1 min-w-0 truncate rounded-md bg-[#0A0E14] border border-[#222A35] px-2 py-1.5 text-[11.5px] text-[#D5DBE3]">{action.done.link}</code>
          <button onClick={() => navigator.clipboard?.writeText(action.done!.link!).then(() => toast.success("Link copied"))} className="h-8 px-2.5 rounded-md border border-[#222A35] text-[12px] inline-flex items-center gap-1.5 hover:text-white"><Copy className="w-3.5 h-3.5" /> Copy</button>
          <a href={`https://wa.me/${String(action.done.phone || "").replace(/\D/g, "").replace(/^0/, "254")}?text=${encodeURIComponent(action.done.share || `Hello, you can follow progress on your project, see site photos and invoices, and approve changes here: ${action.done.link}`)}`} target="_blank" rel="noreferrer" className="h-8 px-2.5 rounded-md bg-[#25D366] text-[#ffffff] text-[12px] inline-flex items-center gap-1.5"><MessageCircle className="w-3.5 h-3.5" /> WhatsApp</a>
        </div>
      )}
    </div>
  );

  const inp = "mt-0.5 w-full h-8 rounded-md bg-[#0A0E14] border border-[#222A35] px-2.5 text-[12.5px] text-white focus:outline-none focus:border-[#FF6B1A]/50";
  return (
    <div className="mt-2.5 rounded-xl border border-[#FF6B1A]/35 bg-[#11161D] overflow-hidden">
      <div className="px-3.5 py-2 bg-[#FF6B1A]/10 text-[12.5px] text-[#FF8A47] flex items-center gap-2">
        <Zap className="w-3.5 h-3.5" /> {spec.title}
        <button onClick={onDismiss} className="ml-auto text-[#8A95A5] hover:text-white" aria-label="Dismiss"><X className="w-3.5 h-3.5" /></button>
      </div>
      <div className="p-3.5 grid grid-cols-2 gap-2.5">
        {spec.fields.map((f) => (
          <label key={f.k} className={`block min-w-0 ${f.half ? "col-span-2 sm:col-span-1" : "col-span-2"}`}>
            <span className="text-[10.5px] uppercase tracking-wider text-[#5B6675]">{f.label}{f.optional ? "" : " *"}</span>
            {f.type === "project" ? (
              <select aria-label={f.label} value={d[f.k] || ""} onChange={(e) => set(f.k, e.target.value)} className={inp}>
                <option value="">{waitingForProject ? "The new project (create it first)" : projects.length ? "Choose a project…" : "Loading projects…"}</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            ) : f.type === "select" ? (
              <select aria-label={f.label} value={d[f.k] || ""} onChange={(e) => set(f.k, e.target.value)} className={inp}>
                <option value="">Choose…</option>
                {(f.options || []).concat(d[f.k] && !(f.options || []).includes(d[f.k]) ? [d[f.k]] : []).map((o) => <option key={o} value={o}>{o.replace(/_/g, " ")}</option>)}
              </select>
            ) : f.type === "area" ? (
              <textarea aria-label={f.label} rows={3} value={d[f.k] ?? ""} onChange={(e) => set(f.k, e.target.value)} className={`${inp} h-auto py-1.5 resize-y`} />
            ) : f.type === "lines" ? (
              <Lines items={d[f.k] || []} onChange={(v) => set(f.k, v)} />
            ) : (
              <input aria-label={f.label} type={f.type === "number" ? "number" : f.type === "date" ? "date" : f.type === "email" ? "email" : "text"} value={d[f.k] ?? ""} onChange={(e) => set(f.k, e.target.value)} className={inp} />
            )}
          </label>
        ))}
      </div>
      <div className="px-3.5 pb-3 flex flex-wrap items-center gap-2">
        <button onClick={run} disabled={busy} className="h-9 px-4 rounded-lg bg-[#FF6B1A] hover:bg-[#FF7E33] text-[#ffffff] text-[13px] font-medium inline-flex items-center gap-1.5 disabled:opacity-60">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} {spec.verb}</button>
        <span className="text-[11px] text-[#5B6675]">Check the details, then tap to do it.</span>
      </div>
    </div>
  );
}

function Lines({ items, onChange }: { items: any[]; onChange: (v: any[]) => void }) {
  const set = (i: number, k: string, v: any) => onChange(items.map((l, n) => (n === i ? { ...l, [k]: v } : l)));
  const c = "h-8 rounded-md bg-[#0A0E14] border border-[#222A35] px-2 text-[12px] text-white focus:outline-none focus:border-[#FF6B1A]/50 min-w-0";
  return (
    <div className="mt-1 space-y-1.5">
      {items.map((l, i) => (
        <div key={i} className="grid grid-cols-[1fr_56px_76px_28px] sm:grid-cols-[1fr_60px_64px_90px_28px] gap-1.5">
          <input aria-label={`Line ${i + 1} description`} className={c} value={l.description || ""} onChange={(e) => set(i, "description", e.target.value)} placeholder="Description" />
          <input aria-label={`Line ${i + 1} quantity`} type="number" className={`${c} text-right`} value={l.quantity ?? ""} onChange={(e) => set(i, "quantity", e.target.value)} placeholder="Qty" />
          <input aria-label={`Line ${i + 1} unit`} className={`${c} hidden sm:block`} value={l.unit || ""} onChange={(e) => set(i, "unit", e.target.value)} placeholder="Unit" />
          <input aria-label={`Line ${i + 1} rate`} type="number" className={`${c} text-right`} value={l.rate ?? ""} onChange={(e) => set(i, "rate", e.target.value)} placeholder="Rate" />
          <button onClick={() => onChange(items.filter((_, n) => n !== i))} className="h-8 text-[#5B6675] hover:text-[#EF4444] flex items-center justify-center" aria-label={`Remove line ${i + 1}`}><Trash2 className="w-3.5 h-3.5" /></button>
        </div>
      ))}
      <div className="flex items-center justify-between">
        <button onClick={() => onChange([...items, { description: "", quantity: 1, unit: "item", rate: 0 }])} className="text-[12px] text-[#FF8A47] inline-flex items-center gap-1"><Plus className="w-3.5 h-3.5" /> Add line</button>
        <span className="text-[12px] text-[#C2CAD6]">Total KES {Math.round(linesTotal(items)).toLocaleString("en-KE")}</span>
      </div>
    </div>
  );
}
