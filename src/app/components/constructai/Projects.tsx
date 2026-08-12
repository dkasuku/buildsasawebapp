import { useEffect, useState } from "react";
import { toast } from "sonner";
import { MapPin, Calendar, MoreHorizontal, Filter, LayoutGrid, List, Plus, TrendingUp, AlertCircle, X, ImagePlus, UploadCloud, UserCircle, ClipboardList, ChevronDown, ChevronRight, Star, ChevronLeft, ChevronRight as ChevronRightIcon, FolderKanban, SearchX } from "lucide-react";
import { MapPicker } from "./MapPicker";
import { EmptyState } from "./EmptyState";
import { ImageLightbox } from "./ImageLightbox";
import { ImageWithFallback } from "../figma/ImageWithFallback";
import { useFileUpload } from "./useFileUpload";
import { UploadTray } from "./UploadTray";
import { refreshProjects } from "./useProjects";
import { resolveName, useTeam } from "./useTeam";
import api, { absoluteFileUrl } from "../../services/api";
import type { View } from "./Sidebar";
import type { Role } from "./roles";
import { ROLES } from "./roles";
import type { Checklist } from "./ChecklistBuilder";
import { useCurrency } from "./CurrencyContext";
import { formatCompactCurrency, formatCurrency } from "./currency";
import { warnSaveFailed } from "./saveFeedback";

const $toKES = (dollars: number) => Math.round(dollars * 130);

type Project = {
  id?: string;
  name: string;
  /** Planned completion, from the Project row. Absent for most projects, in which
   *  case the card shows no date — it used to print a hardcoded "Q4 2027". */
  targetEndDate?: string | null;
  code: string;
  city: string;
  lat?: number | null;
  lng?: number | null;
  description?: string;
  value: string;
  valueKES?: number;
  progress: number;
  status: string;
  changeOrders: number;
  exposure: string;
  exposureKES?: number;
  img: string;
  images: string[];
  pm: string;
  architect: string;
  qs: string;
  checklist?: Checklist;
};

type ProjectForm = {
  name: string;
  code: string;
  city: string;
  lat?: number | null;
  lng?: number | null;
  description: string;
  // Contract value is split into a currency and an amount, exactly like exposure.
  // It used to be one free-text field defaulting to "$0M", and fromDto then read
  // it as dollars and multiplied by 130 — so a Kenyan user typing "50M" meaning
  // shillings had a 6.5 BILLION shilling contract recorded against the project.
  valueCurrency: string;
  valueAmount: string;
  status: string;
  progress: number;
  changeOrders: number;
  exposureCurrency: string;
  exposureAmount: string;
  images: string[];
  pm: string;
  architect: string;
  qs: string;
  checklist: Checklist;
};

const DEFAULT_PROJECT_IMG = "https://images.unsplash.com/photo-1541888946425-d81bb19240f5?w=800&q=80";

// The PM / Architect / QS pickers used to offer these HARDCODED JOB TITLES:
//
//   PM_OPTIONS   = ["None", "Site Manager (You)", "Project Manager", "Assistant PM"]
//   ARCH_OPTIONS = ["None", "Lead Architect", "Consulting Architect", …]
//   QS_OPTIONS   = ["None", "Lead QS", "Assistant QS", "Cost Controller"]
//
// Assignment.userId is a foreign key onto User.id, so saving wrote the string
// "Lead Architect" into a user reference and the database rejected it
// (Assignment_userId_fkey). The Team section could therefore NEVER save — the
// failure was simply swallowed. Reading was broken to match: the stored value is
// a real user id, which matched none of these labels, so the dropdown showed the
// wrong entry. Options now come from the workspace's actual members.
const NO_MEMBER = "None";

// Role picker backed by the workspace's real members. `value` is a User.id (or
// "None"), which is what Assignment.userId requires.
//
// If a project references someone who has since left the workspace, their id would
// match no option and the browser would silently show the first entry instead —
// making it look as though the role were unset. That id gets its own option so the
// current state is always visible.
function MemberSelect({
  label, value, onChange, members, dark,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  members: { id: string; name: string; role: string }[];
  dark?: boolean;
}) {
  const known = members.some((m) => m.id === value);
  const orphan = value && value !== NO_MEMBER && !known;
  return (
    <div>
      <label className="text-[11px] text-[#8A95A5] block mb-1">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full h-9 px-3 rounded-md ${dark ? "bg-[#0A0E14]" : "bg-[#11161D]"} border border-[#222A35] text-[13px] text-white focus:outline-none focus:border-[#FF6B1A]`}
      >
        <option value={NO_MEMBER}>Not assigned</option>
        {members.map((m) => <option key={m.id} value={m.id}>{m.name}{m.role ? ` — ${m.role}` : ""}</option>)}
        {orphan && <option value={value}>{resolveName(value)} (no longer in workspace)</option>}
      </select>
      {members.length === 0 && (
        <div className="text-[10px] text-[#5B6675] mt-1">No teammates yet — invite people on the Team page.</div>
      )}
    </div>
  );
}

// Projects come from the API only. A six-project demo seed used to stand in when
// the backend was unreachable, which meant an outage showed a convincing but
// fictional workspace.

const TABS = ["All", "Active", "At Risk", "Planning", "Closing", "Archived"];
const STATUS_FILTERS = ["On Track", "At Risk", "Planning", "Closing", "Archived"];
// Shillings and dollars only. €, £ and AED were selectable here with hardcoded,
// unmaintained conversion rates behind them.
const CURRENCY_OPTIONS = ["KSh", "$"];

const statusColor = (s: string) =>
  s === "On Track" ? "bg-[#22C55E]/15 text-[#22C55E] border-[#22C55E]/30"
  : s === "At Risk" ? "bg-[#EF4444]/15 text-[#EF4444] border-[#EF4444]/30"
  : s === "Planning" ? "bg-[#3B82F6]/15 text-[#3B82F6] border-[#3B82F6]/30"
  : s === "Archived" ? "bg-[#5B6675]/15 text-[#8A95A5] border-[#222A35]"
  : "bg-[#F5A623]/15 text-[#F5A623] border-[#F5A623]/30";

// Maps a change-order status to a human label + accent color for the
// Recent Activity panel.
const CO_STATUS_DISPLAY: Record<string, { label: string; color: string }> = {
  drafted: { label: "Drafted", color: "#5B6675" },
  pm_review: { label: "PM Review", color: "#3B82F6" },
  owner_approval: { label: "Owner Approval", color: "#FF6B1A" },
  approved: { label: "Approved", color: "#22C55E" },
  rejected: { label: "Rejected", color: "#EF4444" },
  void: { label: "Void", color: "#5B6675" },
};

const parseCompactValue = (value: string) => {
  const cleaned = value.replace(/[+$]/g, "").trim();
  const match = cleaned.match(/([\d.]+)\s*([mk])?/i);
  if (!match) return 0;
  const amount = Number(match[1]);
  const unit = match[2]?.toLowerCase();
  if (unit === "m") return amount * 1_000_000;
  if (unit === "k") return amount * 1_000;
  return Number.isFinite(amount) ? amount : 0;
};

// Historic rows may still carry €, £ or AED in their exposure string, so those are
// still RECOGNISED when parsing an existing value — they map onto one of the two
// supported symbols rather than being kept, and can no longer be chosen.
const normalizeCurrency = (value: string) => {
  const upper = value.toUpperCase();
  if (upper === "KES" || upper === "KSH" || value === "KSh") return "KSh";
  // Everything else — USD, and the retired EUR/GBP/AED — resolves to dollars.
  return "$";
};

const parseExposure = (exposure: string) => {
  const trimmed = exposure.trim();
  const sign = trimmed.startsWith("-") ? "-" : "+";
  const withoutSign = trimmed.replace(/^[-+]/, "").trim();
  const currencyMatch = withoutSign.match(/^(KSh|KES|USD|EUR|GBP|AED|\$|€|£)/i);
  const currency = normalizeCurrency(currencyMatch?.[0] ?? "$");
  const amount = withoutSign.replace(currencyMatch?.[0] ?? "", "").trim();
  return { currency, amount: amount || "0", sign };
};

// Contract value, split the same way but without a +/- sign.
const parseValue = (value: string) => {
  const trimmed = (value || "").trim();
  const currencyMatch = trimmed.match(/^(KSh|KES|USD|EUR|GBP|AED|\$|€|£)/i);
  const currency = normalizeCurrency(currencyMatch?.[0] ?? "$");
  const amount = trimmed.replace(currencyMatch?.[0] ?? "", "").trim();
  return { currency, amount: amount || "0" };
};

const formatValue = (currency: string, amount: string) => {
  const trimmed = (amount || "").trim() || "0";
  const spacer = currency.length > 1 ? " " : "";
  return `${currency}${spacer}${trimmed}`;
};

// Convert a stored money string ("KSh 50M", "$2.4M") into shillings, using the
// symbol the string actually carries. fromDto used to multiply EVERY value by 130
// regardless of its currency, inflating shilling figures 130-fold.
const moneyStringToKES = (money: string) => {
  const { currency, amount } = parseValue(money || "0");
  return Math.round(parseCompactValue(amount) * (CURRENCY_TO_KES[currency] ?? 1));
};

const formatExposure = (currency: string, amount: string, sign = "+") => {
  const trimmed = amount.trim() || "0";
  const spacer = currency.length > 1 ? " " : "";
  return `${sign}${currency}${spacer}${trimmed}`;
};

// Project status is free-ish text: the form offers "Planning / On Track / At Risk
// / Closing / Archived", but rows in the wild also carry "Active" and
// "In Progress". The KPI checks used to hardcode only the form's vocabulary, so a
// workspace of "Active" projects reported 0% health and undercounted actives.
const IN_PROGRESS_STATUSES = ["On Track", "At Risk", "Planning", "Active", "In Progress"];
const HEALTHY_STATUSES = ["On Track", "Closing", "Active", "In Progress"];

// KSh and $ are the only currencies a user can pick. The retired symbols stay in
// this table so historic rows that still hold them convert to a real figure
// instead of silently falling back to 1:1.
const CURRENCY_TO_KES: Record<string, number> = {
  "KSh": 1,
  "$": 130,
  "€": 141,
  "£": 167,
  "AED": 35,
};

export function Projects({
  setView,
  role = "Contractor",
  onOpenProject,
  openEditProjectId,
  onConsumeEditProjectId,
}: {
  setView: (v: View) => void;
  role?: Role;
  /** Drill into the per-project dashboard. */
  onOpenProject?: (projectId: string) => void;
  /** Open the edit dialog for this project once the list has loaded (used when
   *  returning from the detail page's "Edit project"). */
  openEditProjectId?: string | null;
  onConsumeEditProjectId?: () => void;
}) {
  const showFin = ROLES[role].financials;
  const { currency } = useCurrency();
  const [tab, setTab] = useState("All");
  const [layout, setLayout] = useState<"grid" | "list">("grid");
  const [query, setQuery] = useState("");
  // Start empty and show a loading state until the backend responds, so a fresh
  // workspace never flashes the seed/demo projects before the empty state. The
  // seed list is only used as an offline fallback (see the fetch's .catch).
  // The workspace's real members, for the PM / Architect / QS pickers. These used
  // to be hardcoded job titles, which the database rejected as user ids.
  const team = useTeam();
  const [projects, setProjects] = useState<Project[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [codeTouched, setCodeTouched] = useState(false);
  const [lightbox, setLightbox] = useState<{ images: string[]; index: number } | null>(null);
  const autoCode = (name: string) => name.trim() ? name.split(" ").filter(Boolean).map((w) => w[0]).join("").toUpperCase().slice(0, 4) + "-" + String(projects.length + 1).padStart(2, "0") : "";
  const [actionMenu, setActionMenu] = useState<string | null>(null);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [form, setForm] = useState<ProjectForm>({ name: "", code: "", city: "", lat: null, lng: null, description: "", valueCurrency: "KSh", valueAmount: "", status: "Planning", progress: 0, changeOrders: 0, exposureCurrency: "KSh", exposureAmount: "0", images: [], pm: NO_MEMBER, architect: NO_MEMBER, qs: NO_MEMBER, checklist: { items: [] } });
  const [editForm, setEditForm] = useState<ProjectForm | null>(null);
  // Uploads for the New and Edit dialogs. Each appends only the URLs that
  // actually stored, so a partial failure keeps the successful images.
  const newImages = useFileUpload({
    onUploaded: (urls) => setForm((s) => ({ ...s, images: [...s.images, ...urls] })),
  });
  const editImages = useFileUpload({
    onUploaded: (urls) => setEditForm((s) => (s ? { ...s, images: [...s.images, ...urls] } : s)),
  });
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    details: true, progress: true, team: true, images: true, checklist: false,
  });
  // Tracks whether the backend has responded — lets us tell a genuinely empty
  // workspace (show empty state) apart from "backend offline" (keep seed demo).
  const [apiLoaded, setApiLoaded] = useState(false);
  // Why the list is empty, when it is empty because the load failed.
  const [loadError, setLoadError] = useState<string | null>(null);
  // Map a backend row to the card model. `id` is carried through — it was
  // dropped before, which left every loaded project without one, so edit and
  // delete fell back to matching on `code` and any code change silently created
  // a second project instead of updating the first.
  const fromDto = (p: any): Project => {
    // Real uploaded photos, resolved to absolute URLs. Legacy rows stored a bare
    // "/uploads/…" path that only worked if the API and app shared an origin.
    const images = (Array.isArray(p.images) ? p.images : [])
      .map((u: string) => absoluteFileUrl(u))
      .filter(Boolean);
    return {
      id: p.id,
      name: p.name,
      targetEndDate: p.targetEndDate ?? null,
      code: p.code,
      city: p.city,
      lat: p.lat ?? null,
      lng: p.lng ?? null,
      description: p.description ?? "",
      value: p.value,
      // Convert using the currency the stored string carries, not a blanket x130.
      valueKES: p.valueKES ?? moneyStringToKES(p.value || "0"),
      status: p.status,
      progress: p.progress,
      changeOrders: p.changeOrderCount ?? 0,
      exposure: p.exposure ?? "+$0",
      exposureKES: p.exposureKES ?? moneyStringToKES(p.exposure || "0"),
      // Fall back to the stock photo only for display; it is never written back,
      // so an unphotographed project doesn't acquire a fake image on next save.
      img: images[0] || DEFAULT_PROJECT_IMG,
      images,
      pm: p.assignments?.find((a: any) => a.role === "PM")?.userId || "None",
      architect: p.assignments?.find((a: any) => a.role === "Architect")?.userId || "None",
      qs: p.assignments?.find((a: any) => a.role === "QS")?.userId || "None",
    };
  };

  const reloadProjects = async () => {
    try {
      const data = await api.getProjects();
      setProjects((data ?? []).map(fromDto));
      setApiLoaded(true);
      setLoadError(null);
      // Keep the shared project dropdowns (Daily Log, Action Plans, Crews, …) in
      // step, so a project created here is immediately selectable there.
      refreshProjects();
    } catch (e: any) {
      // Show nothing and say why. This used to substitute six invented demo
      // projects ("Harborfront Tower", "Midtown Medical", …) whenever the backend
      // was unreachable, so an outage looked like a populated — but entirely
      // fictional — workspace, and any edit to those rows went nowhere.
      setProjects([]);
      setApiLoaded(true);
      setLoadError(e?.message || "the server is unreachable");
    }
  };
  useEffect(() => { reloadProjects(); }, []);

  // Returning from the detail page's "Edit project": open the dialog once the
  // list has the project, then clear the request so it doesn't re-trigger.
  useEffect(() => {
    if (!openEditProjectId || !projects.length) return;
    const hit = projects.find((p) => p.id === openEditProjectId);
    if (hit) openEdit(hit);
    onConsumeEditProjectId?.();
  }, [openEditProjectId, projects]);
  // Recent change orders for the "Recent Activity" panel (real data; empty for a
  // fresh workspace). Loaded once on mount.
  const [recentCOs, setRecentCOs] = useState<any[] | null>(null);
  const [projectNameById, setProjectNameById] = useState<Record<string, string>>({});
  useEffect(() => {
    api.getProjects().then((ps) => {
      const map: Record<string, string> = {};
      (ps ?? []).forEach((p) => { map[p.id] = p.name; });
      setProjectNameById(map);
    }).catch(() => {});
    api.listChangeOrders().then((cos) => {
      setRecentCOs(Array.isArray(cos) ? cos : []);
    }).catch(() => setRecentCOs([]));
  }, []);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [statusFilters, setStatusFilters] = useState<string[]>([]);
  const [minProgress, setMinProgress] = useState("");
  const [maxProgress, setMaxProgress] = useState("");
  const [highExposureOnly, setHighExposureOnly] = useState(false);
  const [highCOOnly, setHighCOOnly] = useState(false);

  const activeFilterCount = statusFilters.length
    + (minProgress ? 1 : 0)
    + (maxProgress ? 1 : 0)
    + (highExposureOnly ? 1 : 0)
    + (highCOOnly ? 1 : 0);

  // Drill into a project's own dashboard. A project that only exists locally
  // (backend offline, or the seed fallback) has no id and therefore no server
  // record to load — say so rather than opening a page that can only error.
  const openProject = (project: Project) => {
    if (!project.id) {
      toast.error("This project isn't saved on the server yet, so it has no dashboard. Reload and try again.");
      return;
    }
    if (!onOpenProject) {
      toast.error("Project details aren't available here.");
      return;
    }
    onOpenProject(project.id);
  };

  const openEdit = (project: Project) => {
    const parsedExposure = parseExposure(project.exposure);
    const parsedValue = parseValue(project.value);
    editImages.reset();
    setEditingProject(project);
    const normalizedChecklist: Checklist = {
      items: (project.checklist?.items ?? []).map((i) => ({
        ...i,
        status: (i as any).status ?? "open",
      })),
    };
    setEditForm({
      name: project.name,
      code: project.code,
      city: project.city,
      description: project.description ?? "",
      valueCurrency: parsedValue.currency,
      valueAmount: parsedValue.amount,
      status: project.status,
      progress: project.progress,
      changeOrders: project.changeOrders,
      exposureCurrency: parsedExposure.currency,
      exposureAmount: parsedExposure.amount,
      // Only the project's real photos. Seeding this with `project.img` pulled in
      // the stock placeholder, which then got saved back as if it were an upload.
      images: [...project.images],
      pm: project.pm,
      architect: project.architect,
      qs: project.qs,
      checklist: normalizedChecklist,
    });
    setExpandedSections({ details: true, progress: true, team: true, images: true, checklist: false });
    setActionMenu(null);
  };

  // Create the project on the server FIRST, then update the list from the row it
  // returns. The old version optimistically added a card, fired the request, and
  // swallowed any error — so a rejected save (duplicate code, offline, validation)
  // still showed "Project created" and a card that vanished on the next reload.
  const [saving, setSaving] = useState(false);

  // Persist the Team section. Every role is sent — including the ones left on
  // "None", so clearing a role actually removes the member rather than leaving
  // the previous holder attached. A failure here is reported instead of swallowed:
  // the old code used Promise.allSettled and then said "Project updated", so a
  // rejected team save looked exactly like a successful one.
  const saveTeam = async (
    pid: string,
    src: { pm: string; architect: string; qs: string },
    verb: "created" | "updated",
  ) => {
    try {
      await api.setAssignments(pid, [
        { role: "PM", userId: src.pm === "None" ? null : src.pm },
        { role: "Architect", userId: src.architect === "None" ? null : src.architect },
        { role: "QS", userId: src.qs === "None" ? null : src.qs },
      ]);
    } catch (e: any) {
      toast.error(`Project ${verb}, but the team could not be saved — ${e?.message || "unknown error"}`, { duration: 8000 });
    }
  };

  const createProject = async () => {
    if (!form.name.trim()) return toast.error("Project name is required");
    if (saving) return;
    const code = form.code.trim() || form.name.slice(0, 3).toUpperCase() + "-" + Math.floor(Math.random() * 90 + 10);
    // Only durable server URLs are persisted. A blob: preview would render once
    // and be dead everywhere else.
    const images = form.images.filter((u) => u && !u.startsWith("blob:") && !u.startsWith("data:"));
    setSaving(true);
    try {
      const created = await api.createProject({
        code,
        name: form.name.trim(),
        city: form.city.trim() || "—",
        lat: form.lat ?? null,
        lng: form.lng ?? null,
        value: formatValue(form.valueCurrency, form.valueAmount),
        status: form.status,
        progress: form.progress || 0,
        exposure: formatExposure(form.exposureCurrency, form.exposureAmount),
        description: form.description.trim(),
        images,
      } as any);
      const pid = (created as any).id;
      // One call that sets each role, so re-saving replaces the holder instead of
      // stacking duplicate rows. The project itself is already stored, so a team
      // failure must not read as "the project wasn't created" — but it must not be
      // silent either, which is what Promise.allSettled did here.
      await saveTeam(pid, form, "created");
      await reloadProjects();
      setForm({ name: "", code: "", city: "", lat: null, lng: null, description: "", valueCurrency: "KSh", valueAmount: "", status: "Planning", progress: 0, changeOrders: 0, exposureCurrency: "KSh", exposureAmount: "0", images: [], pm: NO_MEMBER, architect: NO_MEMBER, qs: NO_MEMBER, checklist: { items: [] } });
      newImages.reset();
      setShowNew(false);
      toast.success(`Project ${form.name.trim()} created`);
    } catch (e: any) {
      // The form stays open with the entered values so nothing is retyped.
      toast.error(`Could not create the project — ${e?.message || "unknown error"}`, { duration: 8000 });
    } finally {
      setSaving(false);
    }
  };

  const saveEdit = async () => {
    if (!editingProject || !editForm) return;
    if (!editForm.name.trim()) return toast.error("Project name is required");
    if (saving) return;
    // Only durable URLs are persisted; the stock placeholder is display-only and
    // must never be written back as if it were an uploaded photo.
    const images = editForm.images.filter((u) => u && u !== DEFAULT_PROJECT_IMG && !u.startsWith("blob:") && !u.startsWith("data:"));
    const pid = editingProject.id;
    // Without a real id there is nothing to update on the server. Say so rather
    // than pretending the change was saved — which is what previously happened
    // when a project loaded without an id and the fallback used its code.
    if (!pid) {
      toast.error("This project has no server record yet — reload the page and try again.");
      return;
    }
    setSaving(true);
    try {
      await api.updateProject(pid, {
        code: editForm.code.trim() || editingProject.code,
        name: editForm.name.trim(),
        city: editForm.city.trim() || "—",
        description: editForm.description.trim(),
        value: formatValue(editForm.valueCurrency, editForm.valueAmount),
        status: editForm.status,
        progress: Number.isFinite(editForm.progress) ? editForm.progress : editingProject.progress,
        exposure: formatExposure(editForm.exposureCurrency, editForm.exposureAmount),
        images,
      } as any);
      await saveTeam(pid, editForm, "updated");
      await reloadProjects();
      setEditingProject(null);
      setEditForm(null);
      editImages.reset();
      toast.success("Project updated");
    } catch (e: any) {
      toast.error(`Could not save the project — ${e?.message || "unknown error"}`, { duration: 8000 });
    } finally {
      setSaving(false);
    }
  };

  const updateProjectStatus = (code: string, status: string) => {
    setProjects((prev) => prev.map((project) => project.code === code ? { ...project, status } : project));
    toast.success(`Status updated to ${status}`);
    setActionMenu(null);
    const target = projects.find((p) => p.code === code);
    if (target?.id) {
      api.updateProject(target.id as any, { status }).catch(warnSaveFailed("project update"));
    }
  };

  const minProgressValue = minProgress === "" ? null : Number(minProgress);
  const maxProgressValue = maxProgress === "" ? null : Number(maxProgress);

  // KPI header values derived from the actually-loaded projects (zero/empty for
  // a fresh workspace — no hardcoded demo counts).
  const activeProjectsCount = projects.filter((p) => IN_PROGRESS_STATUSES.includes(p.status)).length;
  const combinedValueKES = projects.reduce((sum, p) => sum + (p.valueKES ?? 0), 0);
  const combinedValueLabel = combinedValueKES > 0 ? formatCompactCurrency(combinedValueKES, currency) : "—";
  const coExposureKES = projects.reduce((sum, p) => sum + (p.exposureKES ?? 0), 0);
  const coExposureLabel = coExposureKES > 0 ? formatCompactCurrency(coExposureKES, currency) : "—";
  const healthy = projects.filter((p) => HEALTHY_STATUSES.includes(p.status)).length;
  const projectHealthLabel = projects.length > 0 ? `${Math.round((healthy / projects.length) * 100)}%` : "—";

  const filtered = projects.filter((p) => {
    const matchesTab = tab === "All"
      || (tab === "Active" && IN_PROGRESS_STATUSES.includes(p.status))
      || tab === p.status;
    if (!matchesTab) return false;
    if (query) {
      const haystack = `${p.name} ${p.code} ${p.city}`.toLowerCase();
      if (!haystack.includes(query.toLowerCase())) return false;
    }
    if (statusFilters.length > 0 && !statusFilters.includes(p.status)) return false;
    if (minProgressValue !== null && p.progress < minProgressValue) return false;
    if (maxProgressValue !== null && p.progress > maxProgressValue) return false;
    if (highExposureOnly && parseCompactValue(p.exposure) < 1_000_000) return false;
    if (highCOOnly && p.changeOrders < 25) return false;
    return true;
  });

  return (
    <div
      className="px-4 sm:px-7 py-5 sm:py-6 space-y-5"
      onClick={() => {
        setActionMenu(null);
        setFiltersOpen(false);
      }}
    >
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {[
          { l: "Active Projects", v: String(activeProjectsCount), s: "sites & jobs in progress" },
          { l: "Combined Value", v: combinedValueLabel, s: "in active contracts" },
          { l: "CO Exposure", v: coExposureLabel, s: "across your projects", c: "text-[#FF6B1A]" },
          { l: "Project Health", v: projectHealthLabel, s: "on or ahead of schedule", c: "text-[#22C55E]" },
        ].map((s) => (
          <div key={s.l} className="rounded-xl border border-[#222A35] bg-[#11161D] p-4">
            <div className="text-[11px] text-[#8A95A5]">{s.l}</div>
            <div className={`text-[20px] sm:text-[22px] mt-1 font-display ${s.c || "text-white"}`}>{s.v}</div>
            <div className="text-[10px] text-[#5B6675] mt-0.5">{s.s}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex gap-1 overflow-x-auto pb-1">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 h-8 rounded-md text-[12px] whitespace-nowrap ${tab === t ? "bg-[#161C24] text-white border border-[#222A35]" : "text-[#8A95A5] hover:text-white"}`}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter projects..."
            className="flex-1 lg:flex-none lg:w-[180px] h-8 px-3 rounded-md bg-[#11161D] border border-[#222A35] text-[12px] text-white placeholder:text-[#5B6675] focus:outline-none focus:border-[#FF6B1A]"
          />
          <div className="relative" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setFiltersOpen((prev) => !prev)}
              className={`h-8 px-3 rounded-md border text-[12px] flex items-center gap-1.5 ${activeFilterCount ? "border-[#FF6B1A]/60 text-white" : "border-[#222A35] text-[#8A95A5] hover:text-white"}`}
            >
              <Filter className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Filters</span>
              {activeFilterCount > 0 && (
                <span className="ml-1 rounded-full bg-[#FF6B1A] text-white text-[10px] px-1.5">{activeFilterCount}</span>
              )}
            </button>
            {filtersOpen && (
              <div className="absolute right-0 mt-2 w-72 rounded-xl border border-[#222A35] bg-[#0A0E14] shadow-2xl text-[11px] text-[#8A95A5] overflow-hidden z-20">
                <div className="px-4 py-3 text-[10px] uppercase tracking-wider text-[#5B6675]">Status</div>
                <div className="px-4 pb-3 grid grid-cols-2 gap-2">
                  {STATUS_FILTERS.map((status) => (
                    <label key={status} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={statusFilters.includes(status)}
                        onChange={() => setStatusFilters((prev) => prev.includes(status)
                          ? prev.filter((s) => s !== status)
                          : [...prev, status]
                        )}
                        className="h-3.5 w-3.5 accent-[#FF6B1A]"
                      />
                      <span className="text-[#E6EAF0]">{status}</span>
                    </label>
                  ))}
                </div>
                <div className="border-t border-[#222A35] px-4 py-3">
                  <div className="text-[10px] uppercase tracking-wider text-[#5B6675]">Progress %</div>
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={minProgress}
                      onChange={(e) => setMinProgress(e.target.value)}
                      placeholder="Min"
                      className="h-8 px-2 rounded-md bg-[#11161D] border border-[#222A35] text-[11px] text-white focus:outline-none focus:border-[#FF6B1A]"
                    />
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={maxProgress}
                      onChange={(e) => setMaxProgress(e.target.value)}
                      placeholder="Max"
                      className="h-8 px-2 rounded-md bg-[#11161D] border border-[#222A35] text-[11px] text-white focus:outline-none focus:border-[#FF6B1A]"
                    />
                  </div>
                </div>
                <div className="border-t border-[#222A35] px-4 py-3 space-y-2">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={highExposureOnly}
                      onChange={(e) => setHighExposureOnly(e.target.checked)}
                      className="h-3.5 w-3.5 accent-[#FF6B1A]"
                    />
                    <span className="text-[#E6EAF0]">High exposure (&gt; $1M)</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={highCOOnly}
                      onChange={(e) => setHighCOOnly(e.target.checked)}
                      className="h-3.5 w-3.5 accent-[#FF6B1A]"
                    />
                    <span className="text-[#E6EAF0]">High change orders (25+)</span>
                  </label>
                </div>
                <div className="border-t border-[#222A35] px-4 py-3 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => {
                      setStatusFilters([]);
                      setMinProgress("");
                      setMaxProgress("");
                      setHighExposureOnly(false);
                      setHighCOOnly(false);
                    }}
                    className="text-[11px] text-[#8A95A5] hover:text-white"
                  >
                    Clear filters
                  </button>
                  <button
                    type="button"
                    onClick={() => setFiltersOpen(false)}
                    className="text-[11px] text-[#FF6B1A] hover:text-[#FF7E33]"
                  >
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>
          <div className="flex border border-[#222A35] rounded-md overflow-hidden">
            <button onClick={() => setLayout("grid")} className={`h-8 w-8 flex items-center justify-center ${layout === "grid" ? "bg-[#161C24] text-white" : "text-[#8A95A5]"}`}>
              <LayoutGrid className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => setLayout("list")} className={`h-8 w-8 flex items-center justify-center ${layout === "list" ? "bg-[#161C24] text-white" : "text-[#8A95A5]"}`}>
              <List className="w-3.5 h-3.5" />
            </button>
          </div>
          <button onClick={() => { setCodeTouched(false); setShowNew(true); }} className="h-8 px-3 rounded-md bg-[#FF6B1A] text-white text-[12px] flex items-center gap-1.5">
            <Plus className="w-3.5 h-3.5" /> <span className="hidden sm:inline">New</span>
          </button>
        </div>
      </div>

      {!apiLoaded ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-64 rounded-xl border border-[#222A35] bg-[#11161D] animate-pulse" />
          ))}
        </div>
      ) : projects.length === 0 ? (
        <div className="rounded-xl border border-[#222A35] bg-[#11161D]">
          {loadError ? (
            <EmptyState
              icon={SearchX}
              title="Your projects could not be loaded"
              description={`${loadError}. Nothing has been lost — reload once the connection is back.`}
              actionLabel="Try again"
              onAction={reloadProjects}
            />
          ) : (
            <EmptyState
              icon={FolderKanban}
              title="No projects yet"
              description="A project is a single site or job. Create your first one to start tracking checklists, drawings, and progress."
              actionLabel="Create your first project"
              onAction={() => setShowNew(true)}
            />
          )}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-[#222A35] bg-[#11161D]">
          <EmptyState
            icon={SearchX}
            title="No projects match your filters"
            description="Try adjusting your search or clearing the active filters."
            actionLabel="Clear filters"
            onAction={() => { setQuery(""); setTab("All"); setStatusFilters([]); setMinProgress(""); setMaxProgress(""); setHighExposureOnly(false); setHighCOOnly(false); }}
          />
        </div>
      ) : layout === "grid" ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((p) => {
            const cover = p.images[0] ?? p.img;
            const menuOpen = actionMenu === p.code;

            return (
            <button
              key={p.code}
              // Clicking a card now opens the project's own dashboard. It used to
              // jump straight into the edit dialog, so there was no way to simply
              // look at a project. Editing is on the ⋯ menu.
              onClick={() => openProject(p)}
              className="text-left rounded-xl border border-[#222A35] bg-[#11161D] overflow-visible hover:border-[#FF6B1A]/50 transition group relative"
            >
              <div className="relative h-[140px] overflow-hidden rounded-t-xl">
                <ImageWithFallback src={cover} alt={p.name} className="w-full h-full object-cover group-hover:scale-105 transition duration-500" />
                <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent" />
                <span className={`absolute top-3 left-3 px-2 py-0.5 rounded-full text-[10px] border ${statusColor(p.status)}`}>{p.status}</span>
                <div className="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black/80 to-transparent">
                  <div className="text-[10px] text-white font-mono" style={{ color: '#ffffff', textShadow: '0 1px 3px rgba(0,0,0,1)' }}>{p.code}</div>
                  <div className="text-[15px] text-white tracking-tight font-display" style={{ color: '#ffffff', textShadow: '0 2px 4px rgba(0,0,0,1)' }}>{p.name}</div>
                </div>
              </div>
              <div className="absolute top-3 right-3 z-30" onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setActionMenu((prev) => prev === p.code ? null : p.code);
                  }}
                  className="w-7 h-7 rounded-md bg-black/60 backdrop-blur text-white border border-white/20 shadow-lg flex items-center justify-center hover:bg-black/80"
                >
                  <MoreHorizontal className="w-3.5 h-3.5 text-white" style={{ color: '#ffffff' }} />
                </button>
                {menuOpen && (
                  <div className="absolute right-0 mt-2 w-44 rounded-md border border-[#222A35] bg-[#0F141B] shadow-2xl text-[12px] text-[#C2CAD6] overflow-hidden">
                    <button
                      type="button"
                      onClick={() => { setActionMenu(null); openProject(p); }}
                      className="w-full text-left px-3 py-2 hover:bg-[#161C24] hover:text-white whitespace-nowrap"
                    >
                      View details
                    </button>
                    <button
                      type="button"
                      onClick={() => openEdit(p)}
                      className="w-full text-left px-3 py-2 hover:bg-[#161C24] hover:text-white whitespace-nowrap"
                    >
                      Edit project
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setView("change-order");
                        toast(`Opened change orders for ${p.name}`);
                        setActionMenu(null);
                      }}
                      className="w-full text-left px-3 py-2 hover:bg-[#161C24] hover:text-white whitespace-nowrap"
                    >
                      Open change orders
                    </button>
                    <button
                      type="button"
                      onClick={() => updateProjectStatus(p.code, "At Risk")}
                      className="w-full text-left px-3 py-2 hover:bg-[#161C24] hover:text-white whitespace-nowrap"
                    >
                      Mark at risk
                    </button>
                    <button
                      type="button"
                      onClick={() => updateProjectStatus(p.code, "Archived")}
                      className="w-full text-left px-3 py-2 hover:bg-[#161C24] hover:text-white whitespace-nowrap"
                    >
                      Archive project
                    </button>
                  </div>
                )}
              </div>
              <div className="p-4 space-y-3">
                <div className="flex items-center gap-3 text-[11px] text-[#8A95A5]">
                  <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{p.city}</span>
                  {p.targetEndDate && <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{new Date(p.targetEndDate).toLocaleDateString(undefined, { month: "short", year: "numeric" })}</span>}
                </div>
                {p.description && <div className="text-[11px] text-[#8A95A5] line-clamp-2">{p.description}</div>}
                <div className="flex flex-wrap gap-1.5 text-[10px] text-[#C2CAD6]">
                  {p.pm !== "None" && <span className="px-2 py-1 rounded-md bg-[#222A35] flex items-center gap-1"><UserCircle className="w-3 h-3" />PM: {resolveName(p.pm)}</span>}
                  {p.architect !== "None" && <span className="px-2 py-1 rounded-md bg-[#222A35] flex items-center gap-1"><UserCircle className="w-3 h-3" />Arch: {resolveName(p.architect)}</span>}
                  {p.qs !== "None" && <span className="px-2 py-1 rounded-md bg-[#222A35] flex items-center gap-1"><UserCircle className="w-3 h-3" />QS: {resolveName(p.qs)}</span>}
                </div>
                <div>
                  <div className="flex items-center justify-between text-[11px] mb-1.5">
                    <span className="text-[#8A95A5]">Schedule</span>
                    <span className="text-white">{p.progress}%</span>
                  </div>
                  <div className="h-1.5 bg-[#222A35] rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-[#FF6B1A] to-[#FF8A4A] rounded-full" style={{ width: `${p.progress}%` }} />
                  </div>
                </div>
                {p.checklist && p.checklist.items.length > 0 && (
                  <div className="flex items-center gap-1.5 text-[10px] text-[#8A95A5]">
                    <ClipboardList className="w-3 h-3 text-[#3B82F6]" />
                    {p.checklist.items.length} checklist {p.checklist.items.length === 1 ? "item" : "items"}
                    <span className="text-[#5B6675]">·</span>
                    <span className="text-[#22C55E]">{p.checklist.items.filter((i) => i.status === "done").length} done</span>
                    <span className="text-[#5B6675]">·</span>
                    <span className="text-[#F5A623]">{p.checklist.items.filter((i) => i.assignedTo.length > 0).length} assigned</span>
                  </div>
                )}
                <div className={`grid gap-2 pt-2 border-t border-[#222A35] ${showFin ? "grid-cols-3" : "grid-cols-2"}`}>
                  <div>
                    <div className="text-[10px] text-[#5B6675] uppercase tracking-wider">Value</div>
                    <div className="text-[13px] text-white mt-0.5">{p.valueKES ? formatCompactCurrency(p.valueKES, currency) : p.value}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-[#5B6675] uppercase tracking-wider">COs</div>
                    <div className="text-[13px] text-white mt-0.5 flex items-center gap-1">{p.changeOrders} {p.changeOrders > 25 && <AlertCircle className="w-3 h-3 text-[#F5A623]" />}</div>
                  </div>
                  {showFin && (
                  <div>
                    <div className="text-[10px] text-[#5B6675] uppercase tracking-wider">Exposure</div>
                    <div className="text-[13px] text-[#FF6B1A] mt-0.5 flex items-center gap-1"><TrendingUp className="w-3 h-3" />{p.exposureKES ? formatCompactCurrency(p.exposureKES, currency) : p.exposure}</div>
                  </div>
                  )}
                </div>
              </div>
            </button>
          );
          })}
        </div>
      ) : (
        <div className="rounded-xl border border-[#222A35] bg-[#11161D] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px]">
              <thead>
                <tr className="text-[10px] text-[#5B6675] uppercase tracking-wider">
                  <th className="text-left px-5 py-2.5">Project</th>
                  <th className="text-left px-3 py-2.5">Status</th>
                  <th className="text-left px-3 py-2.5">City</th>
                  <th className="text-left px-3 py-2.5">Team</th>
                  <th className="text-right px-3 py-2.5">Value</th>
                  <th className="text-right px-3 py-2.5">Progress</th>
                  <th className="text-right px-5 py-2.5">Actions</th>
                </tr>
              </thead>
              <tbody className="text-[12px]">
                {filtered.map((p) => (
                  <tr key={p.code} onClick={() => openProject(p)} className="border-t border-[#222A35] hover:bg-[#161C24] cursor-pointer">
                    <td className="px-5 py-3 text-white">{p.name}</td>
                    <td className="px-3 py-3"><span className={`px-2 py-0.5 rounded-full text-[10px] border ${statusColor(p.status)}`}>{p.status}</span></td>
                    <td className="px-3 py-3 text-[#8A95A5]">{p.city}</td>
                    <td className="px-3 py-3 text-[#8A95A5] text-[11px]">
                      {p.pm !== "None" && <div>PM: {resolveName(p.pm)}</div>}
                      {p.architect !== "None" && <div>Arch: {resolveName(p.architect)}</div>}
                      {p.qs !== "None" && <div>QS: {resolveName(p.qs)}</div>}
                      {p.pm === "None" && p.architect === "None" && p.qs === "None" && <div className="text-[#5B6675]">—</div>}
                    </td>
                    <td className="px-3 py-3 text-right text-white">{p.valueKES ? formatCompactCurrency(p.valueKES, currency) : p.value}</td>
                    <td className="px-3 py-3 text-right text-[#FF6B1A]">{p.progress}%</td>
                    <td className="px-5 py-3 text-right">
                      {/* Row click opens the dashboard, so editing needs its own
                          affordance here — previously the list had no way to
                          reach anything but the edit dialog. */}
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); openEdit(p); }}
                        className="text-[11px] text-[#8A95A5] hover:text-white"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}


      <div className="rounded-xl border border-[#222A35] bg-[#11161D] overflow-hidden">
        <div className="px-5 py-4 border-b border-[#222A35] flex items-center justify-between">
          <div>
            <div className="text-[13px] text-white font-display">Recent Activity</div>
            <div className="text-[11px] text-[#8A95A5]">Latest change orders</div>
          </div>
          <button onClick={() => setView("change-order")} className="text-[11px] text-[#FF6B1A] hover:underline">View all</button>
        </div>
        {recentCOs && recentCOs.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <div className="text-[13px] text-white font-display">No recent activity yet</div>
            <div className="text-[11px] text-[#8A95A5] mt-1">Change orders you create will show up here.</div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px]">
              <thead>
                <tr className="text-[10px] text-[#5B6675] uppercase tracking-wider">
                  <th className="text-left px-5 py-2.5">Project</th>
                  <th className="text-left px-3 py-2.5">CO #</th>
                  <th className="text-left px-3 py-2.5">Description</th>
                  <th className="text-left px-3 py-2.5">Status</th>
                  <th className="text-right px-5 py-2.5">Amount</th>
                </tr>
              </thead>
              <tbody className="text-[12px]">
                {[...(recentCOs ?? [])]
                  .sort((a, b) => +new Date(b.submittedDate ?? 0) - +new Date(a.submittedDate ?? 0))
                  .slice(0, 5)
                  .map((co) => {
                    const display = CO_STATUS_DISPLAY[co.status] ?? { label: co.status ?? "—", color: "#5B6675" };
                    return (
                      <tr key={co.id ?? co.number} onClick={() => setView("change-order")} className="border-t border-[#222A35] hover:bg-[#161C24] cursor-pointer">
                        <td className="px-5 py-3 text-white">{projectNameById[co.projectId] ?? "—"}</td>
                        <td className="px-3 py-3 text-[#8A95A5] font-mono text-[11px]">{co.number ?? "—"}</td>
                        <td className="px-3 py-3 text-[#8A95A5]">{co.title ?? "—"}</td>
                        <td className="px-3 py-3"><span className="px-2 py-0.5 rounded-full text-[10px]" style={{ background: `${display.color}20`, color: display.color }}>{display.label}</span></td>
                        <td className="px-5 py-3 text-right text-[#FF6B1A]">{formatCurrency($toKES(Number(co.costUSD) || 0), currency)}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showNew && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start sm:items-center justify-center p-4 overflow-y-auto" onClick={() => setShowNew(false)}>
          <div className="w-full max-w-[480px] max-h-[calc(100vh-2rem)] sm:max-h-[calc(100vh-3rem)] overflow-y-auto rounded-xl border border-[#222A35] bg-[#11161D] p-5 sm:p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-[15px] text-white font-display">New Project</div>
                <div className="text-[11px] text-[#8A95A5]">Create a new project workspace</div>
              </div>
              <button onClick={() => setShowNew(false)} className="w-7 h-7 rounded-md text-[#8A95A5] hover:text-white hover:bg-[#161C24] flex items-center justify-center">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-[11px] text-[#8A95A5] block mb-1">Project name *</label>
                <input value={form.name} onChange={(e) => { const name = e.target.value; setForm((f) => ({ ...f, name, code: codeTouched ? f.code : autoCode(name) })); }} placeholder="e.g. Eastside Office Park" className="w-full h-9 px-3 rounded-md bg-[#0A0E14] border border-[#222A35] text-[13px] text-white placeholder:text-[#5B6675] focus:outline-none focus:border-[#FF6B1A]" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] text-[#8A95A5] block mb-1">Project code <span className="text-[#5B6675] font-normal">(auto or edit)</span></label>
                  <input value={form.code} onChange={(e) => { setCodeTouched(true); setForm({ ...form, code: e.target.value }); }} placeholder="auto — type a name" className="w-full h-9 px-3 rounded-md bg-[#0A0E14] border border-[#222A35] text-[13px] text-white placeholder:text-[#5B6675] focus:outline-none focus:border-[#FF6B1A]" />
                </div>
                <div>
                  <label className="text-[11px] text-[#8A95A5] block mb-1">Contract value</label>
                  <div className="flex gap-2">
                    <select
                      value={form.valueCurrency}
                      onChange={(e) => setForm({ ...form, valueCurrency: e.target.value })}
                      className="h-9 px-2 rounded-md bg-[#0A0E14] border border-[#222A35] text-[13px] text-white focus:outline-none focus:border-[#FF6B1A]"
                    >
                      {CURRENCY_OPTIONS.map((currency) => (
                        <option key={currency} value={currency}>{currency}</option>
                      ))}
                    </select>
                    <input
                      value={form.valueAmount}
                      onChange={(e) => setForm({ ...form, valueAmount: e.target.value })}
                      placeholder="50M"
                      className="flex-1 h-9 px-3 rounded-md bg-[#0A0E14] border border-[#222A35] text-[13px] text-white placeholder:text-[#5B6675] focus:outline-none focus:border-[#FF6B1A]"
                    />
                  </div>
                </div>
              </div>
              <div>
                <label className="text-[11px] text-[#8A95A5] block mb-1">Location</label>
                <MapPicker
                  value={form.city}
                  latLng={form.lat != null && form.lng != null ? { lat: form.lat, lng: form.lng } : null}
                  onChange={(city) => setForm((prev) => ({ ...prev, city }))}
                  onLatLngChange={(latLng) => setForm((prev) => ({ ...prev, lat: latLng?.lat ?? null, lng: latLng?.lng ?? null }))}
                />
              </div>
              <div>
                <label className="text-[11px] text-[#8A95A5] block mb-1">Description</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Project scope, key milestones, notes..."
                  rows={3}
                  className="w-full px-3 py-2 rounded-md bg-[#0A0E14] border border-[#222A35] text-[13px] text-white placeholder:text-[#5B6675] focus:outline-none focus:border-[#FF6B1A] resize-y"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] text-[#8A95A5] block mb-1">Progress %</label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={form.progress}
                    onChange={(e) => setForm({ ...form, progress: Number(e.target.value) || 0 })}
                    className="w-full h-9 px-3 rounded-md bg-[#0A0E14] border border-[#222A35] text-[13px] text-white focus:outline-none focus:border-[#FF6B1A]"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-[#8A95A5] block mb-1">Active Change Orders</label>
                  <input
                    type="number"
                    min={0}
                    value={form.changeOrders}
                    onChange={(e) => setForm({ ...form, changeOrders: Number(e.target.value) || 0 })}
                    className="w-full h-9 px-3 rounded-md bg-[#0A0E14] border border-[#222A35] text-[13px] text-white focus:outline-none focus:border-[#FF6B1A]"
                  />
                  <div className="text-[10px] text-[#5B6675] mt-1">Count of change orders currently on this project</div>
                </div>
              </div>
              <div>
                <label className="text-[11px] text-[#8A95A5] block mb-1">Exposure</label>
                <div className="flex gap-2">
                  <select
                    value={form.exposureCurrency}
                    onChange={(e) => setForm({ ...form, exposureCurrency: e.target.value })}
                    className="h-9 px-2 rounded-md bg-[#0A0E14] border border-[#222A35] text-[13px] text-white focus:outline-none focus:border-[#FF6B1A]"
                  >
                    {CURRENCY_OPTIONS.map((currency) => (
                      <option key={currency} value={currency}>{currency}</option>
                    ))}
                  </select>
                  <input
                    value={form.exposureAmount}
                    onChange={(e) => setForm({ ...form, exposureAmount: e.target.value })}
                    placeholder="2.4M"
                    className="flex-1 h-9 px-3 rounded-md bg-[#0A0E14] border border-[#222A35] text-[13px] text-white placeholder:text-[#5B6675] focus:outline-none focus:border-[#FF6B1A]"
                  />
                </div>
              </div>
              <div>
                <label className="text-[11px] text-[#8A95A5] block mb-1">Status</label>
                <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="w-full h-9 px-3 rounded-md bg-[#0A0E14] border border-[#222A35] text-[13px] text-white focus:outline-none focus:border-[#FF6B1A]">
                  <option>Planning</option>
                  <option>On Track</option>
                  <option>At Risk</option>
                  <option>Closing</option>
                  <option>Archived</option>
                </select>
              </div>
              <div className="rounded-md border border-[#222A35] bg-[#0A0E14] p-3 space-y-2">
                <div className="text-[10px] text-[#8A95A5] uppercase tracking-wider">Project team assignments</div>
                <div className="text-[10px] text-[#5B6675]">
                  These roles define who is responsible for the project. The PM runs day-to-day operations, the Architect handles design & drawings, and the QS manages budgets & cost control. They will be notified of project updates.
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <MemberSelect label="PM / Site lead" value={form.pm} onChange={(v) => setForm({ ...form, pm: v })} members={team} />
                  <MemberSelect label="Architect" value={form.architect} onChange={(v) => setForm({ ...form, architect: v })} members={team} />
                  <MemberSelect label="Quantity Surveyor" value={form.qs} onChange={(v) => setForm({ ...form, qs: v })} members={team} />
                </div>
              </div>
              <div>
                <label className="text-[11px] text-[#8A95A5] block mb-2">Project images</label>
                <label className="flex items-center gap-2 px-3 py-2 rounded-md border border-dashed border-[#222A35] bg-[#0A0E14] text-[11px] text-[#8A95A5] cursor-pointer hover:border-[#FF6B1A]/50 hover:text-white">
                  <ImagePlus className="w-4 h-4" />
                  <span>{form.images.length ? `${form.images.length} image${form.images.length === 1 ? "" : "s"} attached` : "Attach project images"}</span>
                  <span className="ml-auto flex items-center gap-1 text-[10px] text-[#5B6675]">
                    <UploadCloud className="w-3 h-3" /> Browse
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={(e) => {
                      const files = Array.from(e.target.files ?? []);
                      e.currentTarget.value = "";
                      // Every file reports its own outcome and previews while it
                      // uploads. Previously a single failure in Promise.all threw
                      // away the images that HAD uploaded and showed only a bare
                      // "Image upload failed".
                      newImages.upload(files);
                    }}
                    className="hidden"
                  />
                </label>
                <UploadTray state={newImages} />
                {form.images.length > 0 && (
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mt-3">
                    {form.images.map((src, idx) => (
                      <div key={`${src}-${idx}`} className="relative group">
                        <img src={src} alt="Project" onClick={() => setLightbox({ images: form.images, index: idx })} className={`h-16 w-full rounded-md object-cover border cursor-pointer ${idx === 0 ? "border-[#FF6B1A]" : "border-[#222A35]"}`} />
                        {idx === 0 && (
                          <div className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-[#FF6B1A] text-white text-[9px] font-medium flex items-center gap-0.5">
                            <Star className="w-2.5 h-2.5" /> Cover
                          </div>
                        )}
                        <div onClick={(e) => { if (e.target === e.currentTarget) setLightbox({ images: form.images, index: idx }); }} className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center gap-1 rounded-md cursor-pointer">
                          {idx !== 0 && (
                            <button
                              type="button"
                              title="Set as cover"
                              onClick={() => {
                                const reordered = [src, ...form.images.filter((_, i) => i !== idx)];
                                setForm({ ...form, images: reordered });
                              }}
                              className="w-6 h-6 rounded-full bg-[#FF6B1A] text-white flex items-center justify-center"
                            >
                              <Star className="w-3 h-3" />
                            </button>
                          )}
                          {idx > 0 && (
                            <button
                              type="button"
                              title="Shift left"
                              onClick={() => {
                                const arr = [...form.images];
                                [arr[idx], arr[idx - 1]] = [arr[idx - 1], arr[idx]];
                                setForm({ ...form, images: arr });
                              }}
                              className="w-6 h-6 rounded-full bg-black/70 text-white flex items-center justify-center"
                            >
                              <ChevronLeft className="w-3 h-3" />
                            </button>
                          )}
                          {idx < form.images.length - 1 && (
                            <button
                              type="button"
                              title="Shift right"
                              onClick={() => {
                                const arr = [...form.images];
                                [arr[idx], arr[idx + 1]] = [arr[idx + 1], arr[idx]];
                                setForm({ ...form, images: arr });
                              }}
                              className="w-6 h-6 rounded-full bg-black/70 text-white flex items-center justify-center"
                            >
                              <ChevronRightIcon className="w-3 h-3" />
                            </button>
                          )}
                          <button
                            type="button"
                            title="Remove"
                            onClick={() => setForm({ ...form, images: form.images.filter((_, i) => i !== idx) })}
                            className="w-6 h-6 rounded-full bg-[#EF4444] text-white flex items-center justify-center"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

            </div>
            <div className="flex items-center justify-end gap-2 mt-5">
              <button onClick={() => setShowNew(false)} className="h-9 px-3 rounded-md border border-[#222A35] text-[12px] text-[#8A95A5] hover:text-white">Cancel</button>
              <button onClick={createProject} disabled={saving || newImages.busy} title={newImages.busy ? "Waiting for the images to finish uploading" : undefined} className="h-9 px-4 rounded-md bg-[#FF6B1A] hover:bg-[#FF7E33] disabled:opacity-60 disabled:cursor-wait text-white text-[12px]">{saving ? "Creating…" : newImages.busy ? "Uploading images…" : "Create project"}</button>
            </div>
          </div>
        </div>
      )}
      {editingProject && editForm && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => { setEditingProject(null); setEditForm(null); }}>
          <div className="w-full max-w-[520px] max-h-[92vh] sm:max-h-[85vh] rounded-xl border border-[#222A35] bg-[#11161D] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
            {/* Sticky header */}
            <div className="flex items-center justify-between p-5 sm:p-6 pb-4 shrink-0">
              <div>
                <div className="text-[15px] text-white font-display">Edit Project</div>
                <div className="text-[11px] text-[#8A95A5]">Update project details and assets</div>
              </div>
              <button onClick={() => { setEditingProject(null); setEditForm(null); }} className="w-7 h-7 rounded-md text-[#8A95A5] hover:text-white hover:bg-[#161C24] flex items-center justify-center">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto px-5 sm:px-6 pb-2 space-y-2">
              {/* Section 1: Project Details */}
              <div className="rounded-lg border border-[#222A35] overflow-hidden">
                <button
                  type="button"
                  onClick={() => setExpandedSections((p) => ({ ...p, details: !p.details }))}
                  className="w-full flex items-center justify-between px-3 py-2.5 bg-[#0A0E14] text-left"
                >
                  <span className="text-[12px] text-white font-display">Project Details</span>
                  {expandedSections.details ? <ChevronDown className="w-3.5 h-3.5 text-[#5B6675]" /> : <ChevronRight className="w-3.5 h-3.5 text-[#5B6675]" />}
                </button>
                {expandedSections.details && (
                  <div className="p-3 space-y-3">
                    <div>
                      <label className="text-[11px] text-[#8A95A5] block mb-1">Project name *</label>
                      <input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} className="w-full h-9 px-3 rounded-md bg-[#0A0E14] border border-[#222A35] text-[13px] text-white focus:outline-none focus:border-[#FF6B1A]" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[11px] text-[#8A95A5] block mb-1">Project code</label>
                        <input value={editForm.code} onChange={(e) => setEditForm({ ...editForm, code: e.target.value })} className="w-full h-9 px-3 rounded-md bg-[#0A0E14] border border-[#222A35] text-[13px] text-white focus:outline-none focus:border-[#FF6B1A]" />
                      </div>
                      <div>
                        <label className="text-[11px] text-[#8A95A5] block mb-1">Contract value</label>
                        <div className="flex gap-2">
                          <select
                            value={editForm.valueCurrency}
                            onChange={(e) => setEditForm({ ...editForm, valueCurrency: e.target.value })}
                            className="h-9 px-2 rounded-md bg-[#0A0E14] border border-[#222A35] text-[13px] text-white focus:outline-none focus:border-[#FF6B1A]"
                          >
                            {CURRENCY_OPTIONS.map((currency) => (
                              <option key={currency} value={currency}>{currency}</option>
                            ))}
                          </select>
                          <input
                            value={editForm.valueAmount}
                            onChange={(e) => setEditForm({ ...editForm, valueAmount: e.target.value })}
                            placeholder="50M"
                            className="flex-1 h-9 px-3 rounded-md bg-[#0A0E14] border border-[#222A35] text-[13px] text-white placeholder:text-[#5B6675] focus:outline-none focus:border-[#FF6B1A]"
                          />
                        </div>
                      </div>
                    </div>
                    <div>
                      <label className="text-[11px] text-[#8A95A5] block mb-1">City</label>
                      <input value={editForm.city} onChange={(e) => setEditForm({ ...editForm, city: e.target.value })} className="w-full h-9 px-3 rounded-md bg-[#0A0E14] border border-[#222A35] text-[13px] text-white focus:outline-none focus:border-[#FF6B1A]" />
                    </div>
                    <div>
                      <label className="text-[11px] text-[#8A95A5] block mb-1">Description</label>
                      <textarea
                        value={editForm.description}
                        onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                        placeholder="Project scope, key milestones, notes..."
                        rows={3}
                        className="w-full px-3 py-2 rounded-md bg-[#0A0E14] border border-[#222A35] text-[13px] text-white placeholder:text-[#5B6675] focus:outline-none focus:border-[#FF6B1A] resize-y"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Section 2: Progress & Status */}
              <div className="rounded-lg border border-[#222A35] overflow-hidden">
                <button
                  type="button"
                  onClick={() => setExpandedSections((p) => ({ ...p, progress: !p.progress }))}
                  className="w-full flex items-center justify-between px-3 py-2.5 bg-[#0A0E14] text-left"
                >
                  <span className="text-[12px] text-white font-display">Progress & Status</span>
                  {expandedSections.progress ? <ChevronDown className="w-3.5 h-3.5 text-[#5B6675]" /> : <ChevronRight className="w-3.5 h-3.5 text-[#5B6675]" />}
                </button>
                {expandedSections.progress && (
                  <div className="p-3 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[11px] text-[#8A95A5] block mb-1">Progress %</label>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={editForm.progress}
                          onChange={(e) => setEditForm({ ...editForm, progress: Number(e.target.value) || 0 })}
                          className="w-full h-9 px-3 rounded-md bg-[#0A0E14] border border-[#222A35] text-[13px] text-white focus:outline-none focus:border-[#FF6B1A]"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] text-[#8A95A5] block mb-1">Active Change Orders</label>
                        <input
                          type="number"
                          min={0}
                          value={editForm.changeOrders}
                          onChange={(e) => setEditForm({ ...editForm, changeOrders: Number(e.target.value) || 0 })}
                          className="w-full h-9 px-3 rounded-md bg-[#0A0E14] border border-[#222A35] text-[13px] text-white focus:outline-none focus:border-[#FF6B1A]"
                        />
                        <div className="text-[10px] text-[#5B6675] mt-1">Count of change orders currently on this project</div>
                      </div>
                    </div>
                    <div>
                      <label className="text-[11px] text-[#8A95A5] block mb-1">Exposure</label>
                      <div className="flex gap-2">
                        <select
                          value={editForm.exposureCurrency}
                          onChange={(e) => setEditForm({ ...editForm, exposureCurrency: e.target.value })}
                          className="h-9 px-2 rounded-md bg-[#0A0E14] border border-[#222A35] text-[13px] text-white focus:outline-none focus:border-[#FF6B1A]"
                        >
                          {CURRENCY_OPTIONS.map((currency) => (
                            <option key={currency} value={currency}>{currency}</option>
                          ))}
                        </select>
                        <input
                          value={editForm.exposureAmount}
                          onChange={(e) => setEditForm({ ...editForm, exposureAmount: e.target.value })}
                          placeholder="2.4M"
                          className="flex-1 h-9 px-3 rounded-md bg-[#0A0E14] border border-[#222A35] text-[13px] text-white focus:outline-none focus:border-[#FF6B1A]"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="text-[11px] text-[#8A95A5] block mb-1">Status</label>
                      <select value={editForm.status} onChange={(e) => setEditForm({ ...editForm, status: e.target.value })} className="w-full h-9 px-3 rounded-md bg-[#0A0E14] border border-[#222A35] text-[13px] text-white focus:outline-none focus:border-[#FF6B1A]">
                        <option>Planning</option>
                        <option>On Track</option>
                        <option>At Risk</option>
                        <option>Closing</option>
                        <option>Archived</option>
                      </select>
                    </div>
                  </div>
                )}
              </div>

              {/* Section 3: Team */}
              <div className="rounded-lg border border-[#222A35] overflow-hidden">
                <button
                  type="button"
                  onClick={() => setExpandedSections((p) => ({ ...p, team: !p.team }))}
                  className="w-full flex items-center justify-between px-3 py-2.5 bg-[#0A0E14] text-left"
                >
                  <span className="text-[12px] text-white font-display">Team</span>
                  {expandedSections.team ? <ChevronDown className="w-3.5 h-3.5 text-[#5B6675]" /> : <ChevronRight className="w-3.5 h-3.5 text-[#5B6675]" />}
                </button>
                {expandedSections.team && (
                  <div className="p-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <MemberSelect dark label="PM / Site lead" value={editForm.pm} onChange={(v) => setEditForm({ ...editForm, pm: v })} members={team} />
                    <MemberSelect dark label="Architect" value={editForm.architect} onChange={(v) => setEditForm({ ...editForm, architect: v })} members={team} />
                    <MemberSelect dark label="Quantity Surveyor" value={editForm.qs} onChange={(v) => setEditForm({ ...editForm, qs: v })} members={team} />
                  </div>
                )}
              </div>

              {/* Section 4: Project Images */}
              <div className="rounded-lg border border-[#222A35] overflow-hidden">
                <button
                  type="button"
                  onClick={() => setExpandedSections((p) => ({ ...p, images: !p.images }))}
                  className="w-full flex items-center justify-between px-3 py-2.5 bg-[#0A0E14] text-left"
                >
                  <span className="text-[12px] text-white font-display">Project Images</span>
                  {expandedSections.images ? <ChevronDown className="w-3.5 h-3.5 text-[#5B6675]" /> : <ChevronRight className="w-3.5 h-3.5 text-[#5B6675]" />}
                </button>
                {expandedSections.images && (
                  <div className="p-3 space-y-3">
                    <label className="flex items-center gap-2 px-3 py-2 rounded-md border border-dashed border-[#222A35] bg-[#0A0E14] text-[11px] text-[#8A95A5] cursor-pointer hover:border-[#FF6B1A]/50 hover:text-white">
                      <ImagePlus className="w-4 h-4" />
                      <span>{editForm.images.length ? `${editForm.images.length} image${editForm.images.length === 1 ? "" : "s"} attached` : "Attach project images"}</span>
                      <span className="ml-auto flex items-center gap-1 text-[10px] text-[#5B6675]">
                        <UploadCloud className="w-3 h-3" /> Browse
                      </span>
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        onChange={(e) => {
                          const files = Array.from(e.target.files ?? []);
                          e.currentTarget.value = "";
                          editImages.upload(files);
                        }}
                        className="hidden"
                      />
                    </label>
                    <UploadTray state={editImages} />
                    {editForm.images.length > 0 && (
                      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                        {editForm.images.map((src, idx) => (
                          <div key={`${src}-${idx}`} className="relative group">
                            <img src={src} alt="Project" onClick={() => setLightbox({ images: editForm.images, index: idx })} className={`h-16 w-full rounded-md object-cover border cursor-pointer ${idx === 0 ? "border-[#FF6B1A]" : "border-[#222A35]"}`} />
                            {idx === 0 && (
                              <div className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-[#FF6B1A] text-white text-[9px] font-medium flex items-center gap-0.5">
                                <Star className="w-2.5 h-2.5" /> Cover
                              </div>
                            )}
                            <div onClick={(e) => { if (e.target === e.currentTarget) setLightbox({ images: editForm.images, index: idx }); }} className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center gap-1 rounded-md cursor-pointer">
                              {idx !== 0 && (
                                <button
                                  type="button"
                                  title="Set as cover"
                                  onClick={() => {
                                    const reordered = [src, ...editForm.images.filter((_, i) => i !== idx)];
                                    setEditForm({ ...editForm, images: reordered });
                                  }}
                                  className="w-6 h-6 rounded-full bg-[#FF6B1A] text-white flex items-center justify-center"
                                >
                                  <Star className="w-3 h-3" />
                                </button>
                              )}
                              {idx > 0 && (
                                <button
                                  type="button"
                                  title="Shift left"
                                  onClick={() => {
                                    const arr = [...editForm.images];
                                    [arr[idx], arr[idx - 1]] = [arr[idx - 1], arr[idx]];
                                    setEditForm({ ...editForm, images: arr });
                                  }}
                                  className="w-6 h-6 rounded-full bg-black/70 text-white flex items-center justify-center"
                                >
                                  <ChevronLeft className="w-3 h-3" />
                                </button>
                              )}
                              {idx < editForm.images.length - 1 && (
                                <button
                                  type="button"
                                  title="Shift right"
                                  onClick={() => {
                                    const arr = [...editForm.images];
                                    [arr[idx], arr[idx + 1]] = [arr[idx + 1], arr[idx]];
                                    setEditForm({ ...editForm, images: arr });
                                  }}
                                  className="w-6 h-6 rounded-full bg-black/70 text-white flex items-center justify-center"
                                >
                                  <ChevronRightIcon className="w-3 h-3" />
                                </button>
                              )}
                              <button
                                type="button"
                                title="Remove"
                                onClick={() => setEditForm({ ...editForm, images: editForm.images.filter((_, i) => i !== idx) })}
                                className="w-6 h-6 rounded-full bg-[#EF4444] text-white flex items-center justify-center"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

            </div>

            {/* Sticky footer */}
            <div className="flex items-center justify-end gap-2 p-5 sm:p-6 pt-4 border-t border-[#222A35] shrink-0 bg-[#11161D]">
              <button onClick={() => { setEditingProject(null); setEditForm(null); editImages.reset(); }} className="h-9 px-3 rounded-md border border-[#222A35] text-[12px] text-[#8A95A5] hover:text-white">Cancel</button>
              <button onClick={saveEdit} disabled={saving || editImages.busy} title={editImages.busy ? "Waiting for the images to finish uploading" : undefined} className="h-9 px-4 rounded-md bg-[#FF6B1A] hover:bg-[#FF7E33] disabled:opacity-60 disabled:cursor-wait text-white text-[12px]">{saving ? "Saving…" : editImages.busy ? "Uploading images…" : "Save changes"}</button>
            </div>
          </div>
        </div>
      )}
      {lightbox && <ImageLightbox images={lightbox.images} startIndex={lightbox.index} onClose={() => setLightbox(null)} />}
    </div>
  );
}
