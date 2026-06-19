import { useState, useRef, useEffect } from "react";
import { toast } from "sonner";
import {
  FileDigit, Plus, Search, ClipboardList, FileText, Clock, X, Trash2, Download,
  Send, Camera, PenTool, Share2, Bookmark, UserCheck, Users, CheckCircle,
  CalendarDays, ChevronRight, LayoutTemplate, Upload, ListChecks
} from "lucide-react";
import type { Role } from "./roles";
import { api } from "../../services/api";
import type { ChecklistDto, FormTemplateDto, ChecklistTemplateDto } from "../../services/api";

const fieldToQuestionType = (t: string) => {
  if (t === "checkbox") return "yes_no";
  if (t === "select") return "dropdown";
  return t;
};

const PROJECTS = ["Harborfront Tower", "Midtown Medical", "Riverside Plaza", "Sunset Logistics", "Cedar Heights"];
const USERS = ["Sarah Patel", "Mike Chen", "James Omondi", "Aisha Hassan", "Tom Bradley"];

type Field = { label: string; type: "text" | "number" | "date" | "checkbox" | "select" | "photo"; options?: string; required?: boolean };
type LocalTemplate = { id: string; title: string; category: string; description: string; fields: Field[] };
type Submission = { id: string; templateId: string; templateTitle: string; project: string; submittedAt: string; status: "draft" | "submitted" | "approved"; answers: Record<string, string> };
type ClTemplateItem = { label: string; type: "yes_no" | "number" | "text" | "photo"; required?: boolean };
type LocalChecklistTemplate = { id: string; title: string; trade: string; items: ClTemplateItem[] };

const CATEGORIES = ["All", "checklist", "daily-report", "timesheet", "rfi", "safety", "custom"];
const CATEGORY_LABELS: Record<string, string> = { checklist: "Checklist", "daily-report": "Daily Report", timesheet: "Timesheet", rfi: "RFI", safety: "Safety", custom: "Custom" };
const TRADES = ["General", "Electrical", "Plumbing", "HVAC", "Carpentry", "Painting", "Masonry", "Roofing", "Drywall", "Concrete", "Landscaping", "Structural"];

const SYSTEM_CHECKLIST_TEMPLATES: LocalChecklistTemplate[] = [
  { id: "sys-cl-1", title: "Site Safety Walkthrough", trade: "General", items: [
    { label: "PPE worn by all personnel", type: "yes_no", required: true },
    { label: "Hard hats, hi-vis vests, safety boots verified", type: "yes_no", required: true },
    { label: "Emergency exits clear and accessible", type: "yes_no", required: true },
    { label: "First aid kit stocked and accessible", type: "yes_no", required: true },
    { label: "Fire extinguishers present and charged", type: "yes_no", required: true },
    { label: "Site perimeter fencing secure", type: "yes_no", required: false },
    { label: "Toolbox talk conducted today", type: "yes_no", required: true },
    { label: "Hazards observed", type: "text", required: false },
    { label: "Safety walkthrough photo", type: "photo", required: false },
  ]},
  { id: "sys-cl-2", title: "Scaffold Inspection", trade: "General", items: [
    { label: "Scaffold erected by competent person", type: "yes_no", required: true },
    { label: "Green tag present and valid", type: "yes_no", required: true },
    { label: "Base plates on firm ground", type: "yes_no", required: true },
    { label: "Guardrails and mid-rails installed", type: "yes_no", required: true },
    { label: "Toe boards in place", type: "yes_no", required: true },
    { label: "Access ladder secure", type: "yes_no", required: true },
    { label: "Maximum load capacity posted", type: "yes_no", required: false },
    { label: "Inspection photo", type: "photo", required: false },
  ]},
  { id: "sys-cl-3", title: "Concrete Pour Pre-Check", trade: "Concrete", items: [
    { label: "Formwork inspected and approved", type: "yes_no", required: true },
    { label: "Rebar placement matches drawings", type: "yes_no", required: true },
    { label: "Concrete cover checked (25-50mm)", type: "yes_no", required: true },
    { label: "Slump test result recorded", type: "number", required: true },
    { label: "Concrete temperature at discharge", type: "number", required: true },
    { label: "Pour location confirmed", type: "text", required: true },
    { label: "Weather conditions suitable", type: "yes_no", required: true },
    { label: "Cube samples prepared", type: "yes_no", required: true },
    { label: "Pour commencement photo", type: "photo", required: false },
  ]},
  { id: "sys-cl-4", title: "Electrical Installation QA", trade: "Electrical", items: [
    { label: "Cable routing secured in trunking", type: "yes_no", required: true },
    { label: "Earth continuity test (< 1 Ohm)", type: "number", required: true },
    { label: "Insulation resistance test (> 1 MOhm)", type: "number", required: true },
    { label: "Breaker labels match as-built", type: "yes_no", required: true },
    { label: "All circuits energised safely", type: "yes_no", required: true },
    { label: "RCD tested and functional", type: "yes_no", required: true },
    { label: "Cable glanding and sealing verified", type: "yes_no", required: true },
    { label: "Installation photo", type: "photo", required: false },
  ]},
  { id: "sys-cl-5", title: "Plumbing Pressure Test", trade: "Plumbing", items: [
    { label: "Hydrostatic test at 1.5x WP for 30 min", type: "number", required: true },
    { label: "Zero pressure drop recorded", type: "yes_no", required: true },
    { label: "Drain slope min 1/4 in per ft", type: "yes_no", required: true },
    { label: "Isolation valves tagged", type: "yes_no", required: true },
    { label: "Leak inspection — no visible leaks", type: "yes_no", required: true },
    { label: "Approved sealants used", type: "yes_no", required: true },
    { label: "Test witness signature obtained", type: "yes_no", required: false },
    { label: "Test setup photo", type: "photo", required: false },
  ]},
  { id: "sys-cl-6", title: "HVAC Commissioning", trade: "HVAC", items: [
    { label: "Duct leakage test per SMACNA", type: "number", required: true },
    { label: "Airflow measured at each diffuser", type: "number", required: true },
    { label: "Filter direction arrows aligned", type: "yes_no", required: true },
    { label: "Condensate drainage verified", type: "yes_no", required: true },
    { label: "Vibration isolation checked", type: "yes_no", required: true },
    { label: "Controls calibrated", type: "yes_no", required: true },
    { label: "Commissioning photo", type: "photo", required: false },
  ]},
  { id: "sys-cl-7", title: "Masonry Quality Check", trade: "Masonry", items: [
    { label: "Block strength >= 7 MPa verified", type: "yes_no", required: true },
    { label: "Mortar ratio recorded", type: "text", required: true },
    { label: "Bond pattern matches drawings", type: "yes_no", required: true },
    { label: "Walls plumb and courses level", type: "yes_no", required: true },
    { label: "Damp-proof course installed", type: "yes_no", required: true },
    { label: "Joint thickness consistent", type: "yes_no", required: false },
    { label: "Quality check photo", type: "photo", required: false },
  ]},
  { id: "sys-cl-8", title: "Roofing Waterproofing", trade: "Roofing", items: [
    { label: "Deck dry, clean, and sound", type: "yes_no", required: true },
    { label: "Membrane overlap >= 100mm", type: "number", required: true },
    { label: "Fastener spacing per specification", type: "number", required: true },
    { label: "Flashing integrity at edges/penetrations", type: "yes_no", required: true },
    { label: "Slope drainage verified", type: "yes_no", required: true },
    { label: "Water ponding test passed", type: "yes_no", required: true },
    { label: "Waterproofing photo", type: "photo", required: false },
  ]},
  { id: "sys-cl-9", title: "Fire Safety Systems", trade: "General", items: [
    { label: "Smoke detectors installed and tested", type: "yes_no", required: true },
    { label: "Sprinkler heads unobstructed", type: "yes_no", required: true },
    { label: "Fire alarm pull stations accessible", type: "yes_no", required: true },
    { label: "Exit signs illuminated", type: "yes_no", required: true },
    { label: "Emergency lighting functional", type: "yes_no", required: true },
    { label: "Fire door seals intact", type: "yes_no", required: true },
    { label: "System test certificate available", type: "yes_no", required: false },
    { label: "Fire safety photo", type: "photo", required: false },
  ]},
  { id: "sys-cl-10", title: "Material Receiving Inspection", trade: "General", items: [
    { label: "Delivery note matches PO", type: "yes_no", required: true },
    { label: "Material grade/certificate verified", type: "yes_no", required: true },
    { label: "Quantity matches delivery note", type: "yes_no", required: true },
    { label: "No visible damage on arrival", type: "yes_no", required: true },
    { label: "Storage location suitable", type: "yes_no", required: true },
    { label: "Material tag/label applied", type: "yes_no", required: false },
    { label: "Receiving photo", type: "photo", required: false },
  ]},
  { id: "sys-cl-11", title: "Structural Steel Bolt Check", trade: "Structural", items: [
    { label: "Bolt grade matches specification", type: "yes_no", required: true },
    { label: "Torque wrench calibrated", type: "yes_no", required: true },
    { label: "Bolt tension verified", type: "number", required: true },
    { label: "All bolt holes aligned", type: "yes_no", required: true },
    { label: "Anti-corrosion coating applied", type: "yes_no", required: true },
    { label: "Welding inspection passed", type: "yes_no", required: true },
    { label: "Bolt check photo", type: "photo", required: false },
  ]},
  { id: "sys-cl-12", title: "Drywall Finishing QA", trade: "Drywall", items: [
    { label: "Stud spacing 400/600mm centers", type: "number", required: true },
    { label: "Screw spacing correct", type: "yes_no", required: true },
    { label: "Board level within 2mm over 2m", type: "number", required: true },
    { label: "Joint finish smooth and feathered", type: "yes_no", required: true },
    { label: "Corner beads straight", type: "yes_no", required: true },
    { label: "No visible cracks or voids", type: "yes_no", required: true },
    { label: "Finishing photo", type: "photo", required: false },
  ]},
];

const INITIAL_TEMPLATES: LocalTemplate[] = [
  { id: "ft-1", title: "Daily Safety Checklist", category: "safety", description: "Jobsite safety walkthrough with PPE, hazards, and incident checks.", fields: [
    { label: "Inspector Name", type: "text", required: true },
    { label: "Date", type: "date", required: true },
    { label: "PPE compliance", type: "checkbox", required: false },
    { label: "Hazards observed", type: "text", required: false },
    { label: "Site photo", type: "photo", required: false },
  ]},
  { id: "ft-2", title: "Concrete Pour Daily Report", category: "daily-report", description: "Track concrete pour quantities, crew, weather, and test cylinders.", fields: [
    { label: "Pour Location", type: "text", required: true },
    { label: "Volume (m³)", type: "number", required: true },
    { label: "Weather", type: "select", options: "Sunny,Cloudy,Rainy,Windy", required: true },
    { label: "Test cylinders taken", type: "checkbox", required: false },
  ]},
  { id: "ft-3", title: "Worker Timesheet", category: "timesheet", description: "Log hours by worker, trade, and cost code.", fields: [
    { label: "Worker Name", type: "text", required: true },
    { label: "Trade", type: "select", options: "Carpenter,Electrician,Plumber,Mason,General", required: true },
    { label: "Date", type: "date", required: true },
    { label: "Hours", type: "number", required: true },
    { label: "Overtime", type: "checkbox", required: false },
  ]},
  { id: "ft-4", title: "RFI — Design Clarification", category: "rfi", description: "Request for information on design drawings or specs.", fields: [
    { label: "Drawing Ref", type: "text", required: true },
    { label: "Question", type: "text", required: true },
    { label: "Suggested Solution", type: "text", required: false },
    { label: "Impact on schedule", type: "select", options: "None,Minor,Moderate,Major", required: true },
  ]},
];

export function DigitizedForms({ role }: { role: Role }) {
  const [templates, setTemplates] = useState<LocalTemplate[]>(INITIAL_TEMPLATES);
  const [backendTemplates, setBackendTemplates] = useState<FormTemplateDto[]>([]);
  const [checklists, setChecklists] = useState<ChecklistDto[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("All");
  const [activeTab, setActiveTab] = useState<"templates" | "checklist-templates" | "checklists" | "submissions">("templates");
  const [loading, setLoading] = useState(false);

  const [showNew, setShowNew] = useState(false);
  const [showFill, setShowFill] = useState<LocalTemplate | null>(null);
  const [showShare, setShowShare] = useState<LocalTemplate | null>(null);
  const [showSaveChecklist, setShowSaveChecklist] = useState<LocalTemplate | null>(null);

  const [newForm, setNewForm] = useState<Partial<LocalTemplate>>({ category: "custom", fields: [] });
  const [fillAnswers, setFillAnswers] = useState<Record<string, string>>({});
  const [fillProject, setFillProject] = useState(PROJECTS[0]);
  const photoRef = useRef<HTMLInputElement>(null);
  const [pendingPhotoField, setPendingPhotoField] = useState("");

  const [shareUser, setShareUser] = useState("");
  const [assignee, setAssignee] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [saveProject, setSaveProject] = useState(PROJECTS[0]);

  // Checklist template state
  const [backendClTemplates, setBackendClTemplates] = useState<ChecklistTemplateDto[]>([]);
  const [clQ, setClQ] = useState("");
  const [clTrade, setClTrade] = useState("All");
  const [showNewClTemplate, setShowNewClTemplate] = useState(false);
  const [showUseClTemplate, setShowUseClTemplate] = useState<LocalChecklistTemplate | null>(null);
  const [newClTemplate, setNewClTemplate] = useState<Partial<LocalChecklistTemplate>>({ trade: "General", items: [] });
  const [useClAssignee, setUseClAssignee] = useState("");
  const [useClProject, setUseClProject] = useState(PROJECTS[0]);
  const [useClDueDate, setUseClDueDate] = useState("");
  const [importJson, setImportJson] = useState("");

  const isOwner = role === "Owner" || role === "Contractor";

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      try {
        const [ftRes, clRes, cltRes] = await Promise.all([
          api.getFormTemplates().catch(() => [] as FormTemplateDto[]),
          api.getChecklists().catch(() => [] as ChecklistDto[]),
          api.getChecklistTemplates().catch(() => [] as ChecklistTemplateDto[]),
        ]);
        if (!mounted) return;
        setBackendTemplates(ftRes);
        setChecklists(clRes);
        setBackendClTemplates(cltRes);
      } catch { /* silent */ }
      setLoading(false);
    })();
    return () => { mounted = false };
  }, []);

  const allTemplates: LocalTemplate[] = [
    ...backendTemplates.map((b) => {
      let fields: Field[] = [];
      try { fields = JSON.parse(b.fields || "[]"); } catch { fields = []; }
      return { id: b.id, title: b.name, category: b.category || "custom", description: b.description || "", fields };
    }),
    ...templates,
  ];

  const filteredTemplates = allTemplates.filter((t) => {
    if (cat !== "All" && t.category !== cat) return false;
    if (q && !t.title.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });

  const addField = () => setNewForm((prev) => ({ ...prev, fields: [...(prev.fields || []), { label: "", type: "text" as const }] }));
  const removeField = (idx: number) => setNewForm((prev) => ({ ...prev, fields: (prev.fields || []).filter((_, i) => i !== idx) }));
  const updateField = (idx: number, patch: Partial<Field>) => {
    setNewForm((prev) => { const fields = [...(prev.fields || [])]; fields[idx] = { ...fields[idx], ...patch }; return { ...prev, fields }; });
  };

  const createTemplate = async () => {
    if (!newForm.title?.trim()) return toast.error("Title is required");
    const t: LocalTemplate = { id: "ft-" + Date.now(), title: newForm.title!, category: (newForm.category as any) || "custom", description: newForm.description || "", fields: (newForm.fields || []).filter((f) => f.label.trim()) };
    setTemplates((prev) => [t, ...prev]);
    setNewForm({ category: "custom", fields: [] });
    setShowNew(false);
    try {
      await api.createFormTemplate({ name: t.title, description: t.description, category: t.category, fields: JSON.stringify(t.fields), source: "manual" });
    } catch { /* local-only ok */ }
    toast.success("Form template created");
  };

  const deleteTemplate = (id: string) => {
    setTemplates((prev) => prev.filter((t) => t.id !== id));
    setBackendTemplates((prev) => prev.filter((t) => t.id !== id));
    toast.success("Template deleted");
  };

  const openFill = (t: LocalTemplate) => { setFillAnswers({}); setFillProject(PROJECTS[0]); setShowFill(t); };

  const submitFill = () => {
    if (!showFill) return;
    setSubmissions((prev) => [...prev, { id: "sub-" + Date.now(), templateId: showFill.id, templateTitle: showFill.title, project: fillProject, submittedAt: new Date().toLocaleString(), status: "submitted", answers: { ...fillAnswers } }]);
    setShowFill(null);
    toast.success("Form submitted");
  };

  const shareTemplate = () => {
    if (!showShare || !shareUser) return;
    toast.success("Shared " + showShare.title + " with " + shareUser);
    setShowShare(null); setShareUser("");
  };

  const saveAsChecklist = async () => {
    if (!showSaveChecklist) return;
    if (!assignee) return toast.error("Select an assignee");
    const questions = showSaveChecklist.fields.map((f, i) => ({
      question: f.label,
      questionType: fieldToQuestionType(f.type),
      required: !!f.required,
      position: i,
      options: f.type === "select" ? (f.options || "").split(",").map((s) => s.trim()).join(",") : undefined,
    }));
    try {
      const row = await api.createChecklist({
        title: showSaveChecklist.title,
        description: showSaveChecklist.description,
        category: showSaveChecklist.category,
        source: "manual",
        questions,
        assignee,
        templateId: showSaveChecklist.id,
        dueDate: dueDate || undefined,
        projectId: saveProject || undefined,
      });
      setChecklists((prev) => [row, ...prev]);
      toast.success("Saved as checklist and assigned to " + assignee);
    } catch {
      toast.success("Saved as checklist (offline mode)");
    }
    setShowSaveChecklist(null); setAssignee(""); setDueDate("");
  };

  const toggleChecklistAssigned = async (cl: ChecklistDto) => {
    try {
      const updated = await api.updateChecklist(cl.id, { assigned: !cl.assigned });
      setChecklists((prev) => prev.map((c) => c.id === cl.id ? updated : c));
    } catch {
      setChecklists((prev) => prev.map((c) => c.id === cl.id ? { ...c, assigned: !c.assigned } : c));
    }
  };

  // Checklist template helpers
  const allClTemplates: LocalChecklistTemplate[] = [
    ...SYSTEM_CHECKLIST_TEMPLATES,
    ...backendClTemplates.map((b) => {
      let items: ClTemplateItem[] = [];
      try { items = JSON.parse(b.items || "[]"); } catch { items = []; }
      return { id: b.id, title: b.title, trade: b.trade || "General", items };
    }),
  ];

  const filteredClTemplates = allClTemplates.filter((t) => {
    if (clTrade !== "All" && t.trade !== clTrade) return false;
    if (clQ && !t.title.toLowerCase().includes(clQ.toLowerCase())) return false;
    return true;
  });

  const addClItem = () => setNewClTemplate((prev) => ({ ...prev, items: [...(prev.items || []), { label: "", type: "yes_no" as const, required: false }] }));
  const removeClItem = (idx: number) => setNewClTemplate((prev) => ({ ...prev, items: (prev.items || []).filter((_, i) => i !== idx) }));
  const updateClItem = (idx: number, patch: Partial<ClTemplateItem>) => {
    setNewClTemplate((prev) => { const items = [...(prev.items || [])]; items[idx] = { ...items[idx], ...patch }; return { ...prev, items }; });
  };

  const createClTemplate = async () => {
    if (!newClTemplate.title?.trim()) return toast.error("Title is required");
    const t: LocalChecklistTemplate = { id: "clt-" + Date.now(), title: newClTemplate.title!, trade: (newClTemplate.trade as any) || "General", items: (newClTemplate.items || []).filter((f) => f.label.trim()) };
    try {
      await api.createChecklistTemplate({ title: t.title, trade: t.trade, items: JSON.stringify(t.items) });
      const refreshed = await api.getChecklistTemplates().catch(() => [] as ChecklistTemplateDto[]);
      setBackendClTemplates(refreshed);
    } catch {
      toast.error("Failed to save to server — saved locally only");
    }
    setNewClTemplate({ trade: "General", items: [] });
    setShowNewClTemplate(false);
    toast.success("Checklist template created");
  };

  const importClTemplates = () => {
    if (!importJson.trim()) return toast.error("Paste JSON first");
    try {
      const parsed = JSON.parse(importJson.trim());
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      let created = 0;
      for (const item of arr) {
        if (!item.title || !Array.isArray(item.items)) continue;
        const t: LocalChecklistTemplate = {
          id: "clt-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6),
          title: String(item.title),
          trade: String(item.trade || "General"),
          items: item.items.map((it: any) => ({ label: String(it.label || ""), type: ["yes_no", "number", "text", "photo"].includes(it.type) ? it.type : "yes_no", required: !!it.required })),
        };
        api.createChecklistTemplate({ title: t.title, trade: t.trade, items: JSON.stringify(t.items) }).catch(() => {});
        created++;
      }
      toast.success(`${created} checklist template(s) imported`);
      setImportJson("");
      setTimeout(() => {
        api.getChecklistTemplates().then(setBackendClTemplates).catch(() => {});
      }, 500);
    } catch {
      toast.error("Invalid JSON format");
    }
  };

  const deleteClTemplate = async (id: string) => {
    const isSystem = id.startsWith("sys-");
    if (isSystem) { toast.error("System templates cannot be deleted"); return; }
    try {
      await api.deleteChecklistTemplate(id);
      setBackendClTemplates((prev) => prev.filter((t) => t.id !== id));
      toast.success("Template deleted");
    } catch {
      toast.error("Failed to delete template");
    }
  };

  const useClTemplate = async () => {
    if (!showUseClTemplate) return;
    if (!useClAssignee) return toast.error("Select an assignee");
    const questions = showUseClTemplate.items.map((f, i) => ({
      question: f.label,
      questionType: f.type,
      required: !!f.required,
      position: i,
      options: undefined as string | undefined,
    }));
    try {
      const row = await api.createChecklist({
        title: showUseClTemplate.title,
        category: showUseClTemplate.trade,
        source: "template",
        questions,
        assignee: useClAssignee,
        templateId: showUseClTemplate.id,
        dueDate: useClDueDate || undefined,
        projectId: useClProject || undefined,
      });
      setChecklists((prev) => [row, ...prev]);
      toast.success(`Checklist "${showUseClTemplate.title}" created and assigned to ${useClAssignee}`);
    } catch {
      toast.success("Checklist created (offline mode)");
    }
    setShowUseClTemplate(null); setUseClAssignee(""); setUseClDueDate("");
  };

  return (
    <div className="px-4 sm:px-7 py-5 sm:py-6 space-y-5">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[13px] text-white font-display"><FileDigit className="w-4 h-4 text-[#FF6B1A]" /> Digitized Forms</div>
          <div className="text-[11px] text-[#8A95A5] mt-0.5">Create templates, share with team, save as checklists, and assign to workers</div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {activeTab === "templates" && (
            <div className="relative"><Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#5B6675]" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search templates…" className="w-[180px] sm:w-[220px] h-9 bg-[#11161D] border border-[#222A35] rounded-md pl-8 pr-3 text-[12px] text-white placeholder:text-[#5B6675] focus:outline-none focus:border-[#FF6B1A]" />
            </div>
          )}
          {activeTab === "checklist-templates" && (
            <div className="relative"><Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#5B6675]" />
              <input value={clQ} onChange={(e) => setClQ(e.target.value)} placeholder="Search checklist templates…" className="w-[180px] sm:w-[220px] h-9 bg-[#11161D] border border-[#222A35] rounded-md pl-8 pr-3 text-[12px] text-white placeholder:text-[#5B6675] focus:outline-none focus:border-[#FF6B1A]" />
            </div>
          )}
          {activeTab === "templates" && <button onClick={() => setShowNew(true)} className="h-9 px-3 rounded-md bg-[#FF6B1A] text-white text-[12px] flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" /> New Template</button>}
          {activeTab === "checklist-templates" && isOwner && (
            <button onClick={() => setShowNewClTemplate(true)} className="h-9 px-3 rounded-md bg-[#FF6B1A] text-white text-[12px] flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" /> Add Template</button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-[#222A35]">
        {(["templates", "checklist-templates", "checklists", "submissions"] as const).map((t) => (
          <button key={t} onClick={() => setActiveTab(t)} className={`px-3 h-9 text-[12px] border-b-2 transition ${activeTab === t ? "text-[#FF6B1A] border-[#FF6B1A]" : "text-[#8A95A5] border-transparent hover:text-white"}`}>
            {t === "templates" ? "Form Templates" : t === "checklist-templates" ? "Checklist Templates" : t === "checklists" ? "Checklists" : "Submissions"}
            {" "}
            {t === "templates" ? `(${filteredTemplates.length})` : t === "checklist-templates" ? `(${filteredClTemplates.length})` : t === "checklists" ? `(${checklists.length})` : `(${submissions.length})`}
          </button>
        ))}
      </div>

      {/* Templates tab */}
      {activeTab === "templates" && (
        <>
          <div className="flex gap-1.5 overflow-x-auto -mx-1 px-1">
            {CATEGORIES.map((c) => (
              <button key={c} onClick={() => setCat(c)} className={`px-3 h-8 rounded-md text-[11px] whitespace-nowrap shrink-0 ${cat === c ? "bg-[#FF6B1A]/15 text-[#FF6B1A] border border-[#FF6B1A]/30" : "bg-[#11161D] border border-[#222A35] text-[#8A95A5] hover:text-white"}`}>{CATEGORY_LABELS[c] || c}</button>
            ))}
          </div>
          {loading && <div className="text-[11px] text-[#5B6675]">Loading templates…</div>}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
            {filteredTemplates.map((t) => (
              <div key={t.id} className="rounded-xl border border-[#222A35] bg-[#11161D] p-4 hover:border-[#FF6B1A]/30 transition flex flex-col">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {t.category === "checklist" || t.category === "safety" ? <ClipboardList className="w-4 h-4 text-[#FF6B1A]" /> : t.category === "timesheet" ? <Clock className="w-4 h-4 text-[#3B82F6]" /> : t.category === "rfi" ? <FileText className="w-4 h-4 text-[#8B5CF6]" /> : <FileDigit className="w-4 h-4 text-[#22C55E]" />}
                    <span className="px-1.5 py-0.5 rounded text-[10px] bg-[#222A35] text-[#8A95A5]">{CATEGORY_LABELS[t.category] || t.category}</span>
                  </div>
                  <button onClick={() => deleteTemplate(t.id)} className="text-[#5B6675] hover:text-[#EF4444]"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
                <div className="text-[13px] text-white font-display mt-2">{t.title}</div>
                <div className="text-[11px] text-[#8A95A5] mt-0.5 line-clamp-2">{t.description}</div>
                <div className="text-[10px] text-[#5B6675] mt-2">{t.fields.length} field{t.fields.length === 1 ? "" : "s"}</div>
                <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-[#222A35]">
                  <button onClick={() => openFill(t)} className="flex-1 h-8 rounded-md bg-[#FF6B1A] text-white text-[11px] flex items-center justify-center gap-1"><PenTool className="w-3 h-3" /> Fill</button>
                  <button onClick={() => setShowShare(t)} className="h-8 px-2 rounded-md border border-[#222A35] text-[11px] text-[#8A95A5] hover:text-white flex items-center gap-1"><Share2 className="w-3 h-3" /> Share</button>
                  <button onClick={() => setShowSaveChecklist(t)} className="h-8 px-2 rounded-md border border-[#3B82F6]/30 text-[11px] text-[#3B82F6] bg-[#3B82F6]/10 hover:bg-[#3B82F6]/20 flex items-center gap-1"><Bookmark className="w-3 h-3" /> Save as Checklist</button>
                  <button onClick={() => toast("Template downloaded")} className="h-8 w-8 rounded-md border border-[#222A35] text-[#8A95A5] hover:text-white flex items-center justify-center"><Download className="w-3.5 h-3.5" /></button>
                </div>
              </div>
            ))}
          </div>
          {!loading && filteredTemplates.length === 0 && (
            <div className="rounded-xl border border-dashed border-[#222A35] py-16 text-center">
              <FileDigit className="w-8 h-8 text-[#5B6675] mx-auto" />
              <div className="text-[14px] text-white mt-3 font-display">No templates match</div>
              <div className="text-[12px] text-[#8A95A5] mt-1">Try clearing filters or create a new template</div>
            </div>
          )}
        </>
      )}

      {/* Checklist Templates tab */}
      {activeTab === "checklist-templates" && (
        <>
          <div className="flex gap-1.5 overflow-x-auto -mx-1 px-1">
            {["All", ...TRADES].map((t) => (
              <button key={t} onClick={() => setClTrade(t)} className={`px-3 h-8 rounded-md text-[11px] whitespace-nowrap shrink-0 ${clTrade === t ? "bg-[#FF6B1A]/15 text-[#FF6B1A] border border-[#FF6B1A]/30" : "bg-[#11161D] border border-[#222A35] text-[#8A95A5] hover:text-white"}`}>{t}</button>
            ))}
          </div>
          {loading && <div className="text-[11px] text-[#5B6675]">Loading checklist templates…</div>}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
            {filteredClTemplates.map((t) => (
              <div key={t.id} className="rounded-xl border border-[#222A35] bg-[#11161D] p-4 hover:border-[#FF6B1A]/30 transition flex flex-col">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <ListChecks className="w-4 h-4 text-[#FF6B1A]" />
                    <span className="px-1.5 py-0.5 rounded text-[10px] bg-[#222A35] text-[#8A95A5]">{t.trade}</span>
                    {t.id.startsWith("sys-") && <span className="px-1.5 py-0.5 rounded text-[10px] bg-[#3B82F6]/15 text-[#3B82F6] border border-[#3B82F6]/30">System</span>}
                  </div>
                  {isOwner && !t.id.startsWith("sys-") && (
                    <button onClick={() => deleteClTemplate(t.id)} className="text-[#5B6675] hover:text-[#EF4444]"><Trash2 className="w-3.5 h-3.5" /></button>
                  )}
                </div>
                <div className="text-[13px] text-white font-display mt-2">{t.title}</div>
                <div className="text-[10px] text-[#5B6675] mt-2">{t.items.length} item{t.items.length === 1 ? "" : "s"}</div>
                <div className="mt-2 space-y-1 max-h-[120px] overflow-y-auto">
                  {t.items.slice(0, 4).map((item, i) => (
                    <div key={i} className="flex items-center gap-1.5 text-[11px] text-[#8A95A5]">
                      <CheckCircle className="w-3 h-3 text-[#22C55E] shrink-0" />
                      <span className="truncate">{item.label}</span>
                      {item.required && <span className="text-[#EF4444]">*</span>}
                    </div>
                  ))}
                  {t.items.length > 4 && <div className="text-[10px] text-[#5B6675]">+{t.items.length - 4} more…</div>}
                </div>
                <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-[#222A35]">
                  <button onClick={() => setShowUseClTemplate(t)} className="flex-1 h-8 rounded-md bg-[#FF6B1A] text-white text-[11px] flex items-center justify-center gap-1"><ClipboardList className="w-3 h-3" /> Use Template</button>
                  <button onClick={() => toast(`Template "${t.title}" downloaded`)} className="h-8 w-8 rounded-md border border-[#222A35] text-[#8A95A5] hover:text-white flex items-center justify-center"><Download className="w-3.5 h-3.5" /></button>
                </div>
              </div>
            ))}
          </div>
          {!loading && filteredClTemplates.length === 0 && (
            <div className="rounded-xl border border-dashed border-[#222A35] py-16 text-center">
              <ClipboardList className="w-8 h-8 text-[#5B6675] mx-auto" />
              <div className="text-[14px] text-white mt-3 font-display">No checklist templates match</div>
              <div className="text-[12px] text-[#8A95A5] mt-1">Try clearing filters or add a new template</div>
            </div>
          )}
        </>
      )}

      {/* Checklists tab */}
      {activeTab === "checklists" && (
        <div className="space-y-3">
          {checklists.length === 0 && (
            <div className="rounded-xl border border-dashed border-[#222A35] py-16 text-center">
              <ClipboardList className="w-8 h-8 text-[#5B6675] mx-auto" />
              <div className="text-[14px] text-white mt-3 font-display">No checklists yet</div>
              <div className="text-[12px] text-[#8A95A5] mt-1">Save a template as a checklist to see it here</div>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
            {checklists.map((cl) => (
              <div key={cl.id} className="rounded-xl border border-[#222A35] bg-[#11161D] p-4 flex flex-col">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <ClipboardList className="w-4 h-4 text-[#FF6B1A]" />
                    <span className={`px-1.5 py-0.5 rounded text-[10px] border ${cl.assigned ? "bg-[#3B82F6]/10 text-[#3B82F6] border-[#3B82F6]/30" : "bg-[#222A35] text-[#8A95A5] border-[#222A35]"}`}>{cl.assigned ? "Assigned" : "Unassigned"}</span>
                  </div>
                  <button onClick={() => toggleChecklistAssigned(cl)} className={`text-[11px] flex items-center gap-1 px-2 py-0.5 rounded border ${cl.assigned ? "bg-[#3B82F6]/10 text-[#3B82F6] border-[#3B82F6]/30" : "bg-[#222A35] text-[#8A95A5] border-[#222A35] hover:text-white"}`}>
                    {cl.assigned ? <UserCheck className="w-3 h-3" /> : <Users className="w-3 h-3" />} {cl.assigned ? "Assigned" : "Assign"}
                  </button>
                </div>
                <div className="text-[13px] text-white font-display mt-2">{cl.title}</div>
                <div className="text-[11px] text-[#8A95A5] mt-0.5 line-clamp-2">{cl.description || ""}</div>
                <div className="flex items-center gap-3 mt-2 text-[10px] text-[#5B6675]">
                  {cl.assignee && <span className="flex items-center gap-1"><UserCheck className="w-3 h-3" /> {cl.assignee}</span>}
                  {cl.dueDate && <span className="flex items-center gap-1"><CalendarDays className="w-3 h-3" /> {new Date(cl.dueDate).toLocaleDateString()}</span>}
                  <span className="flex items-center gap-1"><CheckCircle className="w-3 h-3" /> {cl.questions?.length || 0} items</span>
                </div>
                <div className="flex gap-2 mt-3 pt-3 border-t border-[#222A35]">
                  <button onClick={() => toast("Opening checklist " + cl.title)} className="flex-1 h-8 rounded-md bg-[#FF6B1A] text-white text-[11px] flex items-center justify-center gap-1"><ChevronRight className="w-3 h-3" /> Open</button>
                  <button onClick={() => toast("Checklist exported")} className="h-8 w-8 rounded-md border border-[#222A35] text-[#8A95A5] hover:text-white flex items-center justify-center"><Download className="w-3.5 h-3.5" /></button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Submissions tab */}
      {activeTab === "submissions" && (
        <div className="rounded-xl border border-[#222A35] bg-[#11161D] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-[12px]">
              <thead>
                <tr className="text-[10px] text-[#5B6675] uppercase tracking-wider">
                  <th className="text-left px-4 py-2.5">Form</th>
                  <th className="text-left px-3 py-2.5">Project</th>
                  <th className="text-left px-3 py-2.5">Submitted</th>
                  <th className="text-left px-3 py-2.5">Status</th>
                  <th className="text-right px-4 py-2.5">Action</th>
                </tr>
              </thead>
              <tbody>
                {submissions.map((s) => (
                  <tr key={s.id} className="border-t border-[#222A35] hover:bg-[#161C24]">
                    <td className="px-4 py-2.5 text-white font-display">{s.templateTitle}</td>
                    <td className="px-3 py-2.5 text-[#8A95A5]">{s.project}</td>
                    <td className="px-3 py-2.5 text-[#8A95A5]">{s.submittedAt}</td>
                    <td className="px-3 py-2.5"><span className={`px-2 py-0.5 rounded-full text-[10px] border ${s.status === "approved" ? "bg-[#22C55E]/15 text-[#22C55E] border-[#22C55E]/30" : s.status === "submitted" ? "bg-[#3B82F6]/15 text-[#3B82F6] border-[#3B82F6]/30" : "bg-[#5B6675]/15 text-[#5B6675] border-[#5B6675]/30"}`}>{s.status}</span></td>
                    <td className="px-4 py-2.5 text-right"><button onClick={() => toast("Downloaded submission PDF")} className="text-[#8A95A5] hover:text-white"><Download className="w-3.5 h-3.5" /></button></td>
                  </tr>
                ))}
                {submissions.length === 0 && <tr><td colSpan={5} className="text-center py-8 text-[11px] text-[#5B6675]">No submissions yet</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* New Template Modal */}
      {showNew && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => setShowNew(false)}>
          <div className="bg-[#11161D] border border-[#222A35] rounded-xl w-full max-w-lg p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4"><div className="text-[14px] text-white font-display">New Form Template</div><button onClick={() => setShowNew(false)} className="text-[#8A95A5] hover:text-white"><X className="w-4 h-4" /></button></div>
            <div className="space-y-3 text-[12px]">
              <div><div className="text-[10px] text-[#8A95A5] uppercase tracking-wider mb-1">Title</div><input value={newForm.title || ""} onChange={(e) => setNewForm({ ...newForm, title: e.target.value })} className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-3 text-white focus:outline-none focus:border-[#FF6B1A]" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><div className="text-[10px] text-[#8A95A5] uppercase tracking-wider mb-1">Category</div><select value={newForm.category || "custom"} onChange={(e) => setNewForm({ ...newForm, category: e.target.value })} className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-white">{CATEGORIES.filter((c) => c !== "All").map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c] || c}</option>)}</select></div>
                <div><div className="text-[10px] text-[#8A95A5] uppercase tracking-wider mb-1">Description</div><input value={newForm.description || ""} onChange={(e) => setNewForm({ ...newForm, description: e.target.value })} className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-3 text-white focus:outline-none focus:border-[#FF6B1A]" /></div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-2"><div className="text-[10px] text-[#8A95A5] uppercase tracking-wider">Fields</div><button onClick={addField} className="text-[10px] text-[#FF6B1A] hover:underline">+ Add field</button></div>
                <div className="space-y-2">
                  {(newForm.fields || []).map((f, i) => (
                    <div key={i} className="flex gap-2 items-center">
                      <input value={f.label} onChange={(e) => updateField(i, { label: e.target.value })} placeholder="Label" className="flex-1 h-8 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-white text-[11px]" />
                      <select value={f.type} onChange={(e) => updateField(i, { type: e.target.value as any })} className="h-8 bg-[#0A0E14] border border-[#222A35] rounded-md px-1 text-white text-[11px]"><option value="text">Text</option><option value="number">Number</option><option value="date">Date</option><option value="checkbox">Checkbox</option><option value="select">Select</option><option value="photo">Photo</option></select>
                      {f.type === "select" && <input value={f.options || ""} onChange={(e) => updateField(i, { options: e.target.value })} placeholder="opt1,opt2" className="w-24 h-8 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-white text-[11px]" />}
                      <button onClick={() => removeField(i)} className="text-[#5B6675] hover:text-[#EF4444]"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 mt-5 pt-4 border-t border-[#222A35]">
              <button onClick={() => setShowNew(false)} className="h-9 px-3 rounded-md border border-[#222A35] text-[12px] text-[#8A95A5] hover:text-white">Cancel</button>
              <button onClick={createTemplate} className="h-9 px-4 rounded-md bg-[#FF6B1A] text-white text-[12px] flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" /> Create</button>
            </div>
          </div>
        </div>
      )}

      {/* Fill Form Modal */}
      {showFill && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => setShowFill(null)}>
          <div className="bg-[#11161D] border border-[#222A35] rounded-xl w-full max-w-lg p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4"><div><div className="text-[14px] text-white font-display">{showFill.title}</div><div className="text-[11px] text-[#8A95A5]">{showFill.description}</div></div><button onClick={() => setShowFill(null)} className="text-[#8A95A5] hover:text-white"><X className="w-4 h-4" /></button></div>
            <div className="space-y-3 text-[12px]">
              <div><div className="text-[10px] text-[#8A95A5] uppercase tracking-wider mb-1">Project</div><select value={fillProject} onChange={(e) => setFillProject(e.target.value)} className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-white">{PROJECTS.map((p) => <option key={p}>{p}</option>)}</select></div>
              {showFill.fields.map((f, i) => (
                <div key={i}>
                  <div className="text-[10px] text-[#8A95A5] uppercase tracking-wider mb-1">{f.label}{f.required && <span className="text-[#EF4444]"> *</span>}</div>
                  {f.type === "select" ? (
                    <select value={fillAnswers[f.label] || ""} onChange={(e) => setFillAnswers((prev) => ({ ...prev, [f.label]: e.target.value }))} className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-white"><option value="">Select…</option>{f.options?.split(",").map((o) => <option key={o.trim()} value={o.trim()}>{o.trim()}</option>)}</select>
                  ) : f.type === "checkbox" ? (
                    <label className="flex items-center gap-2 h-9 cursor-pointer"><input type="checkbox" checked={!!fillAnswers[f.label]} onChange={(e) => setFillAnswers((prev) => ({ ...prev, [f.label]: e.target.checked ? "true" : "" }))} className="w-4 h-4 accent-[#FF6B1A]" /><span className="text-[#8A95A5]">Yes</span></label>
                  ) : f.type === "photo" ? (
                    <div className="flex items-center gap-2">
                      <button onClick={() => { setPendingPhotoField(f.label); photoRef.current?.click(); }} className="h-9 px-3 rounded-md border border-[#222A35] text-[11px] text-[#8A95A5] hover:text-white flex items-center gap-1"><Camera className="w-3 h-3" /> Attach photo</button>
                      {fillAnswers[f.label] && <img src={fillAnswers[f.label]} alt="" className="w-10 h-10 rounded border border-[#222A35] object-cover" />}
                    </div>
                  ) : (
                    <input type={f.type} value={fillAnswers[f.label] || ""} onChange={(e) => setFillAnswers((prev) => ({ ...prev, [f.label]: e.target.value }))} className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-3 text-white focus:outline-none focus:border-[#FF6B1A]" />
                  )}
                </div>
              ))}
            </div>
            <div className="flex items-center justify-end gap-2 mt-5 pt-4 border-t border-[#222A35]">
              <button onClick={() => setShowFill(null)} className="h-9 px-3 rounded-md border border-[#222A35] text-[12px] text-[#8A95A5] hover:text-white">Cancel</button>
              <button onClick={submitFill} className="h-9 px-4 rounded-md bg-[#FF6B1A] text-white text-[12px] flex items-center gap-1.5"><Send className="w-3.5 h-3.5" /> Submit</button>
            </div>
          </div>
        </div>
      )}

      {/* Share Template Modal */}
      {showShare && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => setShowShare(null)}>
          <div className="bg-[#11161D] border border-[#222A35] rounded-xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4"><div className="text-[14px] text-white font-display flex items-center gap-2"><Share2 className="w-4 h-4 text-[#FF6B1A]" /> Share Template</div><button onClick={() => setShowShare(null)} className="text-[#8A95A5] hover:text-white"><X className="w-4 h-4" /></button></div>
            <div className="space-y-3 text-[12px]">
              <div className="text-[11px] text-[#8A95A5]">Share <span className="text-white font-display">{showShare.title}</span> with a team member.</div>
              <div><div className="text-[10px] text-[#8A95A5] uppercase tracking-wider mb-1">Select user</div><select value={shareUser} onChange={(e) => setShareUser(e.target.value)} className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-white"><option value="">Select…</option>{USERS.map((u) => <option key={u} value={u}>{u}</option>)}</select></div>
            </div>
            <div className="flex items-center justify-end gap-2 mt-5 pt-4 border-t border-[#222A35]">
              <button onClick={() => setShowShare(null)} className="h-9 px-3 rounded-md border border-[#222A35] text-[12px] text-[#8A95A5] hover:text-white">Cancel</button>
              <button onClick={shareTemplate} disabled={!shareUser} className="h-9 px-4 rounded-md bg-[#FF6B1A] text-white text-[12px] flex items-center gap-1.5 disabled:opacity-50"><Share2 className="w-3.5 h-3.5" /> Share</button>
            </div>
          </div>
        </div>
      )}

      {/* Save as Checklist Modal */}
      {showSaveChecklist && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => setShowSaveChecklist(null)}>
          <div className="bg-[#11161D] border border-[#222A35] rounded-xl w-full max-w-lg p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4"><div className="text-[14px] text-white font-display flex items-center gap-2"><Bookmark className="w-4 h-4 text-[#3B82F6]" /> Save as Checklist</div><button onClick={() => setShowSaveChecklist(null)} className="text-[#8A95A5] hover:text-white"><X className="w-4 h-4" /></button></div>
            <div className="space-y-3 text-[12px]">
              <div className="text-[11px] text-[#8A95A5]">Save <span className="text-white font-display">{showSaveChecklist.title}</span> as a checklist and assign it to a worker.</div>
              <div><div className="text-[10px] text-[#8A95A5] uppercase tracking-wider mb-1">Assignee <span className="text-[#EF4444]">*</span></div><select value={assignee} onChange={(e) => setAssignee(e.target.value)} className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-white"><option value="">Select…</option>{USERS.map((u) => <option key={u} value={u}>{u}</option>)}</select></div>
              <div><div className="text-[10px] text-[#8A95A5] uppercase tracking-wider mb-1">Project</div><select value={saveProject} onChange={(e) => setSaveProject(e.target.value)} className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-white">{PROJECTS.map((p) => <option key={p}>{p}</option>)}</select></div>
              <div><div className="text-[10px] text-[#8A95A5] uppercase tracking-wider mb-1">Due date</div><input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-3 text-white focus:outline-none focus:border-[#FF6B1A]" /></div>
              <div className="rounded-md border border-[#222A35] bg-[#0A0E14] p-3">
                <div className="text-[10px] text-[#5B6675] uppercase tracking-wider mb-1">Checklist items ({showSaveChecklist.fields.length})</div>
                <ul className="space-y-1">
                  {showSaveChecklist.fields.map((f, i) => (
                    <li key={i} className="text-[11px] text-[#8A95A5] flex items-center gap-1.5"><CheckCircle className="w-3 h-3 text-[#22C55E]" /> {f.label}{f.required && <span className="text-[#EF4444]">*</span>}</li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 mt-5 pt-4 border-t border-[#222A35]">
              <button onClick={() => setShowSaveChecklist(null)} className="h-9 px-3 rounded-md border border-[#222A35] text-[12px] text-[#8A95A5] hover:text-white">Cancel</button>
              <button onClick={saveAsChecklist} disabled={!assignee} className="h-9 px-4 rounded-md bg-[#3B82F6] text-white text-[12px] flex items-center gap-1.5 disabled:opacity-50"><Bookmark className="w-3.5 h-3.5" /> Save & Assign</button>
            </div>
          </div>
        </div>
      )}

      {/* New Checklist Template Modal */}
      {showNewClTemplate && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => setShowNewClTemplate(false)}>
          <div className="bg-[#11161D] border border-[#222A35] rounded-xl w-full max-w-lg p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4"><div className="text-[14px] text-white font-display flex items-center gap-2"><LayoutTemplate className="w-4 h-4 text-[#FF6B1A]" /> New Checklist Template</div><button onClick={() => setShowNewClTemplate(false)} className="text-[#8A95A5] hover:text-white"><X className="w-4 h-4" /></button></div>
            <div className="space-y-3 text-[12px]">
              <div><div className="text-[10px] text-[#8A95A5] uppercase tracking-wider mb-1">Title</div><input value={newClTemplate.title || ""} onChange={(e) => setNewClTemplate({ ...newClTemplate, title: e.target.value })} placeholder="e.g. Electrical Panel Inspection" className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-3 text-white focus:outline-none focus:border-[#FF6B1A]" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><div className="text-[10px] text-[#8A95A5] uppercase tracking-wider mb-1">Trade</div><select value={newClTemplate.trade || "General"} onChange={(e) => setNewClTemplate({ ...newClTemplate, trade: e.target.value })} className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-white">{TRADES.map((t) => <option key={t}>{t}</option>)}</select></div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-2"><div className="text-[10px] text-[#8A95A5] uppercase tracking-wider">Items</div><button onClick={addClItem} className="text-[10px] text-[#FF6B1A] hover:underline">+ Add item</button></div>
                <div className="space-y-2">
                  {(newClTemplate.items || []).map((item, i) => (
                    <div key={i} className="flex gap-2 items-center">
                      <input value={item.label} onChange={(e) => updateClItem(i, { label: e.target.value })} placeholder="Item label" className="flex-1 h-8 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-white text-[11px]" />
                      <select value={item.type} onChange={(e) => updateClItem(i, { type: e.target.value as any })} className="h-8 bg-[#0A0E14] border border-[#222A35] rounded-md px-1 text-white text-[11px]"><option value="yes_no">Yes/No</option><option value="number">Number</option><option value="text">Text</option><option value="photo">Photo</option></select>
                      <label className="flex items-center gap-1 text-[10px] text-[#8A95A5] cursor-pointer"><input type="checkbox" checked={!!item.required} onChange={(e) => updateClItem(i, { required: e.target.checked })} className="w-3 h-3 accent-[#FF6B1A]" /> Req</label>
                      <button onClick={() => removeClItem(i)} className="text-[#5B6675] hover:text-[#EF4444]"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  ))}
                </div>
              </div>
              {/* JSON Import */}
              <div className="pt-3 border-t border-[#222A35]">
                <div className="text-[10px] text-[#8A95A5] uppercase tracking-wider mb-1 flex items-center gap-1"><Upload className="w-3 h-3" /> Bulk Import (JSON)</div>
                <textarea value={importJson} onChange={(e) => setImportJson(e.target.value)} placeholder={`[{ "title": "...", "trade": "...", "items": [{ "label": "...", "type": "yes_no", "required": true }] }]`} className="w-full h-20 bg-[#0A0E14] border border-[#222A35] rounded-md px-3 py-2 text-[11px] text-white placeholder:text-[#5B6675] focus:outline-none focus:border-[#FF6B1A] resize-none" />
                <button onClick={importClTemplates} disabled={!importJson.trim()} className="mt-2 h-8 px-3 rounded-md border border-[#222A35] text-[11px] text-[#8A95A5] hover:text-white flex items-center gap-1.5 disabled:opacity-50"><Upload className="w-3.5 h-3.5" /> Import</button>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 mt-5 pt-4 border-t border-[#222A35]">
              <button onClick={() => setShowNewClTemplate(false)} className="h-9 px-3 rounded-md border border-[#222A35] text-[12px] text-[#8A95A5] hover:text-white">Cancel</button>
              <button onClick={createClTemplate} className="h-9 px-4 rounded-md bg-[#FF6B1A] text-white text-[12px] flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" /> Create</button>
            </div>
          </div>
        </div>
      )}

      {/* Use Checklist Template Modal */}
      {showUseClTemplate && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => setShowUseClTemplate(null)}>
          <div className="bg-[#11161D] border border-[#222A35] rounded-xl w-full max-w-lg p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4"><div className="text-[14px] text-white font-display flex items-center gap-2"><ClipboardList className="w-4 h-4 text-[#FF6B1A]" /> Use Checklist Template</div><button onClick={() => setShowUseClTemplate(null)} className="text-[#8A95A5] hover:text-white"><X className="w-4 h-4" /></button></div>
            <div className="space-y-3 text-[12px]">
              <div className="text-[11px] text-[#8A95A5]">Create a checklist from <span className="text-white font-display">{showUseClTemplate.title}</span> and assign it.</div>
              <div><div className="text-[10px] text-[#8A95A5] uppercase tracking-wider mb-1">Assignee <span className="text-[#EF4444]">*</span></div><select value={useClAssignee} onChange={(e) => setUseClAssignee(e.target.value)} className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-white"><option value="">Select…</option>{USERS.map((u) => <option key={u} value={u}>{u}</option>)}</select></div>
              <div><div className="text-[10px] text-[#8A95A5] uppercase tracking-wider mb-1">Project</div><select value={useClProject} onChange={(e) => setUseClProject(e.target.value)} className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-white">{PROJECTS.map((p) => <option key={p}>{p}</option>)}</select></div>
              <div><div className="text-[10px] text-[#8A95A5] uppercase tracking-wider mb-1">Due date</div><input type="date" value={useClDueDate} onChange={(e) => setUseClDueDate(e.target.value)} className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-3 text-white focus:outline-none focus:border-[#FF6B1A]" /></div>
              <div className="rounded-md border border-[#222A35] bg-[#0A0E14] p-3">
                <div className="text-[10px] text-[#5B6675] uppercase tracking-wider mb-1">Checklist items ({showUseClTemplate.items.length})</div>
                <ul className="space-y-1 max-h-[200px] overflow-y-auto">
                  {showUseClTemplate.items.map((item, i) => (
                    <li key={i} className="text-[11px] text-[#8A95A5] flex items-center gap-1.5"><CheckCircle className="w-3 h-3 text-[#22C55E] shrink-0" /> {item.label}{item.required && <span className="text-[#EF4444]">*</span>}</li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 mt-5 pt-4 border-t border-[#222A35]">
              <button onClick={() => setShowUseClTemplate(null)} className="h-9 px-3 rounded-md border border-[#222A35] text-[12px] text-[#8A95A5] hover:text-white">Cancel</button>
              <button onClick={useClTemplate} disabled={!useClAssignee} className="h-9 px-4 rounded-md bg-[#FF6B1A] text-white text-[12px] flex items-center gap-1.5 disabled:opacity-50"><ClipboardList className="w-3.5 h-3.5" /> Create & Assign</button>
            </div>
          </div>
        </div>
      )}

      <input ref={photoRef} type="file" accept="image/*" className="hidden" onChange={async (e) => {
        const f = e.target.files?.[0]; const field = pendingPhotoField;
        e.currentTarget.value = "";
        if (!f || !field) return;
        let url: string; try { url = await api.uploadFile(f); } catch { url = URL.createObjectURL(f); }
        setFillAnswers((prev) => ({ ...prev, [field]: url }));
      }} />
    </div>
  );
}
