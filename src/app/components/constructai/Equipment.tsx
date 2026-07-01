import { useState, useEffect, useRef, type ReactNode } from "react";
import { toast } from "sonner";
import { Plus, Search, X, Trash2, Truck, Pencil, Upload, FileText, AlertTriangle, Wrench } from "lucide-react";
import type { Role } from "./roles";
import { ROLES } from "./roles";
import api, { type EquipmentDto, type ProjectDto } from "../../services/api";

// New status set (display nicely via STATUS_LABELS)
const STATUS_COLOR: Record<string, string> = {
  available: "#22C55E",
  in_use: "#3B82F6",
  under_maintenance: "#F5A623",
  out_of_service: "#EF4444",
  hired_out: "#A855F7",
  retired: "#6B7280",
};

const STATUSES = ["available", "in_use", "under_maintenance", "out_of_service", "hired_out", "retired"];
const STATUS_LABELS: Record<string, string> = {
  available: "Available",
  in_use: "In use",
  under_maintenance: "Under maintenance",
  out_of_service: "Out of service",
  hired_out: "Hired out",
  retired: "Retired",
};

const CATEGORIES = ["excavator", "backhoe", "loader", "dozer", "grader", "roller", "crane", "hoist", "concrete_mixer", "generator", "pump", "compressor", "scaffolding", "vehicle", "power_tool", "hand_tool", "other"];
const CATEGORY_LABELS: Record<string, string> = {
  excavator: "Excavator",
  backhoe: "Backhoe",
  loader: "Loader",
  dozer: "Dozer",
  grader: "Grader",
  roller: "Roller / Compactor",
  crane: "Crane",
  hoist: "Hoist",
  concrete_mixer: "Concrete Mixer",
  generator: "Generator",
  pump: "Pump",
  compressor: "Compressor",
  scaffolding: "Scaffolding",
  vehicle: "Vehicle",
  power_tool: "Power Tool",
  hand_tool: "Hand Tool",
  other: "Other",
};

const CONDITIONS = ["new", "good", "fair", "poor"];
const CONDITION_LABELS: Record<string, string> = { new: "New", good: "Good", fair: "Fair", poor: "Poor" };

type DocItem = { name: string; url: string };

type FormState = {
  name: string;
  assetTag: string;
  category: string;
  status: string;
  condition: string;
  serialNumber: string;
  manufacturer: string;
  projectId: string;
  operator: string;
  location: string;
  ownership: string;
  hireVendor: string;
  hireRate: string;
  hireRateUnit: string;
  hireStartDate: string;
  hireEndDate: string;
  purchaseCost: string;
  currentValue: string;
  meterHours: string;
  lastServiceHours: string;
  serviceIntervalHours: string;
  purchaseDate: string;
  lastService: string;
  nextService: string;
  insuranceExpiry: string;
  inspectionExpiry: string;
  photoUrl: string;
  documents: DocItem[];
  notes: string;
};

const EMPTY_FORM: FormState = {
  name: "",
  assetTag: "",
  category: "excavator",
  status: "available",
  condition: "good",
  serialNumber: "",
  manufacturer: "",
  projectId: "",
  operator: "",
  location: "",
  ownership: "owned",
  hireVendor: "",
  hireRate: "",
  hireRateUnit: "day",
  hireStartDate: "",
  hireEndDate: "",
  purchaseCost: "",
  currentValue: "",
  meterHours: "",
  lastServiceHours: "",
  serviceIntervalHours: "",
  purchaseDate: "",
  lastService: "",
  nextService: "",
  insuranceExpiry: "",
  inspectionExpiry: "",
  photoUrl: "",
  documents: [],
  notes: "",
};

// ── helpers ──────────────────────────────────────────────────────────────
const todayStr = () => new Date().toISOString().slice(0, 10);

function parseDocs(raw?: string | null): DocItem[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) return arr.filter((d) => d && d.url).map((d) => ({ name: String(d.name || d.url), url: String(d.url) }));
  } catch { /* not JSON */ }
  return [];
}

// nullable number from string input — empty => undefined (don't send empty strings)
const numOrUndef = (s: string): number | undefined => {
  if (s == null || String(s).trim() === "") return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
};

// service-due logic
function isServiceDue(e: Pick<EquipmentDto, "nextService" | "serviceIntervalHours" | "meterHours" | "lastServiceHours">): boolean {
  const today = todayStr();
  if (e.nextService && e.nextService.slice(0, 10) <= today) return true;
  const interval = e.serviceIntervalHours;
  const meter = e.meterHours;
  const lastH = e.lastServiceHours;
  if (interval != null && interval > 0 && meter != null && lastH != null && meter - lastH >= interval) return true;
  return false;
}

type ExpiryState = "none" | "soon" | "expired";
function expiryState(date?: string | null): ExpiryState {
  if (!date) return "none";
  const d = date.slice(0, 10);
  const today = todayStr();
  if (d < today) return "expired";
  const dt = new Date(d + "T00:00:00");
  const in30 = new Date();
  in30.setDate(in30.getDate() + 30);
  if (dt <= in30) return "soon";
  return "none";
}

export default function Equipment({ role = "Contractor" }: { role?: Role }) {
  const perms = ROLES[role];
  const [equipment, setEquipment] = useState<EquipmentDto[]>([]);
  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [uploadingDocs, setUploadingDocs] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const photoRef = useRef<HTMLInputElement>(null);
  const docsRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.getEquipment().then(setEquipment).catch(() => toast.error("Failed to load equipment"));
    api.getProjects().then(setProjects).catch(() => { /* projects optional */ });
  }, []);

  const projectName = (id?: string | null) => {
    if (!id) return "Company-wide";
    return projects.find((p) => p.id === id)?.name || "Company-wide";
  };

  const filtered = equipment.filter((e) => {
    if (statusFilter !== "All" && e.status !== statusFilter) return false;
    if (q) {
      const hay = `${e.name} ${e.category} ${e.serialNumber || ""} ${e.location || ""} ${e.assetTag || ""} ${e.manufacturer || ""} ${e.operator || ""} ${projectName(e.projectId)}`.toLowerCase();
      if (!hay.includes(q.toLowerCase())) return false;
    }
    return true;
  });

  const serviceDueCount = equipment.filter((e) => isServiceDue(e)).length;

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setShowModal(true);
  };

  const openEdit = (e: EquipmentDto) => {
    setEditingId(e.id);
    setForm({
      name: e.name || "",
      assetTag: e.assetTag || "",
      category: e.category || "excavator",
      status: e.status || "available",
      condition: e.condition || "good",
      serialNumber: e.serialNumber || "",
      manufacturer: e.manufacturer || "",
      projectId: e.projectId || "",
      operator: e.operator || "",
      location: e.location || "",
      ownership: e.ownership || "owned",
      hireVendor: e.hireVendor || "",
      hireRate: e.hireRate != null ? String(e.hireRate) : "",
      hireRateUnit: e.hireRateUnit || "day",
      hireStartDate: e.hireStartDate ? e.hireStartDate.slice(0, 10) : "",
      hireEndDate: e.hireEndDate ? e.hireEndDate.slice(0, 10) : "",
      purchaseCost: e.purchaseCost != null ? String(e.purchaseCost) : "",
      currentValue: e.currentValue != null ? String(e.currentValue) : "",
      meterHours: e.meterHours != null ? String(e.meterHours) : "",
      lastServiceHours: e.lastServiceHours != null ? String(e.lastServiceHours) : "",
      serviceIntervalHours: e.serviceIntervalHours != null ? String(e.serviceIntervalHours) : "",
      purchaseDate: e.purchaseDate ? e.purchaseDate.slice(0, 10) : "",
      lastService: e.lastService ? e.lastService.slice(0, 10) : "",
      nextService: e.nextService ? e.nextService.slice(0, 10) : "",
      insuranceExpiry: e.insuranceExpiry ? e.insuranceExpiry.slice(0, 10) : "",
      inspectionExpiry: e.inspectionExpiry ? e.inspectionExpiry.slice(0, 10) : "",
      photoUrl: e.photoUrl || "",
      documents: parseDocs(e.documents),
      notes: e.notes || "",
    });
    setShowModal(true);
  };

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  // build payload — numbers as numbers, empty number strings omitted, dates as-is
  const buildPayload = (): Partial<EquipmentDto> => ({
    name: form.name.trim(),
    assetTag: form.assetTag.trim() || null,
    category: form.category,
    status: form.status,
    condition: form.condition || null,
    serialNumber: form.serialNumber.trim() || null,
    manufacturer: form.manufacturer.trim() || null,
    projectId: form.projectId || null,
    operator: form.operator.trim() || null,
    location: form.location.trim() || null,
    ownership: form.ownership || null,
    hireVendor: form.ownership === "hired" ? form.hireVendor.trim() || null : null,
    hireRate: form.ownership === "hired" ? numOrUndef(form.hireRate) ?? null : null,
    hireRateUnit: form.ownership === "hired" ? form.hireRateUnit || null : null,
    hireStartDate: form.ownership === "hired" ? form.hireStartDate || null : null,
    hireEndDate: form.ownership === "hired" ? form.hireEndDate || null : null,
    purchaseCost: numOrUndef(form.purchaseCost) ?? null,
    currentValue: numOrUndef(form.currentValue) ?? null,
    meterHours: numOrUndef(form.meterHours) ?? null,
    lastServiceHours: numOrUndef(form.lastServiceHours) ?? null,
    serviceIntervalHours: numOrUndef(form.serviceIntervalHours) ?? null,
    purchaseDate: form.purchaseDate || null,
    lastService: form.lastService || null,
    nextService: form.nextService || null,
    insuranceExpiry: form.insuranceExpiry || null,
    inspectionExpiry: form.inspectionExpiry || null,
    photoUrl: form.photoUrl.trim() || null,
    documents: form.documents.length ? JSON.stringify(form.documents) : null,
    notes: form.notes.trim() || null,
  });

  const saveEquipment = async () => {
    if (!perms.manageTeam) return toast.error(`${role} cannot manage equipment`);
    if (!form.name.trim()) return toast.error("Equipment name required");
    setSaving(true);
    const payload = buildPayload();
    try {
      if (editingId) {
        const row = await api.updateEquipment(editingId, payload);
        setEquipment((prev) => prev.map((e) => (e.id === editingId ? row : e)));
        toast.success("Equipment updated");
      } else {
        const row = await api.createEquipment(payload);
        setEquipment((prev) => [row, ...prev]);
        toast.success("Equipment added");
      }
      setShowModal(false);
      setEditingId(null);
      setForm(EMPTY_FORM);
    } catch {
      // offline fallback (create only) — keeps prior resilient behaviour
      if (!editingId) {
        setEquipment((prev) => [{ ...(payload as EquipmentDto), id: `EQ-${Date.now()}` }, ...prev]);
        setShowModal(false);
        toast.success("Equipment added (offline)");
      } else {
        toast.error("Failed to save equipment");
      }
    } finally {
      setSaving(false);
    }
  };

  const deleteEquipmentItem = async (id: string) => {
    try { await api.deleteEquipment(id); } catch { /* ignore */ }
    setEquipment((prev) => prev.filter((e) => e.id !== id));
    toast.success("Equipment deleted");
  };

  const onPhotoPick = async (file?: File) => {
    if (!file) return;
    setUploadingPhoto(true);
    try {
      const url = await api.uploadFile(file);
      set("photoUrl", url);
      toast.success("Photo uploaded");
    } catch {
      toast.error("Photo upload failed");
    } finally {
      setUploadingPhoto(false);
      if (photoRef.current) photoRef.current.value = "";
    }
  };

  const onDocsPick = async (files?: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploadingDocs(true);
    try {
      const uploaded: DocItem[] = [];
      for (const file of Array.from(files)) {
        const url = await api.uploadFile(file);
        uploaded.push({ name: file.name, url });
      }
      setForm((f) => ({ ...f, documents: [...f.documents, ...uploaded] }));
      toast.success(`${uploaded.length} document${uploaded.length > 1 ? "s" : ""} uploaded`);
    } catch {
      toast.error("Document upload failed");
    } finally {
      setUploadingDocs(false);
      if (docsRef.current) docsRef.current.value = "";
    }
  };

  const removeDoc = (idx: number) => setForm((f) => ({ ...f, documents: f.documents.filter((_, i) => i !== idx) }));

  // live form "service due" hint
  const formServiceDue = isServiceDue({
    nextService: form.nextService || null,
    serviceIntervalHours: numOrUndef(form.serviceIntervalHours) ?? null,
    meterHours: numOrUndef(form.meterHours) ?? null,
    lastServiceHours: numOrUndef(form.lastServiceHours) ?? null,
  });

  // ── shared field styles ──
  const inputCls = "w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-3 text-[12px] text-white placeholder:text-[#5B6675] focus:outline-none focus:border-[#FF6B1A]";
  const selectCls = "w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-[12px] text-white focus:outline-none focus:border-[#FF6B1A]";
  const labelCls = "text-[11px] uppercase text-[#8A95A5] mb-1 block";
  const Section = ({ title, children }: { title: string; children: ReactNode }) => (
    <div className="space-y-3">
      <div className="text-[11px] uppercase tracking-wider text-[#FF6B1A] font-medium border-b border-[#222A35] pb-1">{title}</div>
      {children}
    </div>
  );

  return (
    <div className="px-4 sm:px-7 py-5 sm:py-6 space-y-5">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[13px] text-white font-display"><Truck className="w-4 h-4 text-[#FF6B1A]" /> Equipment Inventory</div>
          <div className="text-[11px] text-[#8A95A5] mt-0.5">Track machinery, fleet, hire, costs, service &amp; compliance</div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#5B6675]" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search equipment…" className="w-[180px] sm:w-[220px] h-9 bg-[#11161D] border border-[#222A35] rounded-md pl-8 pr-3 text-[12px] text-white placeholder:text-[#5B6675] focus:outline-none focus:border-[#FF6B1A]" />
          </div>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-9 bg-[#11161D] border border-[#222A35] rounded-md px-2 text-white text-[12px]">
            <option value="All">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
          </select>
          {perms.manageTeam && (
            <button onClick={openCreate} className="h-9 px-3 rounded-md text-[12px] flex items-center gap-1.5 bg-[#FF6B1A] hover:bg-[#FF7E33] text-white">
              <Plus className="w-3.5 h-3.5" /> Add Equipment
            </button>
          )}
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {STATUSES.map((s) => (
          <div key={s} className="rounded-xl border border-[#222A35] bg-[#11161D] p-3">
            <div className="text-[10px] text-[#5B6675] uppercase tracking-wider truncate">{STATUS_LABELS[s]}</div>
            <div className="text-[18px] text-white font-display mt-1" style={{ color: STATUS_COLOR[s] }}>{equipment.filter((e) => e.status === s).length}</div>
          </div>
        ))}
      </div>
      {serviceDueCount > 0 && (
        <div className="rounded-xl border border-[#EF4444]/40 bg-[#EF4444]/10 p-3 flex items-center gap-2">
          <Wrench className="w-4 h-4 text-[#EF4444]" />
          <span className="text-[12px] text-[#EF4444]">{serviceDueCount} item{serviceDueCount > 1 ? "s" : ""} due for service</span>
        </div>
      )}

      {/* Table — desktop */}
      <div className="hidden sm:block rounded-xl border border-[#222A35] bg-[#11161D] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-[12px]">
            <thead>
              <tr className="text-[10px] text-[#5B6675] uppercase tracking-wider">
                <th className="text-left px-4 py-2.5">Name</th>
                <th className="text-left px-3 py-2.5">Category</th>
                <th className="text-left px-3 py-2.5">Project</th>
                <th className="text-left px-3 py-2.5">Serial #</th>
                <th className="text-left px-3 py-2.5">Status</th>
                <th className="text-left px-3 py-2.5">Last Service</th>
                <th className="text-left px-3 py-2.5">Next Service</th>
                <th className="text-right px-4 py-2.5">Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => {
                const due = isServiceDue(e);
                const ins = expiryState(e.insuranceExpiry);
                const insp = expiryState(e.inspectionExpiry);
                return (
                  <tr key={e.id} className="border-t border-[#222A35] hover:bg-[#161C24]">
                    <td className="px-4 py-2.5">
                      <div className="text-white font-medium">{e.name}</div>
                      <div className="flex flex-wrap items-center gap-1 mt-1">
                        {e.ownership === "hired" && <span className="px-1.5 py-0.5 rounded text-[9px] bg-[#A855F7]/15 text-[#A855F7]">Hired</span>}
                        {due && <span className="px-1.5 py-0.5 rounded text-[9px] bg-[#EF4444]/15 text-[#EF4444]">Service due</span>}
                        {(ins === "expired" || insp === "expired") && <span className="px-1.5 py-0.5 rounded text-[9px] bg-[#EF4444]/15 text-[#EF4444]">{ins === "expired" && insp === "expired" ? "Ins/Insp expired" : ins === "expired" ? "Insurance expired" : "Inspection expired"}</span>}
                        {ins !== "expired" && insp !== "expired" && (ins === "soon" || insp === "soon") && <span className="px-1.5 py-0.5 rounded text-[9px] bg-[#F5A623]/15 text-[#F5A623]">{ins === "soon" && insp === "soon" ? "Ins/Insp expiring" : ins === "soon" ? "Insurance expiring" : "Inspection expiring"}</span>}
                      </div>
                    </td>
                    <td className="px-3 py-2.5"><span className="px-1.5 py-0.5 rounded text-[10px] bg-[#222A35] text-[#8A95A5]">{CATEGORY_LABELS[e.category] || e.category}</span></td>
                    <td className="px-3 py-2.5 text-[#8A95A5]">{projectName(e.projectId)}</td>
                    <td className="px-3 py-2.5 text-[#8A95A5] font-mono text-[11px]">{e.serialNumber || "—"}</td>
                    <td className="px-3 py-2.5"><span className="px-2 py-0.5 rounded-full text-[10px]" style={{ background: (STATUS_COLOR[e.status] || "#5B6675") + "20", color: STATUS_COLOR[e.status] || "#5B6675" }}>{STATUS_LABELS[e.status] || e.status}</span></td>
                    <td className="px-3 py-2.5 text-[#8A95A5]">{e.lastService ? e.lastService.slice(0, 10) : "—"}</td>
                    <td className="px-3 py-2.5 text-[#8A95A5]">{e.nextService ? e.nextService.slice(0, 10) : "—"}</td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {perms.manageTeam && <button onClick={() => openEdit(e)} className="text-[#8A95A5] hover:text-[#FF6B1A]"><Pencil className="w-3.5 h-3.5" /></button>}
                        <button onClick={() => deleteEquipmentItem(e.id)} className="text-[#8A95A5] hover:text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={8} className="text-center py-8 text-[11px] text-[#5B6675]">No equipment found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Cards — phones */}
      <div className="sm:hidden space-y-2">
        {filtered.length === 0 && <div className="text-center py-8 text-[11px] text-[#5B6675] rounded-xl border border-[#222A35] bg-[#11161D]">No equipment found</div>}
        {filtered.map((e) => {
          const due = isServiceDue(e);
          const ins = expiryState(e.insuranceExpiry);
          const insp = expiryState(e.inspectionExpiry);
          return (
            <div key={e.id} className="rounded-xl border border-[#222A35] bg-[#11161D] p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] text-white font-medium truncate">{e.name}</span>
                <span className="px-2 py-0.5 rounded-full text-[10px] shrink-0" style={{ background: (STATUS_COLOR[e.status] || "#5B6675") + "20", color: STATUS_COLOR[e.status] || "#5B6675" }}>{STATUS_LABELS[e.status] || e.status}</span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 mt-2">
                <span className="px-1.5 py-0.5 rounded text-[10px] bg-[#222A35] text-[#8A95A5]">{CATEGORY_LABELS[e.category] || e.category}</span>
                {e.ownership === "hired" && <span className="px-1.5 py-0.5 rounded text-[9px] bg-[#A855F7]/15 text-[#A855F7]">Hired</span>}
                {due && <span className="px-1.5 py-0.5 rounded text-[9px] bg-[#EF4444]/15 text-[#EF4444]">Service due</span>}
                {(ins === "expired" || insp === "expired") && <span className="px-1.5 py-0.5 rounded text-[9px] bg-[#EF4444]/15 text-[#EF4444]">Compliance expired</span>}
                {ins !== "expired" && insp !== "expired" && (ins === "soon" || insp === "soon") && <span className="px-1.5 py-0.5 rounded text-[9px] bg-[#F5A623]/15 text-[#F5A623]">Compliance expiring</span>}
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-[11px] text-[#8A95A5]">
                <span>{projectName(e.projectId)}</span>
                {e.serialNumber && <span className="font-mono">SN: {e.serialNumber}</span>}
                <span>Next: {e.nextService ? e.nextService.slice(0, 10) : "—"}</span>
              </div>
              <div className="flex justify-end gap-3 mt-2 pt-2 border-t border-[#222A35]">
                {perms.manageTeam && <button onClick={() => openEdit(e)} className="text-[11px] text-[#8A95A5] hover:text-[#FF6B1A] flex items-center gap-1"><Pencil className="w-3.5 h-3.5" /> Edit</button>}
                <button onClick={() => deleteEquipmentItem(e.id)} className="text-[11px] text-[#8A95A5] hover:text-red-400 flex items-center gap-1"><Trash2 className="w-3.5 h-3.5" /> Delete</button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Modal — Add / Edit */}
      {showModal && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => setShowModal(false)}>
          <div className="bg-[#11161D] border border-[#222A35] rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div className="text-[14px] text-white font-display">{editingId ? "Edit Equipment" : "Add Equipment"}</div>
              <button onClick={() => setShowModal(false)} className="text-[#8A95A5] hover:text-white"><X className="w-4 h-4" /></button>
            </div>

            <div className="space-y-5">
              {/* 1. Details */}
              <Section title="Details">
                <div>
                  <label className={labelCls}>Name <span className="text-[#FF6B1A]">*</span></label>
                  <input value={form.name} onChange={(e) => set("name", e.target.value)} className={inputCls} placeholder="e.g. CAT 320 Excavator" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>Asset / fleet no.</label>
                    <input value={form.assetTag} onChange={(e) => set("assetTag", e.target.value)} className={inputCls} placeholder="e.g. FL-014" />
                  </div>
                  <div>
                    <label className={labelCls}>Category</label>
                    <select value={form.category} onChange={(e) => set("category", e.target.value)} className={selectCls}>
                      {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>Status</label>
                    <select value={form.status} onChange={(e) => set("status", e.target.value)} className={selectCls}>
                      {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Condition</label>
                    <select value={form.condition} onChange={(e) => set("condition", e.target.value)} className={selectCls}>
                      {CONDITIONS.map((c) => <option key={c} value={c}>{CONDITION_LABELS[c]}</option>)}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>Serial number</label>
                    <input value={form.serialNumber} onChange={(e) => set("serialNumber", e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Manufacturer</label>
                    <input value={form.manufacturer} onChange={(e) => set("manufacturer", e.target.value)} className={inputCls} />
                  </div>
                </div>
              </Section>

              {/* 2. Assignment */}
              <Section title="Assignment">
                <div>
                  <label className={labelCls}>Project</label>
                  <select value={form.projectId} onChange={(e) => set("projectId", e.target.value)} className={selectCls}>
                    <option value="">Company-wide</option>
                    {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>Operator / crew</label>
                    <input value={form.operator} onChange={(e) => set("operator", e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Location</label>
                    <input value={form.location} onChange={(e) => set("location", e.target.value)} className={inputCls} />
                  </div>
                </div>
              </Section>

              {/* 3. Ownership & hire */}
              <Section title="Ownership & hire">
                <div>
                  <label className={labelCls}>Ownership</label>
                  <select value={form.ownership} onChange={(e) => set("ownership", e.target.value)} className={selectCls}>
                    <option value="owned">Owned</option>
                    <option value="hired">Hired</option>
                  </select>
                </div>
                {form.ownership === "hired" && (
                  <>
                    <div>
                      <label className={labelCls}>Hire company</label>
                      <input value={form.hireVendor} onChange={(e) => set("hireVendor", e.target.value)} className={inputCls} />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className={labelCls}>Hire rate (KES)</label>
                        <input type="number" value={form.hireRate} onChange={(e) => set("hireRate", e.target.value)} className={inputCls} placeholder="0" />
                      </div>
                      <div>
                        <label className={labelCls}>Rate unit</label>
                        <select value={form.hireRateUnit} onChange={(e) => set("hireRateUnit", e.target.value)} className={selectCls}>
                          <option value="day">Per day</option>
                          <option value="week">Per week</option>
                          <option value="month">Per month</option>
                        </select>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className={labelCls}>Hire start</label>
                        <input type="date" value={form.hireStartDate} onChange={(e) => set("hireStartDate", e.target.value)} className={inputCls} />
                      </div>
                      <div>
                        <label className={labelCls}>Return date</label>
                        <input type="date" value={form.hireEndDate} onChange={(e) => set("hireEndDate", e.target.value)} className={inputCls} />
                      </div>
                    </div>
                  </>
                )}
              </Section>

              {/* 4. Costs & service */}
              <Section title="Costs & service">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>Purchase cost (KES)</label>
                    <input type="number" value={form.purchaseCost} onChange={(e) => set("purchaseCost", e.target.value)} className={inputCls} placeholder="0" />
                  </div>
                  <div>
                    <label className={labelCls}>Current value (KES)</label>
                    <input type="number" value={form.currentValue} onChange={(e) => set("currentValue", e.target.value)} className={inputCls} placeholder="0" />
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <div>
                    <label className={labelCls}>Hour-meter</label>
                    <input type="number" value={form.meterHours} onChange={(e) => set("meterHours", e.target.value)} className={inputCls} placeholder="hrs" />
                  </div>
                  <div>
                    <label className={labelCls}>Last service hrs</label>
                    <input type="number" value={form.lastServiceHours} onChange={(e) => set("lastServiceHours", e.target.value)} className={inputCls} placeholder="hrs" />
                  </div>
                  <div>
                    <label className={labelCls}>Interval hrs</label>
                    <input type="number" value={form.serviceIntervalHours} onChange={(e) => set("serviceIntervalHours", e.target.value)} className={inputCls} placeholder="hrs" />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>Last service</label>
                    <input type="date" value={form.lastService} onChange={(e) => set("lastService", e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Next service</label>
                    <input type="date" value={form.nextService} onChange={(e) => set("nextService", e.target.value)} className={inputCls} />
                  </div>
                </div>
                <div>
                  <label className={labelCls}>Purchase date</label>
                  <input type="date" value={form.purchaseDate} onChange={(e) => set("purchaseDate", e.target.value)} className={inputCls} />
                </div>
                {formServiceDue && (
                  <div className="flex items-center gap-2 text-[12px] text-[#EF4444] bg-[#EF4444]/10 border border-[#EF4444]/30 rounded-md px-3 py-2">
                    <Wrench className="w-3.5 h-3.5" /> Service is due for this equipment.
                  </div>
                )}
              </Section>

              {/* 5. Compliance & docs */}
              <Section title="Compliance & docs">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>Insurance expiry</label>
                    <input type="date" value={form.insuranceExpiry} onChange={(e) => set("insuranceExpiry", e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Inspection expiry</label>
                    <input type="date" value={form.inspectionExpiry} onChange={(e) => set("inspectionExpiry", e.target.value)} className={inputCls} />
                  </div>
                </div>
                {(expiryState(form.insuranceExpiry) !== "none" || expiryState(form.inspectionExpiry) !== "none") && (
                  <div className="flex items-center gap-2 text-[11px] text-[#F5A623]">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    {expiryState(form.insuranceExpiry) === "expired" || expiryState(form.inspectionExpiry) === "expired" ? "A compliance date has expired." : "A compliance date is expiring within 30 days."}
                  </div>
                )}

                {/* Photo */}
                <div>
                  <label className={labelCls}>Photo</label>
                  <div className="flex items-center gap-3">
                    {form.photoUrl ? (
                      <div className="relative">
                        <img src={form.photoUrl} alt="equipment" className="w-16 h-16 object-cover rounded-md border border-[#222A35]" />
                        <button type="button" onClick={() => set("photoUrl", "")} className="absolute -top-1.5 -right-1.5 bg-[#0A0E14] border border-[#222A35] rounded-full p-0.5 text-[#8A95A5] hover:text-red-400"><X className="w-3 h-3" /></button>
                      </div>
                    ) : (
                      <div className="w-16 h-16 rounded-md border border-dashed border-[#222A35] flex items-center justify-center text-[#5B6675]"><Truck className="w-5 h-5" /></div>
                    )}
                    <button type="button" onClick={() => photoRef.current?.click()} disabled={uploadingPhoto} className="h-9 px-3 rounded-md border border-[#222A35] text-[12px] text-[#8A95A5] hover:text-white hover:border-[#FF6B1A] flex items-center gap-1.5 disabled:opacity-50">
                      <Upload className="w-3.5 h-3.5" /> {uploadingPhoto ? "Uploading…" : "Upload photo"}
                    </button>
                    <input ref={photoRef} type="file" accept="image/*" className="hidden" onChange={(e) => onPhotoPick(e.target.files?.[0])} />
                  </div>
                </div>

                {/* Documents */}
                <div>
                  <label className={labelCls}>Documents</label>
                  <button type="button" onClick={() => docsRef.current?.click()} disabled={uploadingDocs} className="h-9 px-3 rounded-md border border-[#222A35] text-[12px] text-[#8A95A5] hover:text-white hover:border-[#FF6B1A] flex items-center gap-1.5 disabled:opacity-50">
                    <Upload className="w-3.5 h-3.5" /> {uploadingDocs ? "Uploading…" : "Upload documents"}
                  </button>
                  <input ref={docsRef} type="file" multiple className="hidden" onChange={(e) => onDocsPick(e.target.files)} />
                  {form.documents.length > 0 && (
                    <div className="mt-2 space-y-1.5">
                      {form.documents.map((d, i) => (
                        <div key={i} className="flex items-center justify-between gap-2 bg-[#0A0E14] border border-[#222A35] rounded-md px-2.5 py-1.5">
                          <a href={d.url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-[11px] text-[#8A95A5] hover:text-[#FF6B1A] truncate">
                            <FileText className="w-3.5 h-3.5 shrink-0" /> <span className="truncate">{d.name}</span>
                          </a>
                          <button type="button" onClick={() => removeDoc(i)} className="text-[#8A95A5] hover:text-red-400 shrink-0"><X className="w-3.5 h-3.5" /></button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </Section>

              {/* 6. Notes */}
              <Section title="Notes">
                <textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={3} className="w-full bg-[#0A0E14] border border-[#222A35] rounded-md px-3 py-2 text-[12px] text-white placeholder:text-[#5B6675] focus:outline-none focus:border-[#FF6B1A]" placeholder="Any additional notes…" />
              </Section>
            </div>

            <div className="flex items-center justify-end gap-2 mt-5 pt-4 border-t border-[#222A35]">
              <button onClick={() => setShowModal(false)} className="h-9 px-3 rounded-md border border-[#222A35] text-[12px] text-[#8A95A5] hover:text-white">Cancel</button>
              <button onClick={saveEquipment} disabled={saving} className="h-9 px-4 rounded-md bg-[#FF6B1A] hover:bg-[#FF7E33] text-white text-[12px] flex items-center gap-1.5 disabled:opacity-50">
                {editingId ? <Pencil className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}{saving ? "Saving…" : editingId ? "Save changes" : "Add"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
