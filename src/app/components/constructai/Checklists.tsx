import { useState, useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import {
  Plus, Search, X, Trash2, ClipboardList, CheckCircle2, Clock, AlertTriangle,
  UploadCloud, Users, Eye, Loader2, FileText, ArrowRight, UserCheck,
  Sparkles, Filter, PenTool, FileUp, Link2
} from "lucide-react";
import type { Role } from "./roles";
import { ROLES } from "./roles";
import { TEAM_MEMBERS, getMember } from "./team-data";
import { useTeam, resolveName } from "./useTeam";
import { EmptyState } from "./EmptyState";
import ChecklistFormBuilder from "./ChecklistFormBuilder";
import { ChecklistPreviewPanel } from "./ChecklistPreviewPanel";
import { ShareDialog } from "./ShareDialog";
import { ResponsesPanel } from "./ResponsesPanel";
import api, { type ChecklistTemplateDto, type ChecklistDto, type ChecklistQuestionDto } from "../../services/api";
import * as XLSX from "xlsx";

// ---- Predefined upload-template contract (keeps imports from corrupting data) ----
const TEMPLATE_COLUMNS = ["order_index","question_group","checklist_item_caption","question_type","default_answer","photo_available","answer_options","corrective_option","corrective_actions","policy"] as const;
const TEMPLATE_REQUIRED = ["order_index","question_group","checklist_item_caption","question_type"] as const;
const ALLOWED_QTYPES = ["text","number","percentage","photo","yes_no","checkbox"];
const ALLOWED_PHOTO = ["Yes","No"];

type TemplateItem = { question: string; questionType: string; required: boolean; position: number; options: string[]; questionGroup: string; defaultAnswer: string; photoAvailable: string; correctiveOption: string; correctiveActions: string[]; policy: string };

// Parse a .csv/.xlsx file (or pasted CSV) into header + row objects using the
// "Checklist Items" sheet when present.
async function readTemplateRows(input: File | string): Promise<{ headers: string[]; rows: Record<string, string>[] }> {
  const wb = typeof input === "string"
    ? XLSX.read(input, { type: "string" })
    : XLSX.read(await input.arrayBuffer(), { type: "array" });
  const sheetName = wb.SheetNames.includes("Checklist Items") ? "Checklist Items" : wb.SheetNames[0];
  const grid: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, blankrows: false, defval: "" });
  if (!grid.length) throw new Error("The file appears to be empty.");
  const headers = (grid[0] || []).map((h) => String(h).trim());
  const rows = grid.slice(1).map((arr) => {
    const o: Record<string, string> = {};
    headers.forEach((h, i) => { o[h] = String(arr[i] ?? "").trim(); });
    return o;
  });
  return { headers, rows };
}

// Strictly validate rows against the template. Returns parsed items OR errors.
function validateTemplate(headers: string[], rows: Record<string, string>[]): { items: TemplateItem[]; errors: string[] } {
  const errors: string[] = [];
  const present = headers.filter(Boolean);
  const missing = TEMPLATE_REQUIRED.filter((c) => !present.includes(c));
  if (missing.length) errors.push(`Missing required column(s): ${missing.join(", ")}.`);
  const unknown = present.filter((h) => !TEMPLATE_COLUMNS.includes(h as any));
  if (unknown.length) errors.push(`Unknown column(s): ${unknown.join(", ")}. Use the provided template — don't rename or add columns.`);
  if (errors.length) return { items: [], errors };

  const items: TemplateItem[] = [];
  const seenOrder = new Set<string>();
  rows.forEach((r, idx) => {
    if (Object.values(r).every((v) => !v)) return; // skip blank rows
    const line = idx + 2; // +1 header, +1 to 1-index
    const oi = (r.order_index || "").trim();
    if (!/^\d+$/.test(oi)) errors.push(`Row ${line}: order_index must be a whole number (got "${oi}").`);
    else if (seenOrder.has(oi)) errors.push(`Row ${line}: duplicate order_index ${oi}.`);
    seenOrder.add(oi);
    if (!r.question_group) errors.push(`Row ${line}: question_group is required.`);
    if (!r.checklist_item_caption) errors.push(`Row ${line}: checklist_item_caption is required.`);
    if (!ALLOWED_QTYPES.includes(r.question_type)) errors.push(`Row ${line}: invalid question_type "${r.question_type}" — allowed: ${ALLOWED_QTYPES.join(", ")}.`);
    const photo = r.photo_available || "No";
    if (!ALLOWED_PHOTO.includes(photo)) errors.push(`Row ${line}: photo_available must be Yes or No.`);
    items.push({
      question: r.checklist_item_caption,
      questionType: r.question_type,
      required: false,
      position: Number(oi) || items.length + 1,
      options: (r.answer_options || "").split("|").map((s) => s.trim()).filter(Boolean),
      questionGroup: r.question_group,
      defaultAnswer: r.default_answer || "",
      photoAvailable: photo,
      correctiveOption: r.corrective_option || "",
      correctiveActions: (r.corrective_actions || "").split("|").map((s) => s.trim()).filter(Boolean),
      policy: r.policy || "",
    });
  });
  items.sort((a, b) => a.position - b.position);
  return { items: errors.length ? [] : items, errors };
}

function downloadTemplateCSV() {
  const example = [
    ["1","Formwork","Formwork aligned, clean, and braced","yes_no","","No","Yes|No","No","Re-align and brace formwork|Re-inspect","ACI 318"],
    ["2","Reinforcement","Concrete cover measured (mm)","number","","No","","","","Min 50mm cover"],
    ["3","Safety","PPE worn by all crew","yes_no","","Yes","Yes|No","No","Stop work|Issue PPE","Site safety plan"],
  ];
  const csv = [TEMPLATE_COLUMNS.join(","), ...example.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "checklist_upload_template.csv"; a.click();
}

export const STATUS_META: Record<string, { bg: string; text: string; border: string; label: string }> = {
  draft: { bg: "bg-[#222A35]", text: "text-[#8A95A5]", border: "border-[#222A35]", label: "Draft" },
  assigned: { bg: "bg-[#3B82F6]/15", text: "text-[#3B82F6]", border: "border-[#3B82F6]/30", label: "Assigned" },
  in_progress: { bg: "bg-[#F59E0B]/15", text: "text-[#F59E0B]", border: "border-[#F59E0B]/30", label: "In Progress" },
  submitted: { bg: "bg-[#8B5CF6]/15", text: "text-[#8B5CF6]", border: "border-[#8B5CF6]/30", label: "Submitted" },
  approved: { bg: "bg-[#22C55E]/15", text: "text-[#22C55E]", border: "border-[#22C55E]/30", label: "Approved" },
  rejected: { bg: "bg-[#EF4444]/15", text: "text-[#EF4444]", border: "border-[#EF4444]/30", label: "Rejected" },
};

const QTYPE_LABEL: Record<string, string> = {
  text: "Text", number: "Number", date: "Date", yes_no: "Yes / No", pass_fail: "Pass / Fail",
  dropdown: "Dropdown", checkbox: "Checkbox", photo: "Photo", signature: "Signature",
};

const TRADES = ["General","Electrical","Plumbing","HVAC","Carpentry","Painting","Masonry","Roofing","Drywall","Concrete","Landscaping"];
const CATEGORIES = ["safety","quality","pre-handover","custom"];

// Module-scope so every sub-component (Detail/Fill modals) can use it.
type QNode = { q: ChecklistQuestionDto; number: string; depth: number };
function buildQuestionTree(questions: ChecklistQuestionDto[]): QNode[] {
  const sorted = [...questions].sort((a, b) => a.position - b.position);
  const byParent = new Map<string | null, ChecklistQuestionDto[]>();
  sorted.forEach((q) => { const pid = q.parentId || null; if (!byParent.has(pid)) byParent.set(pid, []); byParent.get(pid)!.push(q); });
  function walk(pid: string | null, prefix: string, depth: number): QNode[] {
    const children = byParent.get(pid) || [];
    return children.flatMap((q, i) => { const num = prefix ? `${prefix}.${i + 1}` : `${i + 1}`; return [{ q, number: num, depth }, ...walk(q.id, num, depth + 1)]; });
  }
  return walk(null, "", 0);
}

export default function Checklists({ role, aiDraft, onConsumeAiDraft }: { role: Role; aiDraft?: ChecklistTemplateDto | null; onConsumeAiDraft?: () => void }) {
  const perms = ROLES[role];
  const canCreate = perms.canCreateInspection;
  const canAssign = perms.canCreateInspection || role === "Project Manager" || role === "Superintendent";
  const canFill = perms.canFillInspection || role === "Worker" || role === "Trade Lead";

  const [tab, setTab] = useState<"templates"|"checklists">("templates");
  const [templates, setTemplates] = useState<ChecklistTemplateDto[]>([]);
  const [checklists, setChecklists] = useState<ChecklistDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  // Modals state
  const [csvOpen, setCsvOpen] = useState(false);
  const [tmplOpen, setTmplOpen] = useState(false);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [previewTpl, setPreviewTpl] = useState<ChecklistTemplateDto | null>(null);
  const [editTpl, setEditTpl] = useState<ChecklistTemplateDto | null>(null);
  const [shareTpl, setShareTpl] = useState<ChecklistTemplateDto | null>(null);
  const [responsesTpl, setResponsesTpl] = useState<ChecklistTemplateDto | null>(null);
  const [detail, setDetail] = useState<ChecklistDto|null>(null);
  const [fill, setFill] = useState<ChecklistDto|null>(null);
  const [assign, setAssign] = useState<ChecklistDto|null>(null);

  useEffect(() => { loadData(); }, [statusFilter]);

  // A checklist drafted by the AI in chat — open it in the Form Builder as a new,
  // unsaved form (no id ⇒ the builder treats it as a fresh create). We consume
  // the draft so navigating away and back doesn't reopen it.
  useEffect(() => {
    if (aiDraft) { setBuilderOpen(false); setEditTpl(aiDraft); onConsumeAiDraft?.(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiDraft]);

  async function loadData() {
    setLoading(true);
    try {
      const [tRes, cRes] = await Promise.all([
        api.getChecklistTemplates(),
        api.getChecklists(statusFilter ? { status: statusFilter } : undefined),
      ]);
      setTemplates(Array.isArray(tRes) ? tRes : []);
      setChecklists(Array.isArray(cRes) ? cRes : []);
    } catch (e: any) { console.error("loadData error:", e); toast.error(e?.message || "Failed to load data"); }
    setLoading(false);
  }

  const ft = useMemo(() => {
    const q = search.toLowerCase();
    return templates.filter((t) => t.title.toLowerCase().includes(q) || (t.trade||"").toLowerCase().includes(q));
  }, [templates, search]);

  const fc = useMemo(() => {
    const q = search.toLowerCase();
    return checklists.filter((c) => c.title.toLowerCase().includes(q) || (c.category||"").toLowerCase().includes(q));
  }, [checklists, search]);

  useTeam(); // load real users so assignee names resolve + re-render when ready
  function names(assignedTo?: string|null) {
    if (!assignedTo) return "";
    try { const ids: string[] = JSON.parse(assignedTo); return ids.map((id) => resolveName(id)).join(", "); }
    catch { return assignedTo; }
  }
  function opts(s?: string|null) { if (!s) return []; try { return JSON.parse(s); } catch { return []; } }
  function progress(c: ChecklistDto) { return c.questions.length ? Math.round((c.responses?.length || 0) / c.questions.length * 100) : 0; }

  async function fromTemplate(id: string) {
    try { const r = await api.createChecklistFromTemplate(id, {}); toast.success(`Created "${r.title}"`); setTab("checklists"); loadData(); }
    catch { toast.error("Failed to create from template"); }
  }

  async function createTmpl(title: string, trade: string, category: string, global: boolean, qs: {question:string;questionType:string;required:boolean;options:string;parentId?:string|null;tempId?:string;parentTempId?:string|null}[]) {
    if (!title.trim()) return toast.error("Title required");
    const items = qs.filter((q) => q.question.trim()).map((q, i) => ({ question: q.question.trim(), questionType: q.questionType, required: q.required, position: i, options: q.options ? q.options.split(/[,;|]/).map((o) => o.trim()).filter(Boolean) : [], parentId: (q as any).parentTempId || q.parentId || null, tempId: q.tempId }));
    try { await api.createChecklistTemplate({ title, trade, category, items: JSON.stringify(items), isGlobal: global, status: "active" }); toast.success("Template created"); loadData(); }
    catch { toast.error("Failed to create template"); }
  }

  async function delTmpl(id: string) { if (!confirm("Delete template?")) return; try { await api.deleteChecklistTemplate(id); toast.success("Deleted"); loadData(); } catch { toast.error("Delete failed"); } }
  async function delChk(id: string) { if (!confirm("Delete checklist?")) return; try { await api.deleteChecklist(id); toast.success("Deleted"); loadData(); } catch { toast.error("Delete failed"); } }

  async function onAssign(chkId: string, userIds: string[]) {
    if (!userIds.length) return;
    try { await api.assignChecklist(chkId, userIds); toast.success("Assigned"); loadData(); }
    catch { toast.error("Assignment failed"); }
  }

  async function onSubmit(chkId: string, questions: ChecklistQuestionDto[], answers: Record<string,string>) {
    const responses = questions.map((q) => ({ questionId: q.id, value: answers[q.id] || "" }));
    try { await api.submitChecklist(chkId, responses); toast.success("Submitted"); loadData(); }
    catch { toast.error("Submit failed"); }
  }

  async function setStatus(id: string, status: string) {
    try { await api.updateChecklist(id, { status }); toast.success("Status updated"); loadData(); }
    catch { toast.error("Update failed"); }
  }

  async function addQ(chkId: string, parentId?: string | null) {
    try {
      await api.createChecklistQuestion(chkId, { question: parentId ? "New sub-question" : "New question", questionType: "text", required: false, position: 999, parentId: parentId || null });
      toast.success("Added"); loadData(); if (detail?.id === chkId) { const r = await api.getChecklist(chkId); setDetail(r); }
    }
    catch { toast.error("Failed"); }
  }

  async function updQ(chkId: string, q: ChecklistQuestionDto) {
    try { await api.updateChecklistQuestion(chkId, q.id, { question: q.question, questionType: q.questionType, required: q.required, position: q.position, options: q.options || "[]" }); toast.success("Updated"); const r = await api.getChecklist(chkId); setDetail(r); loadData(); }
    catch { toast.error("Failed"); }
  }

  async function delQ(chkId: string, qid: string) {
    if (!confirm("Delete question?")) return; try { await api.deleteChecklistQuestion(chkId, qid); toast.success("Deleted"); loadData(); if (detail) { const r = await api.getChecklist(chkId); setDetail(r); } }
    catch { toast.error("Failed"); }
  }

  // Form Builder takes over the whole page (new template or editing an existing one).
  if (builderOpen || editTpl) {
    return <ChecklistFormBuilder initial={editTpl || undefined} onClose={() => { setBuilderOpen(false); setEditTpl(null); }} onSaved={() => { setBuilderOpen(false); setEditTpl(null); loadData(); }} />;
  }

  return (
    <div className="px-5 sm:px-7 py-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
        <div>
          <h2 className="text-xl font-semibold text-white flex items-center gap-2"><ClipboardList className="w-5 h-5 text-[#FF6B1A]" /> Checklists</h2>
          <p className="text-[12px] text-[#8A95A5] mt-0.5">Templates, assignments, and digital submissions</p>
        </div>
        <div className="flex bg-[#11161D] rounded-lg border border-[#222A35] p-0.5">
          <button onClick={() => setTab("templates")} className={`px-3 py-1.5 text-[12px] rounded-md ${tab==="templates"?"bg-[#222A35] text-white":"text-[#8A95A5] hover:text-white"}`}>Templates</button>
          <button onClick={() => setTab("checklists")} className={`px-3 py-1.5 text-[12px] rounded-md ${tab==="checklists"?"bg-[#222A35] text-white":"text-[#8A95A5] hover:text-white"}`}>My Checklists</button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <div className="relative flex-1"><Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#5B6675]" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search..." className="w-full h-9 bg-[#11161D] border border-[#222A35] rounded-lg pl-9 pr-3 text-[13px] text-white placeholder:text-[#5B6675] focus:outline-none focus:border-[#FF6B1A]" /></div>
        {tab==="checklists" && (
          <div className="flex items-center gap-2"><Filter className="w-4 h-4 text-[#5B6675]" />
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-9 bg-[#11161D] border border-[#222A35] rounded-lg px-2 text-[12px] text-white">
              <option value="">All Statuses</option><option value="draft">Draft</option><option value="assigned">Assigned</option><option value="in_progress">In Progress</option><option value="submitted">Submitted</option><option value="approved">Approved</option><option value="rejected">Rejected</option>
            </select>
          </div>
        )}
        {tab==="templates" && canCreate && (
          <><button onClick={() => setCsvOpen(true)} className="h-9 px-3 bg-[#11161D] border border-[#222A35] rounded-lg text-[12px] text-white hover:border-[#FF6B1A] flex items-center gap-1.5"><UploadCloud className="w-3.5 h-3.5" /> Upload</button>
          <button onClick={() => setBuilderOpen(true)} className="h-9 px-3 bg-[#11161D] border border-[#222A35] rounded-lg text-[12px] text-white hover:border-[#FF6B1A] flex items-center gap-1.5"><ClipboardList className="w-3.5 h-3.5" /> Form Builder</button>
          <button onClick={() => setTmplOpen(true)} className="h-9 px-3 bg-[#FF6B1A] text-black rounded-lg text-[12px] font-medium flex items-center gap-1.5 hover:bg-[#FF6B1A]/90"><Plus className="w-3.5 h-3.5" /> New Template</button></>
        )}
      </div>

      {/* Templates Tab */}
      {tab==="templates" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {loading ? <div className="col-span-full flex items-center justify-center py-12 text-[#8A95A5]"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading...</div>
          : ft.length===0 ? <div className="col-span-full text-center py-12 text-[#8A95A5]"><FileText className="w-8 h-8 mx-auto mb-2 opacity-40" /> No templates</div>
          : ft.map((t) => { const items = (()=>{try{return JSON.parse(t.items||"[]");}catch{return[];}})(); return (
            <div key={t.id} className="bg-[#11161D] border border-[#222A35] rounded-xl p-4 hover:border-[#FF6B1A]/40 transition-colors">
              <div className="flex items-start justify-between mb-2"><div className="text-[13px] font-medium text-white">{t.title}</div>{t.isGlobal && <span className="text-[10px] bg-[#FF6B1A]/10 text-[#FF6B1A] px-1.5 py-0.5 rounded">Global</span>}</div>
              <div className="flex items-center gap-2 mb-3"><span className="text-[10px] bg-[#222A35] text-[#8A95A5] px-1.5 py-0.5 rounded">{t.trade}</span>{t.category && <span className="text-[10px] bg-[#222A35] text-[#8A95A5] px-1.5 py-0.5 rounded">{t.category}</span>}<span className="text-[10px] text-[#5B6675]">{items.length} items</span></div>
              <div className="flex items-center gap-2">
                <button onClick={() => fromTemplate(t.id)} className="flex-1 h-8 bg-[#FF6B1A] text-black rounded-lg text-[11px] font-medium flex items-center justify-center gap-1 hover:bg-[#FF6B1A]/90"><ArrowRight className="w-3 h-3" /> Use Template</button>
                <button onClick={() => setPreviewTpl(t as any)} title="Preview" className="h-8 w-8 flex items-center justify-center bg-[#222A35] rounded-lg text-[#8A95A5] hover:text-white"><Eye className="w-3.5 h-3.5" /></button>
                {canCreate && <button onClick={() => setShareTpl(t as any)} title="Share link" className="h-8 w-8 flex items-center justify-center bg-[#222A35] rounded-lg text-[#8A95A5] hover:text-white"><Link2 className="w-3.5 h-3.5" /></button>}
                {canCreate && <button onClick={() => setEditTpl(t as any)} title="Edit in Form Builder" className="h-8 w-8 flex items-center justify-center bg-[#222A35] rounded-lg text-[#8A95A5] hover:text-white"><PenTool className="w-3.5 h-3.5" /></button>}
                {canCreate && <button onClick={() => delTmpl(t.id)} className="h-8 w-8 flex items-center justify-center bg-[#222A35] rounded-lg text-[#EF4444] hover:bg-[#EF4444]/10"><Trash2 className="w-3.5 h-3.5" /></button>}
              </div>
            </div>
          ); })}
        </div>
      )}

      {/* Checklists Tab */}
      {tab==="checklists" && (
        <div className="bg-[#11161D] border border-[#222A35] rounded-xl overflow-hidden">
          {loading ? <div className="flex items-center justify-center py-12 text-[#8A95A5]"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading...</div>
          : fc.length===0 ? (
            <EmptyState
              icon={ClipboardList}
              title="No checklists yet"
              description={canCreate ? "Turn a paper form into a digital checklist with AI, start from a ready-made template, or import a CSV." : "Checklists assigned to you will appear here once your team creates them."}
              actionLabel={canCreate ? "Browse templates" : undefined}
              onAction={canCreate ? () => setTab("templates") : undefined}
              secondaryLabel={canCreate ? "Upload CSV" : undefined}
              onSecondary={canCreate ? () => setCsvOpen(true) : undefined}
            />
          )
          : <div className="divide-y divide-[#222A35]">{fc.map((c) => { const st = STATUS_META[c.status]||STATUS_META.draft; const pct = progress(c); return (
            <div key={c.id} className="p-4 hover:bg-[#161D27] transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1"><span className={`text-[10px] px-1.5 py-0.5 rounded border ${st.bg} ${st.text} ${st.border}`}>{st.label}</span>{c.source==="template" && <span className="text-[10px] text-[#5B6675]">from template</span>}{c.source==="upload" && <span className="text-[10px] text-[#5B6675]">from CSV</span>}</div>
                <div className="text-[13px] font-medium text-white truncate">{c.title}</div>
                <div className="text-[11px] text-[#8A95A5] flex items-center gap-2 mt-0.5"><span>{c.questions.length} questions</span><span className="w-1 h-1 rounded-full bg-[#222A35]" /><span>{pct}% complete</span>{c.assignedTo && <><span className="w-1 h-1 rounded-full bg-[#222A35]" /><Users className="w-3 h-3" /><span>{names(c.assignedTo)}</span></>}{c.dueDate && <><span className="w-1 h-1 rounded-full bg-[#222A35]" /><Clock className="w-3 h-3" /><span>{new Date(c.dueDate).toLocaleDateString()}</span></>}</div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {c.status==="draft" && canAssign && <button onClick={()=>setAssign(c)} className="h-8 px-2.5 bg-[#222A35] rounded-lg text-[11px] text-white hover:bg-[#3B82F6]/20 flex items-center gap-1"><UserCheck className="w-3.5 h-3.5" /> Assign</button>}
                {(c.status==="assigned"||c.status==="in_progress") && canFill && <button onClick={()=>setFill(c)} className="h-8 px-2.5 bg-[#FF6B1A]/10 border border-[#FF6B1A]/30 rounded-lg text-[11px] text-[#FF6B1A] hover:bg-[#FF6B1A]/20 flex items-center gap-1"><PenTool className="w-3.5 h-3.5" /> Fill</button>}
                {c.status==="submitted" && canAssign && <><button onClick={()=>setStatus(c.id,"approved")} className="h-8 px-2.5 bg-[#22C55E]/10 border border-[#22C55E]/30 rounded-lg text-[11px] text-[#22C55E] hover:bg-[#22C55E]/20 flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> Approve</button><button onClick={()=>setStatus(c.id,"rejected")} className="h-8 px-2.5 bg-[#EF4444]/10 border border-[#EF4444]/30 rounded-lg text-[11px] text-[#EF4444] hover:bg-[#EF4444]/20 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> Reject</button></>}
                <button onClick={()=>setDetail(c)} className="h-8 w-8 flex items-center justify-center bg-[#222A35] rounded-lg text-[#8A95A5] hover:text-white"><Eye className="w-3.5 h-3.5" /></button>
                {canCreate && <button onClick={()=>delChk(c.id)} className="h-8 w-8 flex items-center justify-center bg-[#222A35] rounded-lg text-[#EF4444] hover:bg-[#EF4444]/10"><Trash2 className="w-3.5 h-3.5" /></button>}
              </div>
            </div>
          ); })}</div>}
        </div>
      )}
      {/* CSV Upload Modal */}
      {csvOpen && <CSVUploadModal onClose={()=>setCsvOpen(false)} onSuccess={()=>{setCsvOpen(false);loadData();}} />}

      {/* Template preview side panel */}
      {previewTpl && <ChecklistPreviewPanel template={previewTpl} canEdit={canCreate} onClose={() => setPreviewTpl(null)} onEdit={() => { setEditTpl(previewTpl); setPreviewTpl(null); }} />}

      {/* Share dialog */}
      {shareTpl && <ShareDialog template={shareTpl} onClose={() => setShareTpl(null)} onUpdated={loadData} onViewResponses={() => { setResponsesTpl(shareTpl); setShareTpl(null); }} />}

      {/* Responses panel */}
      {responsesTpl && <ResponsesPanel template={responsesTpl} onClose={() => setResponsesTpl(null)} />}


      {/* New Template Modal */}
      {tmplOpen && <NewTemplateModal onClose={()=>setTmplOpen(false)} onCreate={createTmpl} />}

      {/* Assign Modal */}
      {assign && <AssignModal checklist={assign} onClose={()=>setAssign(null)} onAssign={onAssign} />}

      {/* Fill Modal */}
      {fill && <FillModal checklist={fill} onClose={()=>setFill(null)} onSubmit={onSubmit} />}

      {/* Detail Modal */}
      {detail && <DetailModal checklist={detail} onClose={()=>setDetail(null)} onAddQ={addQ} onUpdQ={updQ} onDelQ={delQ} canEdit={canCreate} />}
    </div>
  );
}

function CSVUploadModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [mode, setMode] = useState<"file"|"paste">("file");
  const [title, setTitle] = useState("");
  const [trade, setTrade] = useState("General");
  const [category, setCategory] = useState("custom");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [file, setFile] = useState<File|null>(null);
  const [parsed, setParsed] = useState<{ items: TemplateItem[]; errors: string[] } | null>(null);

  // Read + strictly validate a dropped/selected file against the template.
  async function ingest(input: File, f: File) {
    setBusy(true);
    try {
      const { headers, rows } = await readTemplateRows(input);
      const result = validateTemplate(headers, rows);
      setParsed(result); setFile(f);
      if (result.errors.length) toast.error(`${result.errors.length} issue(s) found — fix and re-upload.`);
      else toast.success(`Valid template · ${result.items.length} item(s) ready.`);
    } catch (e: any) { toast.error(e?.message || "Could not read the file."); setParsed(null); }
    setBusy(false);
  }

  async function create(items: TemplateItem[]) {
    if (!items.length) return toast.error("No valid items to import");
    setBusy(true);
    try {
      await api.createChecklistTemplate({ title: title.trim(), trade, category, items: JSON.stringify(items), isGlobal: false, status: "active" } as any);
      toast.success(`Template "${title.trim()}" created with ${items.length} items`);
      onSuccess();
    } catch (e: any) { toast.error(e?.message || "Upload failed"); }
    setBusy(false);
  }

  async function submit() {
    if (!title.trim()) return toast.error("Template title is required");
    if (mode === "paste") {
      if (!text.trim()) return toast.error("Paste CSV content first");
      setBusy(true);
      try {
        const { headers, rows } = await readTemplateRows(text);
        const result = validateTemplate(headers, rows);
        setParsed(result);
        if (result.errors.length) { toast.error(`${result.errors.length} issue(s) found — fix them first.`); setBusy(false); return; }
        await create(result.items);
      } catch (e: any) { toast.error(e?.message || "Could not parse CSV"); setBusy(false); }
      return;
    }
    if (!parsed) return toast.error("Upload a file first");
    if (parsed.errors.length) return toast.error("Fix the validation errors before creating");
    await create(parsed.items);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"><div className="bg-[#11161D] border border-[#222A35] rounded-xl w-full max-w-2xl max-h-[85vh] overflow-y-auto p-5">
      <div className="flex items-center justify-between mb-4"><h3 className="text-[15px] font-semibold text-white flex items-center gap-2"><UploadCloud className="w-4 h-4 text-[#FF6B1A]" /> Upload Checklist</h3><button onClick={onClose} className="text-[#8A95A5] hover:text-white"><X className="w-4 h-4" /></button></div>

      {/* Mode tabs + download template */}
      <div className="flex items-center justify-between gap-2 mb-4">
        <div className="flex gap-1 bg-[#0A0E14] rounded-lg p-1">
          <button onClick={()=>setMode("file")} className={`px-3 h-8 rounded-md text-[12px] font-medium ${mode==="file"?"bg-[#222A35] text-white":"text-[#8A95A5] hover:text-white"}`}>Upload File</button>
          <button onClick={()=>setMode("paste")} className={`px-3 h-8 rounded-md text-[12px] font-medium ${mode==="paste"?"bg-[#222A35] text-white":"text-[#8A95A5] hover:text-white"}`}>Paste CSV</button>
        </div>
        <button onClick={downloadTemplateCSV} className="text-[11px] text-[#FF6B1A] hover:underline flex items-center gap-1 shrink-0"><FileText className="w-3.5 h-3.5" /> Download template</button>
      </div>

      <div className="space-y-3">
        <div><label className="text-[11px] text-[#8A95A5] mb-1 block">Template Title</label><input value={title} onChange={(e)=>setTitle(e.target.value)} className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-lg px-3 text-[13px] text-white focus:outline-none focus:border-[#FF6B1A]" placeholder="e.g. Concrete Pour - Pre-Inspection" /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="text-[11px] text-[#8A95A5] mb-1 block">Trade</label><select value={trade} onChange={(e)=>setTrade(e.target.value)} className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-lg px-2 text-[13px] text-white">{TRADES.map((t)=><option key={t} value={t}>{t}</option>)}</select></div>
          <div><label className="text-[11px] text-[#8A95A5] mb-1 block">Category</label><select value={category} onChange={(e)=>setCategory(e.target.value)} className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-lg px-2 text-[13px] text-white">{CATEGORIES.map((c)=><option key={c} value={c}>{c}</option>)}</select></div>
        </div>

        <div className="text-[11px] text-[#5B6675] bg-[#0A0E14] border border-[#222A35] rounded-md px-3 py-2">Required columns: <span className="text-[#8A95A5] font-mono">order_index, question_group, checklist_item_caption, question_type</span>. Lists (answer_options, corrective_actions) use a pipe: <span className="font-mono">Yes|No</span>. Unknown or missing columns are rejected.</div>

        {mode === "paste" ? (
          <div><label className="text-[11px] text-[#8A95A5] mb-1 block">CSV Content <span className="text-[#5B6675]">(use the template columns)</span></label><textarea value={text} onChange={(e)=>{setText(e.target.value);setParsed(null);}} rows={7} className="w-full bg-[#0A0E14] border border-[#222A35] rounded-lg p-3 text-[12px] text-white font-mono focus:outline-none focus:border-[#FF6B1A]" placeholder={TEMPLATE_COLUMNS.join(",")+"\n1,Safety,PPE worn by all crew,yes_no,,Yes,Yes|No,No,Stop work|Issue PPE,Site safety plan"} /></div>
        ) : !parsed ? (
          <div
            onClick={()=>document.getElementById('chk-file-input')?.click()}
            onDragOver={(e)=>{e.preventDefault();setDragOver(true);}}
            onDragLeave={()=>setDragOver(false)}
            onDrop={(e)=>{e.preventDefault();setDragOver(false);const f=e.dataTransfer.files[0];if(f)ingest(f,f);}}
            className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${dragOver?"border-[#FF6B1A] bg-[#FF6B1A]/5":"border-[#222A35] bg-[#0A0E14]"}`}
          >
            <FileUp className={`w-8 h-8 mx-auto mb-2 ${dragOver?"text-[#FF6B1A]":"text-[#5B6675]"}`} />
            <div className="text-[13px] text-white font-medium">Drop the .xlsx / .csv template here</div>
            <div className="text-[11px] text-[#8A95A5] mt-1">or click to browse</div>
            <input id="chk-file-input" type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={(e)=>{const f=e.target.files?.[0];if(f)ingest(f,f);}} />
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between"><span className="text-[12px] text-[#8A95A5] truncate">{file?.name}</span><button onClick={()=>{setParsed(null);setFile(null);}} className="text-[11px] text-[#EF4444] shrink-0">Clear</button></div>
            {parsed.errors.length ? (
              <div className="rounded-lg border border-[#EF4444]/40 bg-[#EF4444]/10 p-3">
                <div className="text-[12px] text-[#EF4444] font-medium mb-1.5 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" /> {parsed.errors.length} issue(s) — import blocked</div>
                <ul className="text-[11px] text-[#C2CAD6] space-y-0.5 max-h-44 overflow-y-auto list-disc pl-4">{parsed.errors.slice(0,50).map((er,i)=><li key={i}>{er}</li>)}</ul>
              </div>
            ) : (
              <div className="rounded-lg border border-[#22C55E]/40 bg-[#22C55E]/10 p-3">
                <div className="text-[12px] text-[#22C55E] font-medium flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5" /> Valid · {parsed.items.length} item(s) ready</div>
                <div className="mt-2 max-h-44 overflow-y-auto space-y-1">{parsed.items.slice(0,15).map((it,i)=><div key={i} className="text-[11px] flex items-center gap-2"><span className="text-[#5B6675] w-5 shrink-0">{it.position}</span><span className="text-[#8A95A5] shrink-0">{it.questionGroup}</span><span className="text-white truncate">{it.question}</span><span className="text-[10px] text-[#5B6675] ml-auto shrink-0">{it.questionType}</span></div>)}{parsed.items.length>15 && <div className="text-[10px] text-[#5B6675]">+{parsed.items.length-15} more…</div>}</div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2 mt-5"><button onClick={onClose} className="h-9 px-4 bg-[#222A35] rounded-lg text-[12px] text-white">Cancel</button><button onClick={submit} disabled={busy || (mode==="file" && (!parsed || parsed.errors.length>0))} className="h-9 px-4 bg-[#FF6B1A] text-black rounded-lg text-[12px] font-medium flex items-center gap-1.5 disabled:opacity-50">{busy?<Loader2 className="w-3.5 h-3.5 animate-spin" />:<UploadCloud className="w-3.5 h-3.5" />} Create Template</button></div>
    </div></div>
  );
}

function NewTemplateModal({ onClose, onCreate }: { onClose: () => void; onCreate: (title: string, trade: string, category: string, global: boolean, qs: {question:string;questionType:string;required:boolean;options:string;parentId?:string|null;tempId?:string;parentTempId?:string|null}[]) => void }) {
  const [title, setTitle] = useState("");
  const [trade, setTrade] = useState("General");
  const [category, setCategory] = useState("custom");
  const [global, setGlobal] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const fileRef = useRef<HTMLInputElement|null>(null);
  const nextId = () => `t-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  type TItem = { tempId: string; question: string; questionType: string; required: boolean; options: string; parentTempId?: string | null };
  const [qs, setQs] = useState<TItem[]>([{ tempId: nextId(), question: "", questionType: "text", required: false, options: "" }]);

  function treeOf(items: TItem[]) {
    const byParent = new Map<string | null, TItem[]>();
    items.forEach((q) => { const pid = q.parentTempId || null; if (!byParent.has(pid)) byParent.set(pid, []); byParent.get(pid)!.push(q); });
    function walk(pid: string | null, prefix: string, depth: number): { item: TItem; number: string; depth: number; index: number }[] {
      const children = byParent.get(pid) || [];
      return children.flatMap((item, i) => { const num = prefix ? `${prefix}.${i + 1}` : `${i + 1}`; return [{ item, number: num, depth, index: items.indexOf(item) }, ...walk(item.tempId, num, depth + 1)]; });
    }
    return walk(null, "", 0);
  }
  function addRoot() { setQs((prev) => [...prev, { tempId: nextId(), question: "", questionType: "text", required: false, options: "" }]); }
  function addSub(parentTempId: string) { setQs((prev) => [...prev, { tempId: nextId(), question: "", questionType: "text", required: false, options: "", parentTempId }]); }
  function updateAt(index: number, patch: Partial<TItem>) { setQs((prev) => { const n = [...prev]; n[index] = { ...n[index], ...patch }; return n; }); }
  function removeAt(index: number) {
    setQs((prev) => {
      const removed = prev[index];
      const n = prev.filter((_, j) => j !== index);
      return n.filter((q) => q.parentTempId !== removed.tempId);
    });
  }
  async function handleFileUpload(file: File) {
    if (!file) return;
    setExtracting(true);
    try {
      const result: any = await api.aiExtractChecklistFromDocument(file);
      if (result.error) {
        toast.error(`Extraction failed: ${result.error}`);
        console.log('[Frontend] AI raw response:', result.raw);
        return;
      }
      if (result.title) setTitle(result.title);
      const flat: TItem[] = [];
      function walk(items: any[], parentTempId?: string | null) {
        items.forEach((it) => {
          const tid = nextId();
          flat.push({
            tempId: tid,
            question: it.question || '',
            questionType: (it.questionType && Object.keys(QTYPE_LABEL).includes(it.questionType)) ? it.questionType : 'text',
            required: !!it.required,
            options: Array.isArray(it.options) ? it.options.join(',') : (it.options || ''),
            parentTempId: parentTempId || null,
          });
          if (Array.isArray(it.subQuestions) && it.subQuestions.length) {
            walk(it.subQuestions, tid);
          }
        });
      }
      walk(result.questions || []);
      if (flat.length) {
        setQs(flat);
        toast.success(`Extracted ${flat.length} questions from document`);
      } else {
        toast.info("No questions extracted from document. Check the server console for details.");
      }
    } catch (e: any) {
      toast.error(e.message || "Failed to extract checklist from document");
    } finally {
      setExtracting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"><div className="bg-[#11161D] border border-[#222A35] rounded-xl w-full max-w-xl max-h-[85vh] overflow-y-auto p-5">
      <div className="flex items-center justify-between mb-4"><h3 className="text-[15px] font-semibold text-white flex items-center gap-2"><Plus className="w-4 h-4 text-[#FF6B1A]" /> New Template</h3><button onClick={onClose} className="text-[#8A95A5] hover:text-white"><X className="w-4 h-4" /></button></div>
      <div className="space-y-3">
        <input value={title} onChange={(e)=>setTitle(e.target.value)} placeholder="Template title" className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-lg px-3 text-[13px] text-white focus:outline-none focus:border-[#FF6B1A]" />
        <div className="grid grid-cols-2 gap-3"><select value={trade} onChange={(e)=>setTrade(e.target.value)} className="h-9 bg-[#0A0E14] border border-[#222A35] rounded-lg px-2 text-[13px] text-white">{TRADES.map((t)=><option key={t} value={t}>{t}</option>)}</select><select value={category} onChange={(e)=>setCategory(e.target.value)} className="h-9 bg-[#0A0E14] border border-[#222A35] rounded-lg px-2 text-[13px] text-white">{CATEGORIES.map((c)=><option key={c} value={c}>{c}</option>)}</select></div>
        <label className="flex items-center gap-2 text-[12px] text-[#8A95A5]"><input type="checkbox" checked={global} onChange={(e)=>setGlobal(e.target.checked)} className="accent-[#FF6B1A]" /> Make available to all projects (Global)</label>
        <div className="border border-dashed border-[#222A35] rounded-lg p-3">
          <input ref={fileRef} type="file" accept=".pdf,.doc,.docx,.csv,.xlsx,.xls,image/*" className="hidden" onChange={(e)=>{const f=e.target.files?.[0];if(f)handleFileUpload(f);}} />
          <button onClick={()=>fileRef.current?.click()} disabled={extracting} className="w-full h-8 rounded-lg bg-[#0A0E14] text-[11px] text-[#8A95A5] hover:text-white hover:border-[#FF6B1A] border border-[#222A35] flex items-center justify-center gap-1.5 disabled:opacity-50">
            {extracting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 text-[#FF6B1A]" />}
            {extracting ? "Extracting with AI..." : "Upload PDF, Word, Excel, CSV, or Image to auto-extract checklist"}
          </button>
        </div>
        <div className="text-[11px] text-[#8A95A5] mt-2">Questions</div>
        {treeOf(qs).map(({ item, number, depth, index }) => (
          <div key={item.tempId} className={`space-y-1 ${depth > 0 ? "ml-6" : ""}`}>
            <div className="flex gap-2 items-start">
              <div className="text-[10px] text-[#8A95A5] mt-2.5 w-6 shrink-0">{number}</div>
              <input value={item.question} onChange={(e)=>updateAt(index, { question: e.target.value })} placeholder={`Question ${number}`} className="flex-1 h-9 bg-[#0A0E14] border border-[#222A35] rounded-lg px-3 text-[12px] text-white focus:outline-none focus:border-[#FF6B1A]" />
              <select value={item.questionType} onChange={(e)=>updateAt(index, { questionType: e.target.value })} className="h-9 bg-[#0A0E14] border border-[#222A35] rounded-lg px-2 text-[12px] text-white w-28">{Object.entries(QTYPE_LABEL).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select>
              <input value={item.options} onChange={(e)=>updateAt(index, { options: e.target.value })} placeholder="Opts" className="w-28 h-9 bg-[#0A0E14] border border-[#222A35] rounded-lg px-2 text-[12px] text-white" title="Dropdown options separated by comma or semicolon" />
              <label className="flex items-center gap-1 text-[11px] text-[#8A95A5] mt-2"><input type="checkbox" checked={item.required} onChange={(e)=>updateAt(index, { required: e.target.checked })} /> Req</label>
              <button onClick={()=>removeAt(index)} className="mt-1.5 text-[#EF4444]"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
            {depth < 3 && (
              <button onClick={()=>addSub(item.tempId)} className="text-[10px] text-[#FF6B1A] hover:underline flex items-center gap-0.5 ml-8"><Plus className="w-3 h-3" /> Add sub-question</button>
            )}
          </div>
        ))}
        <button onClick={addRoot} className="text-[12px] text-[#FF6B1A] flex items-center gap-1"><Plus className="w-3.5 h-3.5" /> Add question</button>
      </div>
      <div className="flex justify-end gap-2 mt-5"><button onClick={onClose} className="h-9 px-4 bg-[#222A35] rounded-lg text-[12px] text-white">Cancel</button><button onClick={()=>{onCreate(title,trade,category,global,qs);onClose();}} className="h-9 px-4 bg-[#FF6B1A] text-black rounded-lg text-[12px] font-medium">Create Template</button></div>
    </div></div>
  );
}

export function AssignModal({ checklist, onClose, onAssign }: { checklist: ChecklistDto; onClose: () => void; onAssign: (id: string, userIds: string[]) => void }) {
  const [sel, setSel] = useState<string[]>([]);
  const team = useTeam();
  const people = team.length ? team : TEAM_MEMBERS; // real invited users; demo fallback if none yet
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"><div className="bg-[#11161D] border border-[#222A35] rounded-xl w-full max-w-md p-5">
      <div className="flex items-center justify-between mb-4"><h3 className="text-[15px] font-semibold text-white flex items-center gap-2"><UserCheck className="w-4 h-4 text-[#FF6B1A]" /> Assign Checklist</h3><button onClick={onClose} className="text-[#8A95A5] hover:text-white"><X className="w-4 h-4" /></button></div>
      <div className="text-[13px] text-white mb-3">{checklist.title}</div>
      <div className="space-y-2 max-h-64 overflow-y-auto">
        {people.length === 0 && <div className="text-[12px] text-[#5B6675] text-center py-4">No teammates yet. Invite people on the Team page first.</div>}
        {people.map((u)=>(
          <label key={u.id} className="flex items-center gap-2 p-2 rounded-lg hover:bg-[#222A35] cursor-pointer">
            <input type="checkbox" checked={sel.includes(u.id)} onChange={(e)=>{if(e.target.checked)setSel([...sel,u.id]);else setSel(sel.filter((id)=>id!==u.id));}} className="accent-[#FF6B1A]" />
            <div><div className="text-[12px] text-white">{u.name}</div><div className="text-[10px] text-[#8A95A5]">{u.role}</div></div>
          </label>
        ))}
      </div>
      <div className="flex justify-end gap-2 mt-5"><button onClick={onClose} className="h-9 px-4 bg-[#222A35] rounded-lg text-[12px] text-white">Cancel</button><button onClick={()=>{onAssign(checklist.id,sel);onClose();}} disabled={sel.length===0} className="h-9 px-4 bg-[#FF6B1A] text-black rounded-lg text-[12px] font-medium disabled:opacity-50">Assign ({sel.length})</button></div>
    </div></div>
  );
}

export function FillModal({ checklist, onClose, onSubmit }: { checklist: ChecklistDto; onClose: () => void; onSubmit: (id: string, questions: ChecklistQuestionDto[], answers: Record<string,string>) => void }) {
  const [answers, setAnswers] = useState<Record<string,string>>({});
  const [busy, setBusy] = useState(false);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"><div className="bg-[#11161D] border border-[#222A35] rounded-xl w-full max-w-lg max-h-[85vh] overflow-y-auto p-5">
      <div className="flex items-center justify-between mb-4"><h3 className="text-[15px] font-semibold text-white flex items-center gap-2"><PenTool className="w-4 h-4 text-[#FF6B1A]" /> Fill Checklist</h3><button onClick={onClose} className="text-[#8A95A5] hover:text-white"><X className="w-4 h-4" /></button></div>
      <div className="text-[13px] text-white mb-1">{checklist.title}</div>
      <div className="text-[11px] text-[#8A95A5] mb-4">{checklist.questions.length} questions</div>
      <div className="space-y-4">
        {(() => {
        const tree = buildQuestionTree(checklist.questions);
        let lastGroup = "";
        return tree.map(({ q, number, depth }) => {
          const qq = q as any;
          const group = qq.questionGroup || "";
          const showGroup = depth === 0 && group && group !== lastGroup;
          if (depth === 0) lastGroup = group;
          const val = answers[q.id] || "";
          const o = (()=>{try{return JSON.parse(q.options||"[]");}catch{return[];}})();
          const corr = (()=>{try{return JSON.parse(qq.correctiveActions||"[]");}catch{return[];}})();
          const triggered = qq.correctiveOption && val && val === qq.correctiveOption;
          return (
            <div key={q.id}>
            {showGroup && <div className="text-[11px] uppercase tracking-wider text-[#FF6B1A] font-semibold mt-1 mb-1.5">{group}</div>}
            <div className={`bg-[#0A0E14] border border-[#222A35] rounded-lg p-3 ${depth > 0 ? "ml-6 border-l-2 border-l-[#FF6B1A]/40" : ""}`}>
              <div className="text-[12px] text-white mb-1.5">{number}. {q.question} {q.required && <span className="text-[#EF4444]">*</span>}</div>
              {q.questionType==="text" && <input value={val} onChange={(e)=>setAnswers({...answers,[q.id]:e.target.value})} placeholder={qq.defaultAnswer||""} className="w-full h-9 bg-[#11161D] border border-[#222A35] rounded-lg px-3 text-[12px] text-white focus:outline-none focus:border-[#FF6B1A]" />}
              {q.questionType==="number" && <input type="number" value={val} onChange={(e)=>setAnswers({...answers,[q.id]:e.target.value})} placeholder={qq.defaultAnswer||""} className="w-full h-9 bg-[#11161D] border border-[#222A35] rounded-lg px-3 text-[12px] text-white focus:outline-none focus:border-[#FF6B1A]" />}
              {q.questionType==="date" && <input type="date" value={val} onChange={(e)=>setAnswers({...answers,[q.id]:e.target.value})} className="w-full h-9 bg-[#11161D] border border-[#222A35] rounded-lg px-3 text-[12px] text-white focus:outline-none focus:border-[#FF6B1A]" />}
              {(q.questionType==="yes_no" || q.questionType==="pass_fail") && (
                <div className="flex gap-2">
                  {["Yes","No"].map((opt)=>(
                    <button key={opt} onClick={()=>setAnswers({...answers,[q.id]:opt})} className={`flex-1 h-8 rounded-lg text-[11px] font-medium border ${val===opt?"bg-[#FF6B1A]/20 border-[#FF6B1A] text-[#FF6B1A]":"bg-[#11161D] border-[#222A35] text-[#8A95A5]"}`}>{opt}</button>
                  ))}
                </div>
              )}
              {q.questionType==="dropdown" && (
                <select value={val} onChange={(e)=>setAnswers({...answers,[q.id]:e.target.value})} className="w-full h-9 bg-[#11161D] border border-[#222A35] rounded-lg px-2 text-[12px] text-white"><option value="">Select...</option>{o.map((opt:string)=><option key={opt} value={opt}>{opt}</option>)}</select>
              )}
              {q.questionType==="checkbox" && (
                <div className="space-y-1">
                  {o.map((opt:string)=>{
                    const checked = (val||"").split(",").includes(opt);
                    return (
                      <label key={opt} className="flex items-center gap-2 text-[12px] text-white">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e)=>{
                            const arr=(val||"").split(",").filter(Boolean);
                            const next = e.target.checked ? [...arr,opt].join(",") : arr.filter((x)=>x!==opt).join(",");
                            setAnswers({...answers,[q.id]:next});
                          }}
                          className="accent-[#FF6B1A]"
                        />
                        {opt}
                      </label>
                    );
                  })}
                </div>
              )}
              {q.questionType==="photo" && <input value={val} onChange={(e)=>setAnswers({...answers,[q.id]:e.target.value})} placeholder="Paste photo URL or description" className="w-full h-9 bg-[#11161D] border border-[#222A35] rounded-lg px-3 text-[12px] text-white focus:outline-none focus:border-[#FF6B1A]" />}
              {q.questionType==="signature" && <input value={val} onChange={(e)=>setAnswers({...answers,[q.id]:e.target.value})} placeholder="Signee name" className="w-full h-9 bg-[#11161D] border border-[#222A35] rounded-lg px-3 text-[12px] text-white focus:outline-none focus:border-[#FF6B1A]" />}
              {qq.policy && <div className="text-[10px] text-[#5B6675] mt-2 flex items-start gap-1"><FileText className="w-3 h-3 mt-0.5 shrink-0" /> <span>Ref: {qq.policy}</span></div>}
              {triggered && corr.length>0 && (
                <div className="mt-2 rounded-md border border-[#F5A623]/40 bg-[#F5A623]/10 p-2">
                  <div className="text-[11px] text-[#F5A623] font-medium flex items-center gap-1.5"><AlertTriangle className="w-3 h-3" /> Corrective action required</div>
                  <ul className="text-[11px] text-[#C2CAD6] list-disc pl-4 mt-1 space-y-0.5">{corr.map((a:string,i:number)=><li key={i}>{a}</li>)}</ul>
                </div>
              )}
            </div>
            </div>
          );
        });
        })()}
      </div>
      <div className="flex justify-end gap-2 mt-5"><button onClick={onClose} className="h-9 px-4 bg-[#222A35] rounded-lg text-[12px] text-white">Cancel</button><button onClick={()=>{setBusy(true);onSubmit(checklist.id,checklist.questions,answers);setBusy(false);onClose();}} disabled={busy} className="h-9 px-4 bg-[#FF6B1A] text-black rounded-lg text-[12px] font-medium flex items-center gap-1.5 disabled:opacity-50">{busy?<Loader2 className="w-3.5 h-3.5 animate-spin" />:<CheckCircle2 className="w-3.5 h-3.5" />} Submit</button></div>
    </div></div>
  );
}

export function DetailModal({ checklist, onClose, onAddQ, onUpdQ, onDelQ, canEdit }: { checklist: ChecklistDto; onClose: () => void; onAddQ: (id: string, parentId?: string | null) => void; onUpdQ: (id: string, q: ChecklistQuestionDto) => void; onDelQ: (chkId: string, qid: string) => void; canEdit: boolean }) {
  const [editingQ, setEditingQ] = useState<string|null>(null);
  const [editVal, setEditVal] = useState<{question:string;questionType:string;required:boolean;options:string}>({question:"",questionType:"text",required:false,options:""});
  // Roll-up of every item whose answer triggered its corrective option.
  const flagged = (checklist.questions as any[])
    .map((q) => {
      const resp = checklist.responses?.find((r) => r.questionId === q.id);
      const actions = (() => { try { return JSON.parse(q.correctiveActions || "[]"); } catch { return []; } })();
      const triggered = q.correctiveOption && resp && resp.value === q.correctiveOption;
      return triggered ? { question: q.question, group: q.questionGroup || "", answer: resp!.value, actions: actions as string[] } : null;
    })
    .filter(Boolean) as { question: string; group: string; answer: string; actions: string[] }[];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"><div className="bg-[#11161D] border border-[#222A35] rounded-xl w-full max-w-2xl max-h-[85vh] overflow-y-auto p-5">
      <div className="flex items-center justify-between mb-4"><h3 className="text-[15px] font-semibold text-white flex items-center gap-2"><Eye className="w-4 h-4 text-[#FF6B1A]" /> Checklist Detail</h3><button onClick={onClose} className="text-[#8A95A5] hover:text-white"><X className="w-4 h-4" /></button></div>
      <div className="text-[13px] text-white mb-1">{checklist.title}</div>
      <div className="text-[11px] text-[#8A95A5] mb-4">{checklist.questions.length} questions · Status: {checklist.status}</div>
      {flagged.length > 0 && (
        <div className="mb-4 rounded-lg border border-[#F5A623]/40 bg-[#F5A623]/10 p-3">
          <div className="text-[12px] text-[#F5A623] font-semibold flex items-center gap-1.5 mb-2"><AlertTriangle className="w-3.5 h-3.5" /> {flagged.length} corrective action{flagged.length>1?"s":""} flagged</div>
          <div className="space-y-2">
            {flagged.map((f, i) => (
              <div key={i} className="text-[11px]">
                <div className="text-white">{f.group && <span className="text-[#8A95A5]">{f.group} · </span>}{f.question} <span className="text-[#F5A623]">→ {f.answer}</span></div>
                {f.actions.length > 0 && <ul className="text-[#C2CAD6] list-disc pl-4 mt-0.5 space-y-0.5">{f.actions.map((a,j)=><li key={j}>{a}</li>)}</ul>}
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="space-y-2 mb-4">
        {(() => {
        const tree = buildQuestionTree(checklist.questions);
        let lastGroup = "";
        return tree.map(({ q, number, depth }) => {
          const qq = q as any;
          const group = qq.questionGroup || "";
          const showGroup = depth === 0 && group && group !== lastGroup;
          if (depth === 0) lastGroup = group;
          const isEdit = editingQ === q.id;
          const o = (()=>{try{return JSON.parse(q.options||"[]");}catch{return[];}})();
          const resp = checklist.responses?.find((r)=>r.questionId===q.id);
          return (
            <div key={q.id}>
            {showGroup && <div className="text-[11px] uppercase tracking-wider text-[#FF6B1A] font-semibold mt-1 mb-1.5">{group}</div>}
            <div className={`bg-[#0A0E14] border border-[#222A35] rounded-lg p-3 ${depth > 0 ? "ml-6 border-l-2 border-l-[#FF6B1A]/40" : ""}`}>
              {isEdit ? (
                <div className="space-y-2">
                  <input value={editVal.question} onChange={(e)=>setEditVal({...editVal,question:e.target.value})} className="w-full h-9 bg-[#11161D] border border-[#222A35] rounded-lg px-3 text-[12px] text-white focus:outline-none focus:border-[#FF6B1A]" />
                  <div className="flex gap-2">
                    <select value={editVal.questionType} onChange={(e)=>setEditVal({...editVal,questionType:e.target.value})} className="h-9 bg-[#11161D] border border-[#222A35] rounded-lg px-2 text-[12px] text-white">{Object.entries(QTYPE_LABEL).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select>
                    <input value={editVal.options} onChange={(e)=>setEditVal({...editVal,options:e.target.value})} placeholder="Options" className="flex-1 h-9 bg-[#11161D] border border-[#222A35] rounded-lg px-2 text-[12px] text-white" />
                    <label className="flex items-center gap-1 text-[11px] text-[#8A95A5]"><input type="checkbox" checked={editVal.required} onChange={(e)=>setEditVal({...editVal,required:e.target.checked})} /> Req</label>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={()=>{onUpdQ(checklist.id,{...q,question:editVal.question,questionType:editVal.questionType,required:editVal.required,options:editVal.options});setEditingQ(null);}} className="h-8 px-3 bg-[#22C55E] text-black rounded-lg text-[11px] font-medium">Save</button>
                    <button onClick={()=>setEditingQ(null)} className="h-8 px-3 bg-[#222A35] rounded-lg text-[11px] text-white">Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] text-white">{number}. {q.question} {q.required && <span className="text-[#EF4444]">*</span>}</div>
                    <div className="text-[10px] text-[#8A95A5] mt-0.5">{QTYPE_LABEL[q.questionType]||q.questionType} {o.length ? `· options: ${o.join(", ")}` : ""}</div>
                    {resp && <div className="text-[11px] text-[#22C55E] mt-1">Answer: {resp.value}</div>}
                    {qq.policy && <div className="text-[10px] text-[#5B6675] mt-1 flex items-center gap-1"><FileText className="w-3 h-3 shrink-0" /> Ref: {qq.policy}</div>}
                    {canEdit && depth < 3 && (
                      <button onClick={()=>onAddQ(checklist.id,q.id)} className="mt-1.5 text-[10px] text-[#FF6B1A] hover:underline flex items-center gap-0.5"><Plus className="w-3 h-3" /> Add sub-question</button>
                    )}
                  </div>
                  {canEdit && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={()=>{setEditingQ(q.id);setEditVal({question:q.question,questionType:q.questionType,required:q.required,options:q.options||""});}} className="h-7 w-7 flex items-center justify-center rounded bg-[#222A35] text-[#8A95A5] hover:text-white"><PenTool className="w-3 h-3" /></button>
                      <button onClick={()=>onDelQ(checklist.id,q.id)} className="h-7 w-7 flex items-center justify-center rounded bg-[#222A35] text-[#EF4444] hover:bg-[#EF4444]/10"><Trash2 className="w-3 h-3" /></button>
                    </div>
                  )}
                </div>
              )}
            </div>
            </div>
          );
        });
        })()}
      </div>
      {canEdit && <button onClick={()=>onAddQ(checklist.id)} className="h-8 px-3 bg-[#222A35] rounded-lg text-[11px] text-white hover:bg-[#FF6B1A]/20 flex items-center gap-1"><Plus className="w-3.5 h-3.5" /> Add Question</button>}
    </div></div>
  );
}
