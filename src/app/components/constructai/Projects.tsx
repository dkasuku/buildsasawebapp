import { useEffect, useState } from "react";
import { toast } from "sonner";
import { MapPin, MoreHorizontal, Plus, X, ImagePlus, UploadCloud, ChevronDown, ChevronRight, Star, ChevronLeft, ChevronRight as ChevronRightIcon, FolderKanban, SearchX } from "lucide-react";
import { MapPicker } from "./MapPicker";
import { EmptyState } from "./EmptyState";
import { ImageLightbox } from "./ImageLightbox";
import { ImageWithFallback } from "../figma/ImageWithFallback";
import { useFileUpload } from "./useFileUpload";
import { ProjectFilesSection, commitProjectFiles, pendingFileCount, EMPTY_PROJECT_FILES, type PendingProjectFiles } from "./project-hub/ProjectFilesSection";
import { UploadTray } from "./UploadTray";
import { refreshProjects } from "./useProjects";
import { resolveName, useTeam } from "./useTeam";
import api, { absoluteFileUrl } from "../../services/api";
import type { View } from "./Sidebar";
import type { Role } from "./roles";
import { ROLES } from "./roles";
import type { Checklist } from "./ChecklistBuilder";
import { useCurrency } from "./CurrencyContext";
import { formatCompactCurrency, formatCurrency, USD_TO_KES } from "./currency";
import { warnSaveFailed } from "./saveFeedback";
import { clientApi } from "./client/clientData";
import { PageHeader, Tabs } from "./PageShell";

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
const CURRENCY_OPTIONS = ["$", "KSh"];

// The small coloured dot on a project card's status chip.
const statusDot = (s: string) =>
  s === "On Track" ? "#22C55E" : s === "At Risk" ? "#EF4444" : s === "Planning" ? "#3B82F6" : s === "Archived" ? "#8A95A5" : "#F5A623";

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

// The numeric contract sum (KES) behind the display string, for the project
// hub's running totals. "KSh 45M" → 45,000,000; "$ 1.2M" → converted at the
// product's fixed rate. Zero/unparseable → null so nothing is invented.
const contractSumFrom = (currency: string, amount: string): number | null => {
  const n = parseCompactValue(amount || "");
  if (!n) return null;
  return Math.round(currency === "$" ? n * USD_TO_KES : n);
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
  // The New project form shows the essentials; photos, units and files on request.
  const [newMore, setNewMore] = useState(false);
  const [query, setQuery] = useState("");
  // Start empty and show a loading state until the backend responds, so a fresh
  // workspace never flashes the seed/demo projects before the empty state. The
  // seed list is only used as an offline fallback (see the fetch's .catch).
  // The workspace's real members, for the PM / Architect / QS pickers. These used
  // to be hardcoded job titles, which the database rejected as user ids.
  const team = useTeam();
  const [projects, setProjects] = useState<Project[]>([]);
  const [showNew, setShowNew] = useState(false);
  // The project owner can be invited as part of creating the project.
  const [newClient, setNewClient] = useState({ name: "", email: "" });
  // Apartments, estates, townhouses: the units are set up with the project.
  const NO_UNITS = { on: false, kind: "block" as "block" | "houses", block: "A", floors: "4", perFloor: "4", ground: true, count: "10", type: "" };
  const [newUnits, setNewUnits] = useState(NO_UNITS);
  const unitTotal = newUnits.kind === "block" ? (Number(newUnits.floors || 0) + (newUnits.ground ? 1 : 0)) * Number(newUnits.perFloor || 0) : Number(newUnits.count || 0);
  const [codeTouched, setCodeTouched] = useState(false);
  const [lightbox, setLightbox] = useState<{ images: string[]; index: number } | null>(null);
  const autoCode = (name: string) => name.trim() ? name.split(" ").filter(Boolean).map((w) => w[0]).join("").toUpperCase().slice(0, 4) + "-" + String(projects.length + 1).padStart(2, "0") : "";
  const [actionMenu, setActionMenu] = useState<string | null>(null);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [form, setForm] = useState<ProjectForm>({ name: "", code: "", city: "", lat: null, lng: null, description: "", valueCurrency: "$", valueAmount: "", status: "Planning", progress: 0, changeOrders: 0, exposureCurrency: "$", exposureAmount: "0", images: [], pm: NO_MEMBER, architect: NO_MEMBER, qs: NO_MEMBER, checklist: { items: [] } });
  const [editForm, setEditForm] = useState<ProjectForm | null>(null);
  // Uploads for the New and Edit dialogs. Each appends only the URLs that
  // actually stored, so a partial failure keeps the successful images.
  // Documents/drawings queued in the dialogs; uploaded and filed after save.
  const [newFiles, setNewFiles] = useState<PendingProjectFiles>(EMPTY_PROJECT_FILES);
  const [editFiles, setEditFiles] = useState<PendingProjectFiles>(EMPTY_PROJECT_FILES);
  const newImages = useFileUpload({
    onUploaded: (urls) => setForm((s) => ({ ...s, images: [...s.images, ...urls] })),
  });
  const editImages = useFileUpload({
    onUploaded: (urls) => setEditForm((s) => (s ? { ...s, images: [...s.images, ...urls] } : s)),
  });
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    details: true, progress: true, team: true, images: true, files: false, checklist: false,
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
      lat: (project as any).lat ?? null,
      lng: (project as any).lng ?? null,
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
        contractSumKES: contractSumFrom(form.valueCurrency, form.valueAmount),
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
      if (newUnits.on && unitTotal > 0) {
        try {
          const r = await api.addUnits(pid, { generate: newUnits.kind === "block"
            ? { block: newUnits.block, floors: Number(newUnits.floors), perFloor: Number(newUnits.perFloor), groundFloor: newUnits.ground, type: newUnits.type || undefined }
            : { count: Number(newUnits.count), type: newUnits.type || undefined } });
          toast.success(`${r.added} units added. Add each client in the project's Units tab.`);
        } catch (e: any) { toast.error(`Project created, but the units weren't added: ${e?.message || "unknown error"}. Add them from the project's Units tab.`, { duration: 9000 }); }
        setNewUnits(NO_UNITS);
      }
      if (newClient.email.trim()) {
        // The project exists either way; a failed invite is reported, not fatal.
        try {
          const c = await clientApi.inviteClient(pid, newClient.email.trim(), newClient.name.trim() || undefined);
          toast.success(c.joined ? `${newClient.name.trim() || newClient.email.trim()} can now follow this project in their client account.` : `Invitation emailed to ${newClient.email.trim()}. The project appears once they create their free client account.`);
        } catch (e: any) { toast.error(`Project created, but the client invite failed: ${e?.message || "unknown error"}. Try again from the project's Client tab.`, { duration: 9000 }); }
        setNewClient({ name: "", email: "" });
      }
      if (pendingFileCount(newFiles)) {
        const r = await commitProjectFiles(pid, newFiles);
        if (r.saved) toast.success(`${r.saved} file${r.saved === 1 ? "" : "s"} filed on the project`);
      }
      setNewFiles(EMPTY_PROJECT_FILES);
      await reloadProjects();
      setForm({ name: "", code: "", city: "", lat: null, lng: null, description: "", valueCurrency: "$", valueAmount: "", status: "Planning", progress: 0, changeOrders: 0, exposureCurrency: "$", exposureAmount: "0", images: [], pm: NO_MEMBER, architect: NO_MEMBER, qs: NO_MEMBER, checklist: { items: [] } });
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
        lat: editForm.lat ?? null,
        lng: editForm.lng ?? null,
        description: editForm.description.trim(),
        value: formatValue(editForm.valueCurrency, editForm.valueAmount),
        // Only fill the numeric sum when none has been set in the project hub —
        // a figure typed there is more precise than a card label like "45M".
        ...((editingProject as any).contractSumKES == null ? { contractSumKES: contractSumFrom(editForm.valueCurrency, editForm.valueAmount) } : {}),
        status: editForm.status,
        progress: Number.isFinite(editForm.progress) ? editForm.progress : editingProject.progress,
        exposure: formatExposure(editForm.exposureCurrency, editForm.exposureAmount),
        images,
      } as any);
      await saveTeam(pid, editForm, "updated");
      if (pendingFileCount(editFiles)) {
        const r = await commitProjectFiles(pid, editFiles);
        if (r.saved) toast.success(`${r.saved} file${r.saved === 1 ? "" : "s"} filed on the project`);
      }
      setEditFiles(EMPTY_PROJECT_FILES);
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
      onClick={() => {
        setActionMenu(null);
        setFiltersOpen(false);
      }}
    >
      <PageHeader
        title="Projects"
        subtitle={<>{activeProjectsCount} active · {combinedValueLabel} in contracts</>}
        actions={<div className="ws-toolbar" onClick={(e) => e.stopPropagation()}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a project…"
            className="flex-1 lg:flex-none lg:w-[180px] h-8 px-3 rounded-md bg-[#11161D] border border-[#222A35] text-[12px] text-white placeholder:text-[#5B6675] focus:outline-none focus:border-[#FF6B1A]"
          />
          <select aria-label="Project status" value={tab} onChange={(e) => setTab(e.target.value)} className="ws-select h-8 px-2 rounded-md border border-[#222A35] text-[12px]">
            {TABS.map((t) => <option key={t} value={t}>{t === "All" ? "All statuses" : t}</option>)}
          </select>
          <button onClick={() => { setCodeTouched(false); setShowNew(true); }} className="h-8 px-3 rounded-md bg-[#FF6B1A] text-white text-[12px] flex items-center gap-1.5">
            <Plus className="w-3.5 h-3.5" /> <span className="hidden sm:inline">New project</span>
          </button>
        </div>}

      />
      <div className="px-4 sm:px-8 py-5 sm:py-6 space-y-5">


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
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((p) => {
            const cover = p.images[0] ?? p.img;
            const menuOpen = actionMenu === p.code;
            const place = p.city && p.city !== "—" ? p.city : null;
            const worth = p.valueKES ? formatCompactCurrency(p.valueKES, currency) : /[1-9]/.test(p.value || "") ? p.value : null;
            const progress = Math.max(0, Math.min(100, p.progress || 0));
            const due = p.targetEndDate ? new Date(p.targetEndDate).toLocaleDateString(undefined, { month: "short", year: "numeric" }) : null;
            const menuItem = "w-full text-left px-3 py-2 hover:bg-[#161C24] hover:text-white whitespace-nowrap";

            return (
            <div
              key={p.code}
              role="button"
              tabIndex={0}
              aria-label={`Open ${p.name}`}
              onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openProject(p); } }}
              onClick={() => openProject(p)}
              className="text-left rounded-2xl border border-[#222A35] bg-[#11161D] hover:border-[#FF6B1A]/50 hover:shadow-lg transition relative cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#FF6B1A]"
            >
              <div className="relative h-[148px] overflow-hidden rounded-t-2xl">
                <ImageWithFallback src={cover} alt={p.name} className="w-full h-full object-cover" />
                <span className="absolute top-3 left-3 h-6 px-2.5 rounded-full bg-[#11161D] text-white text-[11px] font-medium inline-flex items-center gap-1.5 shadow-sm">
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: statusDot(p.status) }} aria-hidden />
                  {p.status}
                </span>
              </div>
              <div className="absolute top-3 right-3 z-30" onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setActionMenu((prev) => prev === p.code ? null : p.code);
                  }}
                  aria-label={`Actions for ${p.name}`}
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  className="w-7 h-7 rounded-full bg-[#11161D] text-[#8A95A5] hover:text-white shadow-sm flex items-center justify-center"
                >
                  <MoreHorizontal className="w-4 h-4" />
                </button>
                {menuOpen && (
                  <div role="menu" className="absolute right-0 mt-2 w-44 rounded-lg border border-[#222A35] bg-[#11161D] shadow-2xl text-[12.5px] text-[#C2CAD6] overflow-hidden">
                    <button type="button" role="menuitem" onClick={() => openEdit(p)} className={menuItem}>Edit project</button>
                    <button type="button" role="menuitem" onClick={() => { setActionMenu(null); setView("change-orders"); }} className={menuItem}>Variations</button>
                    <button type="button" role="menuitem" onClick={() => updateProjectStatus(p.code, "At Risk")} className={menuItem}>Mark at risk</button>
                    <button type="button" role="menuitem" onClick={() => updateProjectStatus(p.code, "Archived")} className={menuItem}>Archive project</button>
                  </div>
                )}
              </div>
              <div className="p-4">
                <div className="text-[15.5px] text-white font-display tracking-tight truncate">{p.name}</div>
                <div className="mt-0.5 text-[12.5px] text-[#8A95A5] flex items-center gap-1 min-w-0">
                  <MapPin className="w-3.5 h-3.5 shrink-0" aria-hidden />
                  <span className="truncate">{place ?? "No location yet"}</span>
                </div>
                <div className="mt-4">
                  <div className="flex items-baseline justify-between text-[12px] mb-1.5">
                    <span className="text-[#8A95A5]">Progress</span>
                    <span className="text-white font-medium">{progress}%</span>
                  </div>
                  <div className="h-1.5 bg-[#222A35] rounded-full overflow-hidden" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label={`${p.name} progress`}>
                    <div className="h-full bg-[#FF6B1A] rounded-full" style={{ width: `${progress}%` }} />
                  </div>
                </div>
                {(worth || due) && (
                  <div className="mt-4 pt-3 border-t border-[#222A35] flex items-center justify-between gap-3 text-[12.5px]">
                    <span className="text-white font-medium truncate">{worth ?? ""}</span>
                    {due && <span className="text-[#8A95A5] shrink-0">Due {due}</span>}
                  </div>
                )}
              </div>
            </div>
          );
          })}
        </div>
      )}


      <div className="rounded-xl border border-[#222A35] bg-[#11161D] overflow-hidden">
        <div className="px-5 py-4 border-b border-[#222A35] flex items-center justify-between">
          <div>
            <div className="text-[13px] text-white font-display">Recent Activity</div>
            <div className="text-[11px] text-[#8A95A5]">Latest change orders</div>
          </div>
          <button onClick={() => setView("change-orders")} className="text-[11px] text-[#FF6B1A] hover:underline">View all</button>
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
                      <tr key={co.id ?? co.number} onClick={() => setView("change-orders")} className="border-t border-[#222A35] hover:bg-[#161C24] cursor-pointer">
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
        <div className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setShowNew(false)}>
          {/* Full-height sheet on phones (keyboard-safe via dvh), centred dialog from
              tablets up, wider on desktop so the two-column rows have room. Header
              and footer stay put while the body scrolls. */}
          <div className="w-full sm:max-w-[560px] lg:max-w-[680px] h-[100dvh] sm:h-auto sm:max-h-[90vh] rounded-none sm:rounded-xl border-0 sm:border border-[#222A35] bg-[#11161D] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-[#222A35] shrink-0">
              <div>
                <div className="text-[15px] text-white font-display">New project</div>
                <div className="text-[11px] text-[#8A95A5]">Only the name is needed. Or just describe the job to Buildsasa AI and it sets it up.</div>
              </div>
              <button onClick={() => setShowNew(false)} className="w-8 h-8 rounded-md text-[#8A95A5] hover:text-white hover:bg-[#161C24] flex items-center justify-center">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-3 overscroll-contain">
              <div>
                <label className="text-[11px] text-[#8A95A5] block mb-1">Project name *</label>
                <input value={form.name} onChange={(e) => { const name = e.target.value; setForm((f) => ({ ...f, name, code: codeTouched ? f.code : autoCode(name) })); }} placeholder="e.g. Kitengela 4-bedroom maisonette" className="w-full h-9 px-3 rounded-md bg-[#0A0E14] border border-[#222A35] text-[13px] text-white placeholder:text-[#5B6675] focus:outline-none focus:border-[#FF6B1A]" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] text-[#8A95A5] block mb-1">Contract value</label>
                  <div className="flex gap-2">
                    <select
                      value={form.valueCurrency}
                      onChange={(e) => setForm({ ...form, valueCurrency: e.target.value })}
                      className="h-9 px-2 rounded-md bg-[#0A0E14] border border-[#222A35] text-[13px] text-white focus:outline-none focus:border-[#FF6B1A] shrink-0"
                    >
                      {CURRENCY_OPTIONS.map((currency) => (
                        <option key={currency} value={currency}>{currency}</option>
                      ))}
                    </select>
                    <input
                      value={form.valueAmount}
                      onChange={(e) => setForm({ ...form, valueAmount: e.target.value })}
                      placeholder="50M"
                      className="flex-1 min-w-0 h-9 px-3 rounded-md bg-[#0A0E14] border border-[#222A35] text-[13px] text-white placeholder:text-[#5B6675] focus:outline-none focus:border-[#FF6B1A]"
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
              <div className="rounded-lg border border-[#222A35] bg-[#0A0E14] p-3">
                <label className="text-[11px] text-[#8A95A5] block">{newUnits.on ? "Owner or developer (optional): unit clients are added per unit" : "Client (optional): the person you're building for"}</label>
                <p className="text-[11px] text-[#5B6675] mt-0.5 mb-2">They get a free client account to follow progress, approve changes and chat with you. You can also invite them later from the project's Client tab.</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input value={newClient.name} onChange={(e) => setNewClient({ ...newClient, name: e.target.value })} placeholder="Client's name, e.g. Mary Wanjiru" className="w-full h-9 bg-[#11161D] border border-[#222A35] rounded-md px-3 text-[12px] text-white placeholder:text-[#5B6675] focus:outline-none focus:border-[#FF6B1A]/50" />
                  <input type="email" value={newClient.email} onChange={(e) => setNewClient({ ...newClient, email: e.target.value })} placeholder="Client's email, e.g. mary@gmail.com" className="w-full h-9 bg-[#11161D] border border-[#222A35] rounded-md px-3 text-[12px] text-white placeholder:text-[#5B6675] focus:outline-none focus:border-[#FF6B1A]/50" />
                </div>
              </div>
              <button type="button" onClick={() => setNewMore((v) => !v)} className="text-[12px] text-[#FF8A47] hover:underline">{newMore ? "Fewer details" : "More details: photos, units, documents"}</button>
              {newMore && (<>
              <div>
                <label className="text-[11px] text-[#8A95A5] block mb-2">Project images</label>
                <label className="flex items-center gap-2 px-3 py-2 rounded-md border border-dashed border-[#222A35] bg-[#0A0E14] text-[11px] text-[#8A95A5] cursor-pointer hover:border-[#FF6B1A]/50 hover:text-white">
                  <ImagePlus className="w-4 h-4" />
                  <span>{form.images.length ? `${form.images.length} image${form.images.length === 1 ? "" : "s"} attached` : "Attach project images — select as many as you like"}</span>
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
                  <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-2 mt-3">
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

              <div className="rounded-lg border border-[#222A35] bg-[#0A0E14] p-3">
                <label className="flex items-start gap-2 cursor-pointer">
                  <input type="checkbox" checked={newUnits.on} onChange={(e) => setNewUnits({ ...newUnits, on: e.target.checked })} className="mt-0.5 accent-[#FF6B1A]" aria-label="This project has several units" />
                  <span className="text-[12px] text-[#C2CAD6]">This project has several units (apartments, an estate, townhouses)
                    <span className="block text-[11px] text-[#5B6675]">Each unit gets its own client, stages, snags and reports. You can also add units later from the project's Units tab.</span></span>
                </label>
                {newUnits.on && (
                  <div className="mt-3 space-y-2">
                    <div className="flex gap-1.5">
                      {([["block", "Apartment block"], ["houses", "Houses / estate"]] as const).map(([k, l]) => (
                        <button key={k} type="button" onClick={() => setNewUnits({ ...newUnits, kind: k })} className={`h-8 px-3 rounded-full text-[12px] border ${newUnits.kind === k ? "border-[#FF6B1A] text-white bg-[#FF6B1A]/10" : "border-[#222A35] text-[#8A95A5]"}`}>{l}</button>
                      ))}
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {newUnits.kind === "block" ? <>
                        <input aria-label="Block name" value={newUnits.block} onChange={(e) => setNewUnits({ ...newUnits, block: e.target.value })} placeholder="Block (A)" className="h-9 bg-[#11161D] border border-[#222A35] rounded-md px-3 text-[12px] text-white focus:outline-none focus:border-[#FF6B1A]/50" />
                        <input aria-label="Floors above ground" type="number" min={1} value={newUnits.floors} onChange={(e) => setNewUnits({ ...newUnits, floors: e.target.value })} placeholder="Floors" className="h-9 bg-[#11161D] border border-[#222A35] rounded-md px-3 text-[12px] text-white focus:outline-none focus:border-[#FF6B1A]/50" />
                        <input aria-label="Units per floor" type="number" min={1} value={newUnits.perFloor} onChange={(e) => setNewUnits({ ...newUnits, perFloor: e.target.value })} placeholder="Per floor" className="h-9 bg-[#11161D] border border-[#222A35] rounded-md px-3 text-[12px] text-white focus:outline-none focus:border-[#FF6B1A]/50" />
                      </> : (
                        <input aria-label="Number of houses" type="number" min={1} value={newUnits.count} onChange={(e) => setNewUnits({ ...newUnits, count: e.target.value })} placeholder="How many houses" className="h-9 bg-[#11161D] border border-[#222A35] rounded-md px-3 text-[12px] text-white focus:outline-none focus:border-[#FF6B1A]/50" />
                      )}
                      <input aria-label="Unit type" value={newUnits.type} onChange={(e) => setNewUnits({ ...newUnits, type: e.target.value })} placeholder={newUnits.kind === "block" ? "Type (2 bedroom)" : "Type (3 bedroom bungalow)"} className="h-9 bg-[#11161D] border border-[#222A35] rounded-md px-3 text-[12px] text-white focus:outline-none focus:border-[#FF6B1A]/50" />
                    </div>
                    {newUnits.kind === "block" && <label className="flex items-center gap-2 text-[11.5px] text-[#C2CAD6]"><input type="checkbox" checked={newUnits.ground} onChange={(e) => setNewUnits({ ...newUnits, ground: e.target.checked })} className="accent-[#FF6B1A]" /> Units on the ground floor too</label>}
                    <div className="text-[11.5px] text-[#8A95A5]">{unitTotal > 0 ? <>Makes <b className="text-white">{unitTotal}</b> units{newUnits.kind === "block" ? ` (${newUnits.block ? `${newUnits.block}-` : ""}${newUnits.ground ? "G01" : "101"} to ${newUnits.block ? `${newUnits.block}-` : ""}${newUnits.floors}${String(Number(newUnits.perFloor) || 1).padStart(2, "0")})` : ` (House 1 to House ${newUnits.count})`}.</> : "Fill in the numbers."}</div>
                  </div>
                )}
              </div>


              <div>
                <label className="text-[11px] text-[#8A95A5] block mb-2">Documents & drawings{pendingFileCount(newFiles) ? ` · ${pendingFileCount(newFiles)} queued` : ""}</label>
                <ProjectFilesSection value={newFiles} onChange={setNewFiles} />
              </div>
              </>)}
            </div>
            <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center sm:justify-end gap-2 px-4 sm:px-6 py-3 border-t border-[#222A35] shrink-0 bg-[#11161D]" style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
              <button onClick={() => setShowNew(false)} className="h-10 sm:h-9 px-3 rounded-md border border-[#222A35] text-[12px] text-[#8A95A5] hover:text-white">Cancel</button>
              <button onClick={createProject} disabled={saving || newImages.busy} title={newImages.busy ? "Waiting for the images to finish uploading" : undefined} className="h-10 sm:h-9 px-4 rounded-md bg-[#FF6B1A] hover:bg-[#FF7E33] disabled:opacity-60 disabled:cursor-wait text-white text-[12px]">{saving ? "Creating…" : newImages.busy ? "Uploading images…" : "Create project"}</button>
            </div>
          </div>
        </div>
      )}
      {editingProject && editForm && (
        <div className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => { setEditingProject(null); setEditForm(null); }}>
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
                      <input placeholder="e.g. Kitengela 4-Bedroom Maisonette" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} className="w-full h-9 px-3 rounded-md bg-[#0A0E14] border border-[#222A35] text-[13px] text-white focus:outline-none focus:border-[#FF6B1A]" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[11px] text-[#8A95A5] block mb-1">Project code</label>
                        <input placeholder="e.g. KTG-001" value={editForm.code} onChange={(e) => setEditForm({ ...editForm, code: e.target.value })} className="w-full h-9 px-3 rounded-md bg-[#0A0E14] border border-[#222A35] text-[13px] text-white focus:outline-none focus:border-[#FF6B1A]" />
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
                      <label className="text-[11px] text-[#8A95A5] block mb-1">Location</label>
                      <MapPicker
                        value={editForm.city === "—" ? "" : editForm.city}
                        latLng={editForm.lat != null && editForm.lng != null ? { lat: editForm.lat, lng: editForm.lng } : null}
                        onChange={(city) => setEditForm((prev) => (prev ? { ...prev, city } : prev))}
                        onLatLngChange={(ll) => setEditForm((prev) => (prev ? { ...prev, lat: ll?.lat ?? null, lng: ll?.lng ?? null } : prev))}
                      />
                      <div className="text-[10.5px] text-[#5B6675] mt-1">Pin the site so the project shows its weather and a map.</div>
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
                        <input placeholder="e.g. 25"
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
                        <input placeholder="e.g. 0"
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
                      <label className="text-[11px] text-[#8A95A5] block mb-1">Money at risk from pending changes <span className="text-[#5B6675] font-normal">(optional)</span></label>
                      <div className="text-[10px] text-[#5B6675] mb-1.5">Value of change orders raised but not yet approved.</div>
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
                      <span>{editForm.images.length ? `${editForm.images.length} image${editForm.images.length === 1 ? "" : "s"} attached` : "Attach project images — select as many as you like"}</span>
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

              {/* Section 5: Documents & drawings */}
              <div className="rounded-lg border border-[#222A35] overflow-hidden">
                <button
                  type="button"
                  onClick={() => setExpandedSections((p) => ({ ...p, files: !p.files }))}
                  className="w-full flex items-center justify-between px-3 py-2.5 bg-[#0A0E14] text-left"
                >
                  <span className="text-[12px] text-white font-display">Documents & Drawings{pendingFileCount(editFiles) ? <span className="text-[#FF6B1A]"> · {pendingFileCount(editFiles)} to upload</span> : null}</span>
                  {expandedSections.files ? <ChevronDown className="w-3.5 h-3.5 text-[#5B6675]" /> : <ChevronRight className="w-3.5 h-3.5 text-[#5B6675]" />}
                </button>
                {expandedSections.files && (
                  <div className="p-3">
                    <ProjectFilesSection value={editFiles} onChange={setEditFiles} />
                    <div className="text-[10.5px] text-[#5B6675] mt-2">Files already on the project are in its folders — open the project to see them.</div>
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
    </div>
  );
}
