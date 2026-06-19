import { useState, useEffect, useRef, useMemo } from "react";
import { toast } from "sonner";
import {
  Plus, Search, X, Trash2, ClipboardCheck, CheckCircle2, Clock, AlertTriangle, Camera, Video, User, FileText,
  Download, RotateCcw, Eye, ImagePlus, Sparkles
} from "lucide-react";
import type { Role } from "./roles";
import { ROLES } from "./roles";
import api, { type InspectionDto } from "../../services/api";
import jsPDF from "jspdf";
import { ImageLightbox } from "./ImageLightbox";

const USERS = ["Alice (Consultant)", "Bob (Consultant)", "Carlos (Site Eng)", "Diana (QA/QC)"];

const STATUS_COLOR: Record<string, string> = {
  draft: "#5B6675",
  pending_consultant: "#3B82F6",
  in_review: "#F5A623",
  approved: "#22C55E",
  rejected: "#EF4444",
  rework_required: "#F97316",
  closed: "#8B5CF6",
};

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  pending_consultant: "Pending Consultant",
  in_review: "In Review",
  approved: "Approved",
  rejected: "Rejected",
  rework_required: "Rework Required",
  closed: "Closed",
};

const STATUSES = ["draft", "pending_consultant", "in_review", "approved", "rejected", "rework_required", "closed"];
const TYPES = ["quality", "safety", "structural", "environmental", "electrical", "plumbing", "road-surface", "subgrade", "drainage-inspection", "bridge-structural", "asphalt-compaction", "traffic-control"];

const TYPE_LABELS: Record<string, string> = {
  quality: "Quality",
  safety: "Safety",
  structural: "Structural",
  environmental: "Environmental",
  electrical: "Electrical",
  plumbing: "Plumbing",
  "road-surface": "Road Surface",
  subgrade: "Subgrade / Earthwork",
  "drainage-inspection": "Drainage / Culvert",
  "bridge-structural": "Bridge Structural",
  "asphalt-compaction": "Asphalt Compaction",
  "traffic-control": "Traffic Control Setup",
};

function parseJSON<T>(val?: string | null, fallback: T = [] as unknown as T): T {
  try { return JSON.parse(val || "") as T; } catch { return fallback; }
}

function statusBadge(status: string) {
  const color = STATUS_COLOR[status] || "#5B6675";
  return (
    <span className="px-2 py-0.5 rounded-full text-[10px] font-medium" style={{ background: color + "20", color, border: `1px solid ${color}40` }}>
      {STATUS_LABEL[status] || status}
    </span>
  );
}

export default function Inspections({ role = "Contractor" }: { role?: Role }) {
  const perms = ROLES[role];
  const [inspections, setInspections] = useState<InspectionDto[]>([]);
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [templates, setTemplates] = useState<{ id: string; title: string; trade: string }[]>([]);
  const [projectId, setProjectId] = useState<string>("");
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [showNew, setShowNew] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<{ images: string[]; index: number; videoUrls?: string[] } | null>(null);
  const [form, setForm] = useState<Partial<InspectionDto>>({ type: "quality", inspector: "", date: "", status: "draft", notes: "", photos: null, videos: null, readinessPhotos: null, assignedTo: null, templateId: null });
  const [uploading, setUploading] = useState(false);
  const [approvalComment, setApprovalComment] = useState("");
  const [generatingPdf, setGeneratingPdf] = useState<string | null>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);
  const readinessRef = useRef<HTMLInputElement>(null);

  const parsePhotos = (row?: Partial<InspectionDto>) => parseJSON<string[]>(row?.photos, []);
  const parseVideos = (row?: Partial<InspectionDto>) => parseJSON<string[]>(row?.videos, []);
  const parseReadiness = (row?: Partial<InspectionDto>) => parseJSON<string[]>(row?.readinessPhotos, []);

  const uploadFile = async (file: File) => {
    setUploading(true);
    try {
      // Cloud (S3/R2) when configured, else server local disk — always persistent.
      return await api.uploadFile(file);
    } catch (e: any) {
      toast.error("Upload failed: " + (e.message || "Unknown"));
      return null;
    } finally { setUploading(false); }
  };

  const attachPhoto = async (file: File) => {
    const url = await uploadFile(file);
    if (!url) return;
    setForm((s) => ({ ...s, photos: JSON.stringify([...parsePhotos(s), url]) }));
  };

  const attachVideo = async (file: File) => {
    const url = await uploadFile(file);
    if (!url) return;
    setForm((s) => ({ ...s, videos: JSON.stringify([...parseVideos(s), url]) }));
  };

  const attachReadiness = async (file: File) => {
    const url = await uploadFile(file);
    if (!url) return;
    setForm((s) => ({ ...s, readinessPhotos: JSON.stringify([...parseReadiness(s), url]) }));
  };

  const removePhoto = (url: string) => {
    const arr = parsePhotos(form).filter((u) => u !== url);
    setForm((s) => ({ ...s, photos: arr.length ? JSON.stringify(arr) : null }));
  };

  const removeVideo = (url: string) => {
    const arr = parseVideos(form).filter((u) => u !== url);
    setForm((s) => ({ ...s, videos: arr.length ? JSON.stringify(arr) : null }));
  };

  const removeReadiness = (url: string) => {
    const arr = parseReadiness(form).filter((u) => u !== url);
    setForm((s) => ({ ...s, readinessPhotos: arr.length ? JSON.stringify(arr) : null }));
  };

  useEffect(() => {
    api.getProjects().then((ps) => {
      const list = ps.map((p) => ({ id: p.id || p.code, name: p.name }));
      setProjects(list);
      if (list.length) {
        setProjectId(list[0].id);
        api.getInspections(list[0].id).then(setInspections).catch(() => {});
      }
    });
    api.getChecklistTemplates().then((ts) => {
      setTemplates(ts.map((t) => ({ id: t.id, title: t.title, trade: t.trade })));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!projectId) return;
    api.getInspections(projectId).then(setInspections).catch(() => {});
  }, [projectId]);

  const filtered = useMemo(() => inspections.filter((i) => {
    if (statusFilter !== "All" && i.status !== statusFilter) return false;
    if (q && !(`${i.inspector} ${i.type} ${i.notes}`.toLowerCase().includes(q.toLowerCase()))) return false;
    return true;
  }), [inspections, statusFilter, q]);

  const detailInspection = inspections.find((i) => i.id === detailId);

  const createInspection = async () => {
    if (!perms.canCreateInspection) return toast.error(`${role} cannot create inspections`);
    if (!form.inspector || !form.inspector.trim() || !form.date) return toast.error("Inspector and date required");
    if (!form.templateId) return toast.error("Please select a checklist template");
    const payload = { ...form, status: "draft" };
    try {
      const row = await api.createInspection(projectId, payload);
      setInspections([row, ...inspections]);
      setShowNew(false);
      setForm({ type: "quality", inspector: "", date: "", status: "draft", notes: "", photos: null, videos: null, readinessPhotos: null, assignedTo: null, templateId: null });
      toast.success("Inspection request created");
    } catch {
      const localRow: InspectionDto = { ...payload, id: `IN-${Date.now()}`, projectId, approvals: [], createdAt: new Date().toISOString() };
      setInspections([localRow, ...inspections]);
      setShowNew(false);
      toast.success("Inspection request created (offline)");
    }
  };

  const deleteInspection = async (id: string) => {
    try { await api.deleteInspection(projectId, id); } catch { /* ignore */ }
    setInspections(inspections.filter((i) => i.id !== id));
    if (detailId === id) setDetailId(null);
    toast.success("Inspection deleted");
  };

  const transitionStatus = async (inspection: InspectionDto, newStatus: string) => {
    try {
      await api.updateInspection(projectId, inspection.id, { status: newStatus });
      setInspections((prev) => prev.map((i) => i.id === inspection.id ? { ...i, status: newStatus } : i));
      toast.success(`Status updated to ${STATUS_LABEL[newStatus] || newStatus}`);
    } catch (e: any) {
      toast.error(e.message || "Status transition failed");
    }
  };

  const submitApproval = async (inspection: InspectionDto, status: "approved" | "rejected" | "rework_required") => {
    if (!perms.canApproveInspection) return toast.error(`${role} cannot approve inspections`);
    try {
      const res = await api.createApproval(inspection.id, { status, comments: approvalComment });
      setInspections((prev) => prev.map((i) => i.id === inspection.id ? { ...i, status: res.inspectionStatus, approvals: [...(i.approvals || []), res.approval] } : i));
      setApprovalComment("");
      toast.success(`Inspection ${status.replace("_", " ")}`);
    } catch (e: any) {
      toast.error(e.message || "Approval failed");
    }
  };

  const generatePDF = async (inspection: InspectionDto) => {
    setGeneratingPdf(inspection.id);
    try {
      const doc = new jsPDF();
      const title = `Inspection Report - ${inspection.type.toUpperCase()}`;
      doc.setFontSize(18);
      doc.text(title, 14, 20);
      doc.setFontSize(10);
      doc.text(`Project: ${projects.find((p) => p.id === projectId)?.name || projectId}`, 14, 30);
      doc.text(`Inspector: ${inspection.inspector}`, 14, 36);
      doc.text(`Date: ${inspection.date}`, 14, 42);
      doc.text(`Status: ${STATUS_LABEL[inspection.status] || inspection.status}`, 14, 48);
      doc.text(`Type: ${TYPE_LABELS[inspection.type] || inspection.type}`, 14, 54);
      if (inspection.notes) {
        doc.text("Notes:", 14, 62);
        const split = doc.splitTextToSize(inspection.notes, 180);
        doc.text(split, 14, 68);
      }
      const approvals = inspection.approvals || [];
      if (approvals.length) {
        let y = 80;
        doc.text("Approvals:", 14, y);
        y += 6;
        approvals.forEach((a) => {
          doc.text(`- ${STATUS_LABEL[a.status] || a.status} by ${a.approvedBy}${a.comments ? ": " + a.comments : ""}`, 14, y);
          y += 6;
        });
      }
      const photos = parsePhotos(inspection);
      if (photos.length) {
        doc.addPage();
        doc.setFontSize(14);
        doc.text("Inspection Photos", 14, 20);
        let y = 30;
        photos.forEach((url, idx) => {
          try {
            doc.addImage(url, "JPEG", 14, y, 80, 60);
          } catch {
            doc.text(`Photo ${idx + 1}: ${url}`, 14, y);
          }
          y += 70;
          if (y > 250) { y = 30; doc.addPage(); }
        });
      }
      doc.save(`inspection-${inspection.id}.pdf`);
      toast.success("PDF report generated");
    } catch (e: any) {
      toast.error("PDF generation failed: " + (e.message || "Unknown"));
    } finally {
      setGeneratingPdf(null);
    }
  };

  const getNextActions = (inspection: InspectionDto) => {
    const actions: { label: string; status: string; color: string }[] = [];
    switch (inspection.status) {
      case "draft":
        if (perms.canCreateInspection) actions.push({ label: "Submit to Consultant", status: "pending_consultant", color: "#3B82F6" });
        break;
      case "pending_consultant":
        if (perms.canFillInspection) actions.push({ label: "Begin Review", status: "in_review", color: "#F5A623" });
        if (perms.canApproveInspection) actions.push({ label: "Reject", status: "rejected", color: "#EF4444" });
        break;
      case "in_review":
        if (perms.canApproveInspection) {
          actions.push({ label: "Approve", status: "approved", color: "#22C55E" });
          actions.push({ label: "Reject", status: "rejected", color: "#EF4444" });
          actions.push({ label: "Request Rework", status: "rework_required", color: "#F97316" });
        }
        break;
      case "approved":
        if (perms.canCreateInspection) actions.push({ label: "Close", status: "closed", color: "#8B5CF6" });
        break;
      case "rejected":
        if (perms.canCreateInspection) actions.push({ label: "Reopen as Draft", status: "draft", color: "#5B6675" });
        if (perms.canCreateInspection) actions.push({ label: "Close", status: "closed", color: "#8B5CF6" });
        break;
      case "rework_required":
        if (perms.canCreateInspection) actions.push({ label: "Resubmit", status: "pending_consultant", color: "#3B82F6" });
        if (perms.canCreateInspection) actions.push({ label: "Close", status: "closed", color: "#8B5CF6" });
        break;
    }
    return actions;
  };

  return (
    <div className="px-4 sm:px-7 py-5 sm:py-6 space-y-5">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[13px] text-white font-display"><ClipboardCheck className="w-4 h-4 text-[#FF6B1A]" /> Inspections</div>
          <div className="text-[11px] text-[#8A95A5] mt-0.5">Template-driven QA/QC inspections with consultant approval workflow</div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="h-9 bg-[#11161D] border border-[#222A35] rounded-md px-2 text-white text-[12px]">
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#5B6675]" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search inspections…" className="w-[180px] sm:w-[220px] h-9 bg-[#11161D] border border-[#222A35] rounded-md pl-8 pr-3 text-[12px] text-white placeholder:text-[#5B6675] focus:outline-none focus:border-[#FF6B1A]" />
          </div>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-9 bg-[#11161D] border border-[#222A35] rounded-md px-2 text-white text-[12px]">
            <option value="All">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
          {perms.canCreateInspection && (
            <button onClick={() => setShowNew(true)} className="h-9 px-3 rounded-md text-[12px] flex items-center gap-1.5 bg-[#FF6B1A] hover:bg-[#FF7E33] text-white">
              <Plus className="w-3.5 h-3.5" /> New Request
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
        {STATUSES.map((s) => (
          <div key={s} className="rounded-xl border border-[#222A35] bg-[#11161D] p-3 cursor-pointer hover:border-[#FF6B1A]/30" onClick={() => setStatusFilter(s === statusFilter ? "All" : s)}>
            <div className="text-[10px] text-[#5B6675] uppercase tracking-wider">{STATUS_LABEL[s]}</div>
            <div className="text-[18px] font-display mt-1" style={{ color: STATUS_COLOR[s] }}>{inspections.filter((i) => i.status === s).length}</div>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-[#222A35] bg-[#11161D] overflow-hidden">
        <div className="overflow-x-auto hidden sm:block">
          <table className="w-full min-w-[900px] text-[12px]">
            <thead>
              <tr className="text-[10px] text-[#5B6675] uppercase tracking-wider">
                <th className="text-left px-4 py-2.5">Type</th>
                <th className="text-left px-3 py-2.5">Inspector</th>
                <th className="text-left px-3 py-2.5">Date</th>
                <th className="text-left px-3 py-2.5">Status</th>
                <th className="text-left px-3 py-2.5">Template</th>
                <th className="text-left px-3 py-2.5">Assignee</th>
                <th className="text-left px-3 py-2.5">Evidence</th>
                <th className="text-right px-4 py-2.5">Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((i) => {
                const pCount = parsePhotos(i).length;
                const vCount = parseVideos(i).length;
                const rCount = parseReadiness(i).length;
                const template = templates.find((t) => t.id === i.templateId);
                return (
                  <tr key={i.id} className="border-t border-[#222A35] hover:bg-[#161C24] cursor-pointer" onClick={() => setDetailId(i.id)}>
                    <td className="px-4 py-2.5"><span className="px-1.5 py-0.5 rounded text-[10px]" style={{ background: (STATUS_COLOR[i.status] || "#5B6675") + "20", color: STATUS_COLOR[i.status] || "#5B6675" }}>{TYPE_LABELS[i.type] || i.type}</span></td>
                    <td className="px-3 py-2.5 text-white">{i.inspector}</td>
                    <td className="px-3 py-2.5 text-[#8A95A5]">{i.date}</td>
                    <td className="px-3 py-2.5">{statusBadge(i.status)}</td>
                    <td className="px-3 py-2.5 text-[#8A95A5]">{template?.title || i.templateId || "—"}</td>
                    <td className="px-3 py-2.5 text-[#8A95A5]">{i.assignedTo || "—"}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex gap-2 text-[10px] text-[#8A95A5]">
                        {rCount > 0 && <span className="flex items-center gap-0.5"><ImagePlus className="w-3 h-3" />{rCount}</span>}
                        {pCount > 0 && <span className="flex items-center gap-0.5"><Camera className="w-3 h-3" />{pCount}</span>}
                        {vCount > 0 && <span className="flex items-center gap-0.5"><Video className="w-3 h-3" />{vCount}</span>}
                        {pCount === 0 && vCount === 0 && rCount === 0 && "—"}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button onClick={(e) => { e.stopPropagation(); deleteInspection(i.id); }} className="text-[#8A95A5] hover:text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={8} className="text-center py-8 text-[11px] text-[#5B6675]">No inspections found</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {/* Mobile card view */}
        <div className="sm:hidden divide-y divide-[#222A35]">
          {filtered.map((i) => {
            const pCount = parsePhotos(i).length;
            const vCount = parseVideos(i).length;
            const rCount = parseReadiness(i).length;
            return (
              <div key={i.id} className="p-3 space-y-2 cursor-pointer" onClick={() => setDetailId(i.id)}>
                <div className="flex items-center justify-between">
                  <span className="px-1.5 py-0.5 rounded text-[10px]" style={{ background: (STATUS_COLOR[i.status] || "#5B6675") + "20", color: STATUS_COLOR[i.status] || "#5B6675" }}>{TYPE_LABELS[i.type] || i.type}</span>
                  {statusBadge(i.status)}
                </div>
                <div className="text-[12px] text-white">{i.inspector} <span className="text-[#8A95A5]">· {i.date}</span></div>
                <div className="flex items-center justify-between text-[11px] text-[#8A95A5]">
                  <div className="flex gap-2">
                    {i.assignedTo && <span className="flex items-center gap-0.5"><User className="w-3 h-3" />{i.assignedTo}</span>}
                    {i.templateId && <span className="flex items-center gap-0.5"><FileText className="w-3 h-3" />Template</span>}
                  </div>
                  <div className="flex gap-2">
                    {rCount > 0 && <span className="flex items-center gap-0.5"><ImagePlus className="w-3 h-3" />{rCount}</span>}
                    {pCount > 0 && <span className="flex items-center gap-0.5"><Camera className="w-3 h-3" />{pCount}</span>}
                    {vCount > 0 && <span className="flex items-center gap-0.5"><Video className="w-3 h-3" />{vCount}</span>}
                  </div>
                </div>
                <div className="flex justify-end">
                  <button onClick={(e) => { e.stopPropagation(); deleteInspection(i.id); }} className="text-[#8A95A5] hover:text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && <div className="text-center py-8 text-[11px] text-[#5B6675]">No inspections found</div>}
        </div>
      </div>

      {/* New Inspection Modal */}
      {showNew && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => setShowNew(false)}>
          <div className="bg-[#11161D] border border-[#222A35] rounded-xl w-full max-w-lg p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div className="text-[14px] text-white font-display">New Inspection Request</div>
              <button onClick={() => setShowNew(false)} className="text-[#8A95A5] hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            <div className="space-y-3 text-[12px]">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-[10px] text-[#8A95A5] uppercase tracking-wider mb-1">Type</div>
                  <select value={form.type || "quality"} onChange={(e) => setForm({ ...form, type: e.target.value })} className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-white">
                    {TYPES.map((t) => <option key={t} value={t}>{TYPE_LABELS[t] || t}</option>)}
                  </select>
                </div>
                <div>
                  <div className="text-[10px] text-[#8A95A5] uppercase tracking-wider mb-1">Date</div>
                  <input type="date" value={form.date || ""} onChange={(e) => setForm({ ...form, date: e.target.value })} className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-3 text-white focus:outline-none focus:border-[#FF6B1A]" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-[10px] text-[#8A95A5] uppercase tracking-wider mb-1">Inspector / Requester</div>
                  <input value={form.inspector || ""} onChange={(e) => setForm({ ...form, inspector: e.target.value })} className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-3 text-white focus:outline-none focus:border-[#FF6B1A]" />
                </div>
                <div>
                  <div className="text-[10px] text-[#8A95A5] uppercase tracking-wider mb-1">Assign to Consultant</div>
                  <select value={form.assignedTo || ""} onChange={(e) => setForm({ ...form, assignedTo: e.target.value || null })} className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-white">
                    <option value="">None</option>
                    {USERS.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <div className="text-[10px] text-[#8A95A5] uppercase tracking-wider mb-1">Checklist Template <span className="text-[#FF6B1A]">*</span></div>
                <select value={form.templateId || ""} onChange={(e) => setForm({ ...form, templateId: e.target.value || null })} className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-white">
                  <option value="">Select a template…</option>
                  {templates.map((t) => <option key={t.id} value={t.id}>{t.title} ({t.trade})</option>)}
                </select>
              </div>
              <div>
                <div className="text-[10px] text-[#8A95A5] uppercase tracking-wider mb-1">Notes</div>
                <textarea value={form.notes || ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} className="w-full bg-[#0A0E14] border border-[#222A35] rounded-md px-3 py-2 text-white focus:outline-none focus:border-[#FF6B1A]" />
              </div>
              {/* Readiness photos */}
              <div>
                <div className="text-[10px] text-[#8A95A5] uppercase tracking-wider mb-1">Readiness Photos (site team)</div>
                <div className="flex flex-wrap items-center gap-2">
                  <button onClick={() => readinessRef.current?.click()} disabled={uploading || parseReadiness(form).length >= 10} className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] border border-[#222A35] text-[#8A95A5] hover:text-white disabled:opacity-40">
                    <ImagePlus className="w-3 h-3" /> Readiness {parseReadiness(form).length}/10
                  </button>
                  <input ref={readinessRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) attachReadiness(f); e.currentTarget.value = ""; }} />
                  <div className="flex flex-wrap gap-1.5">
                    {parseReadiness(form).map((url) => (
                      <div key={url} className="relative group shrink-0">
                        <img src={url} alt="" className="w-14 h-14 rounded border border-[#222A35] object-cover" />
                        <button onClick={() => removeReadiness(url)} className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[#EF4444] text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition"><X className="w-2.5 h-2.5" /></button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              {/* Evidence */}
              <div>
                <div className="text-[10px] text-[#8A95A5] uppercase tracking-wider mb-1">Evidence Photos / Videos</div>
                <div className="flex flex-wrap items-center gap-2">
                  <button onClick={() => photoRef.current?.click()} disabled={uploading || parsePhotos(form).length >= 10} className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] border border-[#222A35] text-[#8A95A5] hover:text-white disabled:opacity-40">
                    <Camera className="w-3 h-3" /> Photo {parsePhotos(form).length}/10
                  </button>
                  <button onClick={() => videoRef.current?.click()} disabled={uploading || parseVideos(form).length >= 3} className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] border border-[#222A35] text-[#8A95A5] hover:text-white disabled:opacity-40">
                    <Video className="w-3 h-3" /> Video {parseVideos(form).length}/3
                  </button>
                  <input ref={photoRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) attachPhoto(f); e.currentTarget.value = ""; }} />
                  <input ref={videoRef} type="file" accept="video/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) attachVideo(f); e.currentTarget.value = ""; }} />
                  <div className="flex flex-wrap gap-1.5">
                    {parsePhotos(form).map((url) => (
                      <div key={url} className="relative group shrink-0">
                        <img src={url} alt="" className="w-14 h-14 rounded border border-[#222A35] object-cover" />
                        <button onClick={() => removePhoto(url)} className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[#EF4444] text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition"><X className="w-2.5 h-2.5" /></button>
                      </div>
                    ))}
                    {parseVideos(form).map((url) => (
                      <div key={url} className="relative group shrink-0">
                        <video src={url} className="w-14 h-14 rounded border border-[#222A35] object-cover" muted />
                        <button onClick={() => removeVideo(url)} className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[#EF4444] text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition"><X className="w-2.5 h-2.5" /></button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 mt-5 pt-4 border-t border-[#222A35]">
              <button onClick={() => setShowNew(false)} className="h-9 px-3 rounded-md border border-[#222A35] text-[12px] text-[#8A95A5] hover:text-white">Cancel</button>
              <button onClick={createInspection} className="h-9 px-4 rounded-md bg-[#FF6B1A] text-white text-[12px] flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" />Create Request</button>
            </div>
          </div>
        </div>
      )}

      {/* Detail / Workflow Modal */}
      {detailInspection && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => setDetailId(null)}>
          <div className="bg-[#11161D] border border-[#222A35] rounded-xl w-full max-w-2xl p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="text-[14px] text-white font-display">{TYPE_LABELS[detailInspection.type] || detailInspection.type} Inspection</div>
                {statusBadge(detailInspection.status)}
              </div>
              <div className="flex items-center gap-2">
                {perms.canViewInspectionReports && (
                  <button onClick={() => generatePDF(detailInspection)} disabled={generatingPdf === detailInspection.id} className="h-8 px-2 rounded-md border border-[#222A35] text-[11px] text-[#8A95A5] hover:text-white flex items-center gap-1">
                    <Download className="w-3.5 h-3.5" /> {generatingPdf === detailInspection.id ? "Generating…" : "PDF"}
                  </button>
                )}
                <button onClick={() => setDetailId(null)} className="text-[#8A95A5] hover:text-white"><X className="w-4 h-4" /></button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-[12px] mb-5">
              <div className="space-y-1">
                <div className="text-[10px] text-[#5B6675] uppercase tracking-wider">Inspector / Requester</div>
                <div className="text-white">{detailInspection.inspector}</div>
              </div>
              <div className="space-y-1">
                <div className="text-[10px] text-[#5B6675] uppercase tracking-wider">Date</div>
                <div className="text-white">{detailInspection.date}</div>
              </div>
              <div className="space-y-1">
                <div className="text-[10px] text-[#5B6675] uppercase tracking-wider">Consultant</div>
                <div className="text-white">{detailInspection.assignedTo || "—"}</div>
              </div>
              <div className="space-y-1">
                <div className="text-[10px] text-[#5B6675] uppercase tracking-wider">Template</div>
                <div className="text-white">{templates.find((t) => t.id === detailInspection.templateId)?.title || detailInspection.templateId || "—"}</div>
              </div>
            </div>

            {detailInspection.notes && (
              <div className="rounded-lg border border-[#222A35] bg-[#0A0E14] p-3 text-[12px] text-[#C2CAD6] mb-4">
                <div className="text-[10px] text-[#5B6675] uppercase tracking-wider mb-1">Notes</div>
                {detailInspection.notes}
              </div>
            )}

            {/* Readiness photos */}
            {parseReadiness(detailInspection).length > 0 && (
              <div className="mb-4">
                <div className="text-[10px] text-[#5B6675] uppercase tracking-wider mb-2">Readiness Photos</div>
                <div className="flex flex-wrap gap-2">
                  {parseReadiness(detailInspection).map((url, i) => (
                    <button key={url} type="button" onClick={() => setLightbox({ images: parseReadiness(detailInspection), index: i })} className="shrink-0">
                      <img src={url} alt="" className="w-20 h-20 rounded border border-[#222A35] object-cover hover:opacity-80 cursor-pointer" />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Evidence */}
            {(parsePhotos(detailInspection).length > 0 || parseVideos(detailInspection).length > 0) && (
              <div className="mb-4">
                <div className="text-[10px] text-[#5B6675] uppercase tracking-wider mb-2">Evidence</div>
                <div className="flex flex-wrap gap-2">
                  {parsePhotos(detailInspection).map((url, i) => (
                    <button key={url} type="button" onClick={() => setLightbox({ images: [...parsePhotos(detailInspection), ...parseVideos(detailInspection)], index: i, videoUrls: parseVideos(detailInspection) })} className="shrink-0">
                      <img src={url} alt="" className="w-20 h-20 rounded border border-[#222A35] object-cover hover:opacity-80 cursor-pointer" />
                    </button>
                  ))}
                  {parseVideos(detailInspection).map((url, i) => (
                    <button key={url} type="button" onClick={() => setLightbox({ images: [...parsePhotos(detailInspection), ...parseVideos(detailInspection)], index: parsePhotos(detailInspection).length + i, videoUrls: parseVideos(detailInspection) })} className="shrink-0 relative">
                      <video src={url} className="w-20 h-20 rounded border border-[#222A35] object-cover hover:opacity-80" muted />
                      <span className="absolute inset-0 flex items-center justify-center pointer-events-none"><span className="w-6 h-6 rounded-full bg-black/60 text-white flex items-center justify-center"><Video className="w-3.5 h-3.5" /></span></span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Approvals history */}
            {(detailInspection.approvals || []).length > 0 && (
              <div className="mb-4">
                <div className="text-[10px] text-[#5B6675] uppercase tracking-wider mb-2">Approval History</div>
                <div className="space-y-2">
                  {(detailInspection.approvals || []).map((a) => (
                    <div key={a.id} className="flex items-start gap-2 text-[11px] rounded-lg border border-[#222A35] bg-[#0A0E14] p-2">
                      <div className="mt-0.5">{statusBadge(a.status)}</div>
                      <div className="flex-1">
                        <div className="text-[#C2CAD6]">By <span className="text-white">{a.approvedBy}</span> · {new Date(a.createdAt).toLocaleString()}</div>
                        {a.comments && <div className="text-[#8A95A5] mt-0.5">{a.comments}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Workflow actions */}
            <div className="border-t border-[#222A35] pt-4 space-y-3">
              <div className="text-[10px] text-[#5B6675] uppercase tracking-wider">Workflow Actions</div>
              <div className="flex flex-wrap gap-2">
                {getNextActions(detailInspection).map((a) => (
                  <button key={a.status} onClick={() => transitionStatus(detailInspection, a.status)} className="h-8 px-3 rounded-md text-[11px] text-white flex items-center gap-1.5" style={{ background: a.color }}>
                    {a.label}
                  </button>
                ))}
              </div>

              {/* Consultant approval panel */}
              {["in_review", "pending_consultant"].includes(detailInspection.status) && perms.canApproveInspection && (
                <div className="rounded-lg border border-[#222A35] bg-[#0A0E14] p-3 space-y-2">
                  <div className="text-[11px] text-[#8A95A5]">Consultant Decision</div>
                  <textarea value={approvalComment} onChange={(e) => setApprovalComment(e.target.value)} placeholder="Add comments (optional)…" rows={2} className="w-full bg-[#11161D] border border-[#222A35] rounded-md px-3 py-2 text-[12px] text-white focus:outline-none focus:border-[#FF6B1A]" />
                  <div className="flex gap-2">
                    <button onClick={() => submitApproval(detailInspection, "approved")} className="h-8 px-3 rounded-md bg-[#22C55E] text-white text-[11px] flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> Approve</button>
                    <button onClick={() => submitApproval(detailInspection, "rework_required")} className="h-8 px-3 rounded-md bg-[#F97316] text-white text-[11px] flex items-center gap-1"><RotateCcw className="w-3.5 h-3.5" /> Rework</button>
                    <button onClick={() => submitApproval(detailInspection, "rejected")} className="h-8 px-3 rounded-md bg-[#EF4444] text-white text-[11px] flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> Reject</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {lightbox && <ImageLightbox images={lightbox.images} startIndex={lightbox.index} videoUrls={lightbox.videoUrls} onClose={() => setLightbox(null)} />}
    </div>
  );
}
