// Things you can do with a Buildsasa AI answer: download it as a document,
// copy or send it on WhatsApp, save a priced table as a quote, and confirm a
// record the AI drafted (daily log, snag, observation) so it is saved for real.
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, Copy, FileSpreadsheet, FileText, FileType2, Loader2, MessageCircle, Save, ArrowUpRight, Calculator, X } from "lucide-react";
import api, { type ProjectDto } from "../../services/api";
import { docTitle, exportAnswer, firstQuoteTable, whatsappLink, type DocFormat } from "./aiDocs";
import type { AiAction, SaveKind } from "./AiAssistantPanel";

let projectsP: Promise<ProjectDto[]> | null = null;
const loadProjects = () => (projectsP ||= api.getProjects().catch(() => { projectsP = null; return []; }));

const VIEW_OF: Record<SaveKind, string> = { "daily-log": "daily-log", punch: "punch-list", observation: "observations", quote: "quotes" };
const kes = (n: number) => `KES ${Math.round(n).toLocaleString("en-KE")}`;

/** Download / copy / share row under an answer. */
export function AnswerTools({ text, question, onSaveQuote }: { text: string; question?: string; onSaveQuote?: () => void }) {
  const [busy, setBusy] = useState<DocFormat | null>(null);
  const title = docTitle(question);
  const dl = async (f: DocFormat) => {
    setBusy(f);
    try { await exportAnswer(text, f, title); } catch (e: any) { toast.error(e?.message || "Couldn't create the file."); }
    setBusy(null);
  };
  const quote = onSaveQuote && firstQuoteTable(text);
  const btn = "h-7 px-2 rounded-md text-[11.5px] text-[#8A95A5] hover:text-white hover:bg-[#161C24] inline-flex items-center gap-1.5 disabled:opacity-50";
  const icon = (f: DocFormat, I: any) => (busy === f ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <I className="w-3.5 h-3.5" />);
  return (
    <div className="flex flex-wrap items-center gap-0.5 mt-2 -ml-2">
      <button className={btn} onClick={() => { navigator.clipboard?.writeText(text).then(() => toast.success("Copied")).catch(() => {}); }} title="Copy"><Copy className="w-3.5 h-3.5" /> Copy</button>
      <button className={btn} disabled={!!busy} onClick={() => dl("pdf")} title="Download as a PDF with your letterhead">{icon("pdf", FileText)} PDF</button>
      <button className={btn} disabled={!!busy} onClick={() => dl("docx")} title="Download as a Word document">{icon("docx", FileType2)} Word</button>
      <button className={btn} disabled={!!busy} onClick={() => dl("xlsx")} title="Download as an Excel workbook">{icon("xlsx", FileSpreadsheet)} Excel</button>
      <a className={btn} href={whatsappLink(text)} target="_blank" rel="noreferrer" title="Send on WhatsApp"><MessageCircle className="w-3.5 h-3.5" /> WhatsApp</a>
      {quote && <button className={`${btn} text-[#FF8A47]`} onClick={onSaveQuote} title="Save this table as a quote in Quotes"><Calculator className="w-3.5 h-3.5" /> Save as quote · {kes(quote.lines.reduce((s, l) => s + l.quantity * l.rate, 0))}</button>}
    </div>
  );
}

/** The confirm card for a record the AI drafted. */
export function SaveCard({ action, text, onSaved, onOpen, onDismiss }: {
  action: Extract<AiAction, { kind: "save" }>; text: string;
  onSaved: (id: string) => void; onOpen: (view: string) => void; onDismiss?: () => void;
}) {
  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [d, setD] = useState<Record<string, any>>(() => ({ ...action.data }));
  const [busy, setBusy] = useState(false);
  const needsProject = action.type !== "quote";
  useEffect(() => { if (needsProject) loadProjects().then((ps) => { setProjects(ps); setD((x) => (x.projectId && ps.some((p) => p.id === x.projectId) ? x : { ...x, projectId: ps.length === 1 ? ps[0].id : "" })); }); }, [needsProject]);
  const quote = action.type === "quote" ? firstQuoteTable(text) : null;
  const set = (k: string, v: any) => setD((x) => ({ ...x, [k]: v }));

  const save = async () => {
    if (needsProject && !d.projectId) return toast.error("Pick the project first.");
    setBusy(true);
    try {
      let id = "";
      const project = projects.find((p) => p.id === d.projectId);
      if (action.type === "daily-log") {
        const r = await api.createDailyLog(d.projectId, { crew: d.crew || "General crew", headcount: Number(d.headcount) || 0, weather: d.weather || null, notes: d.notes || "", labour: d.labour || null, plant: d.plant || null, materials: d.materials || null, location: d.location || "", date: d.date || new Date().toISOString() } as any);
        id = (r as any).id;
      } else if (action.type === "punch") {
        const r = await api.createPunchItem({ projectId: d.projectId, title: d.title, area: d.area || "—", desc: d.desc || d.title, trade: d.trade || null, priority: ["low", "medium", "high"].includes(d.priority) ? d.priority : "medium", status: "open" });
        id = r.id;
      } else if (action.type === "observation") {
        const r = await api.createObservation({ projectId: d.projectId, project: project?.name, title: d.title, type: d.type || "Quality", priority: d.priority || "medium", location: d.location || null, description: d.description || "", status: "open", date: new Date().toISOString().slice(0, 10) });
        id = r.id;
      } else {
        if (!quote) throw new Error("There's no priced table in this answer to save.");
        if (!String(d.clientName || "").trim() || !String(d.title || "").trim()) { setBusy(false); return toast.error("Add the client's name and the job."); }
        const r = await api.createQuote({ title: d.title, clientName: d.clientName, clientPhone: d.clientPhone || null, items: quote.lines.map((l) => ({ ...l, section: l.section || "" })), taxRate: d.taxRate === "" || d.taxRate == null ? null : Number(d.taxRate), notes: d.notes || null } as any);
        id = r.id;
        toast.success(`Saved as ${r.quoteNumber}. Open Quotes to send it to the client.`);
      }
      if (action.type !== "quote") toast.success(`Saved the ${action.label}.`);
      onSaved(id || "saved");
    } catch (e: any) { toast.error(e?.message || "Couldn't save."); }
    setBusy(false);
  };

  if (action.savedId) return (
    <div className="mt-3 rounded-xl border border-[#22C55E]/30 bg-[#22C55E]/5 px-3.5 py-2.5 flex items-center gap-2 text-[12.5px] text-[#C2CAD6]">
      <Check className="w-4 h-4 text-[#22C55E]" /> Saved as a {action.label}.
      <button onClick={() => onOpen(VIEW_OF[action.type])} className="ml-auto text-[#FF8A47] hover:underline inline-flex items-center gap-1">Open <ArrowUpRight className="w-3.5 h-3.5" /></button>
    </div>
  );

  const field = (k: string, label: string, opts: { area?: boolean; type?: string; half?: boolean } = {}) => (
    <label className={`block ${opts.half ? "" : "sm:col-span-2"}`}>
      <span className="text-[10.5px] uppercase tracking-wider text-[#5B6675]">{label}</span>
      {opts.area
        ? <textarea value={d[k] ?? ""} onChange={(e) => set(k, e.target.value)} rows={3} className="mt-0.5 w-full rounded-md bg-[#0A0E14] border border-[#222A35] px-2.5 py-1.5 text-[12.5px] text-white focus:outline-none focus:border-[#FF6B1A]/50 resize-y" />
        : <input type={opts.type || "text"} value={d[k] ?? ""} onChange={(e) => set(k, e.target.value)} className="mt-0.5 w-full h-8 rounded-md bg-[#0A0E14] border border-[#222A35] px-2.5 text-[12.5px] text-white focus:outline-none focus:border-[#FF6B1A]/50" />}
    </label>
  );
  return (
    <div className="mt-3 rounded-xl border border-[#FF6B1A]/35 bg-[#11161D] overflow-hidden">
      <div className="px-3.5 py-2 bg-[#FF6B1A]/10 text-[12.5px] text-[#FF8A47] flex items-center gap-2">
        <Save className="w-3.5 h-3.5" /> Save this {action.label}?{quote && <span className="text-[#8A95A5]"> · {quote.lines.length} lines · {kes(quote.lines.reduce((s, l) => s + l.quantity * l.rate, 0))} before VAT</span>}
        {onDismiss && <button onClick={onDismiss} className="ml-auto text-[#8A95A5] hover:text-white" aria-label="Dismiss"><X className="w-3.5 h-3.5" /></button>}
      </div>
      <div className="p-3.5 grid sm:grid-cols-2 gap-2.5">
        {needsProject && (
          <label className="block sm:col-span-2">
            <span className="text-[10.5px] uppercase tracking-wider text-[#5B6675]">Project</span>
            <select value={d.projectId || ""} onChange={(e) => set("projectId", e.target.value)} className="mt-0.5 w-full h-8 rounded-md bg-[#0A0E14] border border-[#222A35] px-2 text-[12.5px] text-white focus:outline-none">
              <option value="">{projects.length ? "Choose a project…" : "Loading projects…"}</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
        )}
        {action.type === "daily-log" && <>{field("crew", "Crew / trades", { half: true })}{field("headcount", "Headcount", { half: true, type: "number" })}{field("weather", "Weather", { half: true })}{field("materials", "Deliveries", { half: true })}{field("notes", "Work done", { area: true })}</>}
        {action.type === "punch" && <>{field("title", "Snag")}{field("area", "Location", { half: true })}{field("trade", "Trade", { half: true })}{field("desc", "Details and fix", { area: true })}</>}
        {action.type === "observation" && <>{field("title", "Observation")}{field("type", "Type", { half: true })}{field("location", "Location", { half: true })}{field("description", "Details", { area: true })}</>}
        {action.type === "quote" && <>{field("clientName", "Client name", { half: true })}{field("clientPhone", "Client phone", { half: true })}{field("title", "Job title", { half: true })}{field("taxRate", "VAT %", { half: true, type: "number" })}{field("notes", "Scope notes", { area: true })}</>}
      </div>
      <div className="px-3.5 pb-3 flex items-center gap-2">
        <button onClick={save} disabled={busy} className="h-8 px-3.5 rounded-lg bg-[#FF6B1A] hover:bg-[#FF7E33] text-[#ffffff] text-[12.5px] font-medium inline-flex items-center gap-1.5 disabled:opacity-60">{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Save {action.label}</button>
        <span className="text-[11px] text-[#5B6675]">Check the details first. You can edit it later too.</span>
      </div>
    </div>
  );
}
