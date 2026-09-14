// ============================================================================
// Site & Construction Execution — what happened on site, in one folder:
//
//   Diary     daily/weekly site diary: labour, plant, materials delivered,
//             weather, progress notes, photos
//   Progress  reported vs schedule-derived completion, milestones, schedule
//   Defects   snagging list with photo evidence, responsible party and status
//   H&S       health & safety incident log
//
// Same rows as Daily Log, Schedule, Punch List and Safety Incidents — this is
// the project's view of them.
// ============================================================================

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Camera, CalendarDays, Check, ClipboardList, CloudSun, HardHat, Loader2, Plus, ShieldAlert, Users, Wrench, Truck, Package, ImageIcon } from "lucide-react";
import api, { absoluteFileUrl, type DocumentDto, type ProjectHubDto, type SafetyIncidentDto } from "../../../services/api";
import { ImageWithFallback } from "../../figma/ImageWithFallback";
import { ImageLightbox } from "../ImageLightbox";
import { pickFiles, useFileUpload } from "../useFileUpload";
import { UploadTray } from "../UploadTray";
import { resolveName } from "../useTeam";
import { MultiAssign } from "../MultiAssign";
import { DocumentFolder } from "./DocumentFolder";
import { Bar, Empty, Field, Kpi, Modal, Panel, Pill, btnGhost, btnPrimary, fmtDate, input, statusLabel, statusTone, textarea } from "./shared";

type SubTab = "diary" | "progress" | "defects" | "safety";

export function SiteFolder({
  projectId, site, progress, schedule, docs, canEdit, onChanged, initialTab,
}: {
  projectId: string;
  site: ProjectHubDto["site"];
  progress: ProjectHubDto["progress"];
  schedule: ProjectHubDto["schedule"];
  docs: DocumentDto[];
  canEdit: boolean;
  onChanged: () => void | Promise<void>;
  initialTab?: SubTab;
}) {
  const [tab, setTab] = useState<SubTab>(initialTab ?? "diary");
  const openDefects = site.punchItems.filter((p) => !["closed", "resolved"].includes(String(p.status).toLowerCase()));
  const openIncidents = site.safetyIncidents.filter((s) => s.status !== "closed");
  const TABS: { key: SubTab; label: string; icon: any; count?: number; tone?: "warn" | "bad" }[] = [
    { key: "diary", label: "Site diary", icon: ClipboardList, count: site.dailyLogs.length },
    { key: "progress", label: "Progress", icon: CalendarDays },
    { key: "defects", label: "Snagging & defects", icon: Wrench, count: openDefects.length, tone: openDefects.length ? "warn" : undefined },
    { key: "safety", label: "Health & safety", icon: ShieldAlert, count: openIncidents.length, tone: openIncidents.length ? "bad" : undefined },
  ];

  return (
    <div className="space-y-4">
      <div className="flex gap-1 overflow-x-auto rounded-xl border border-[#222A35] bg-[#11161D] p-1">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} className={`flex-1 min-w-max h-9 px-3 rounded-lg text-[12px] flex items-center justify-center gap-1.5 transition ${tab === t.key ? "bg-[#FF6B1A] text-white" : "text-[#8A95A5] hover:text-white hover:bg-[#161C24]"}`}>
            <t.icon className="w-3.5 h-3.5" /> {t.label}
            {t.count != null && <span className={`text-[10px] px-1.5 rounded-full ${tab === t.key ? "bg-white/20" : t.tone === "bad" ? "bg-[#EF4444]/20 text-[#EF4444]" : t.tone === "warn" ? "bg-[#F5A623]/20 text-[#F5A623]" : "bg-[#222A35]"}`}>{t.count}</span>}
          </button>
        ))}
      </div>

      {tab === "diary" && <Diary projectId={projectId} logs={site.dailyLogs} canEdit={canEdit} onChanged={onChanged} />}
      {tab === "progress" && <Progress progress={progress} schedule={schedule} />}
      {tab === "defects" && <Defects projectId={projectId} items={site.punchItems} canEdit={canEdit} onChanged={onChanged} />}
      {tab === "safety" && <Safety projectId={projectId} incidents={site.safetyIncidents} canEdit={canEdit} onChanged={onChanged} />}

      <DocumentFolder projectId={projectId} category="site" docs={docs} onChanged={onChanged} canEdit={canEdit} />
    </div>
  );
}

// ── Diary ──────────────────────────────────────────────────────────────────────

function Diary({ projectId, logs, canEdit, onChanged }: { projectId: string; logs: ProjectHubDto["site"]["dailyLogs"]; canEdit: boolean; onChanged: () => void | Promise<void> }) {
  const [adding, setAdding] = useState(false);
  const [lightbox, setLightbox] = useState<{ images: string[]; index: number } | null>(null);
  const week = useMemo(() => {
    const since = Date.now() - 7 * 86400000;
    const recent = logs.filter((l) => new Date(l.date).getTime() >= since);
    return { entries: recent.length, headcount: recent.reduce((s, l) => s + (Number(l.headcount) || 0), 0) };
  }, [logs]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Kpi label="Diary entries" value={String(logs.length)} sub="on record" />
        <Kpi label="Last 7 days" value={String(week.entries)} sub="entries logged" />
        <Kpi label="Labour-days this week" value={String(week.headcount)} sub="sum of headcounts" />
      </div>
      <Panel title="Site diary" subtitle="Newest first" action={canEdit && <button onClick={() => setAdding(true)} className={btnPrimary}><Plus className="w-3.5 h-3.5" /> New entry</button>}>
        {logs.length === 0 ? (
          <Empty icon={ClipboardList} title="No diary entries yet" hint="Record each day: who was on site, what plant ran, what was delivered, the weather and what got done — with photos.">
            {canEdit && <button onClick={() => setAdding(true)} className={btnPrimary}><Plus className="w-3.5 h-3.5" /> Write today's entry</button>}
          </Empty>
        ) : (
          <div className="divide-y divide-[#222A35]">
            {logs.map((l) => {
              const photos = (l.photos || []).map((u) => absoluteFileUrl(u)).filter(Boolean);
              return (
                <div key={l.id} className="px-4 py-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[12.5px] text-white">{fmtDate(l.date, { weekday: "short", month: "short", day: "numeric", year: "numeric" })}</span>
                    {l.weather && <Pill tone="info"><CloudSun className="w-3 h-3 inline mr-1 -mt-px" />{l.weather}</Pill>}
                    <span className="text-[11px] text-[#8A95A5] flex items-center gap-1"><Users className="w-3 h-3" />{l.crew} · {l.headcount}</span>
                    {l.location && <span className="text-[11px] text-[#5B6675]">· {l.location}</span>}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-2">
                    <DiaryCell icon={Users} label="Labour" value={l.labour} />
                    <DiaryCell icon={Truck} label="Plant" value={l.plant} />
                    <DiaryCell icon={Package} label="Materials delivered" value={l.materials} />
                  </div>
                  {l.notes && <p className="text-[12px] text-[#C2CAD6] mt-2 whitespace-pre-wrap leading-relaxed">{l.notes}</p>}
                  {photos.length > 0 && (
                    <div className="flex gap-2 mt-2 overflow-x-auto">
                      {photos.map((src, i) => (
                        <button key={`${src}-${i}`} onClick={() => setLightbox({ images: photos, index: i })} className="shrink-0">
                          <ImageWithFallback src={src} alt="" className="h-16 w-24 rounded-md object-cover border border-[#222A35] hover:border-[#FF6B1A]" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Panel>
      {adding && <DiaryForm projectId={projectId} onClose={() => setAdding(false)} onDone={async () => { setAdding(false); await onChanged(); }} />}
      {lightbox && <ImageLightbox images={lightbox.images} startIndex={lightbox.index} onClose={() => setLightbox(null)} />}
    </div>
  );
}

function DiaryCell({ icon: Icon, label, value }: { icon: any; label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="rounded-lg border border-[#222A35] bg-[#0A0E14] px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-[#5B6675] flex items-center gap-1"><Icon className="w-3 h-3" /> {label}</div>
      <div className="text-[11.5px] text-[#C2CAD6] whitespace-pre-wrap mt-0.5">{value}</div>
    </div>
  );
}

function DiaryForm({ projectId, onClose, onDone }: { projectId: string; onClose: () => void; onDone: () => Promise<void> }) {
  const uploader = useFileUpload();
  const [photos, setPhotos] = useState<string[]>([]);
  const [f, setF] = useState({ date: new Date().toISOString().slice(0, 10), crew: "", headcount: "", location: "", weather: "", labour: "", plant: "", materials: "", notes: "" });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const addPhotos = async () => {
    const files = await pickFiles({ multiple: true, accept: "image/*", capture: "environment" });
    if (!files.length) return;
    const urls = await uploader.upload(files);
    setPhotos((p) => [...p, ...urls]);
  };
  const save = async () => {
    if (!f.crew.trim()) return toast.error("Name the crew or gang on site");
    setBusy(true);
    try {
      await api.createDailyLog(projectId, { ...f, headcount: Number(f.headcount) || 0, photos } as any);
      toast.success("Diary entry saved");
      await onDone();
    } catch (e: any) { toast.error(e?.message || "Could not save"); }
    finally { setBusy(false); }
  };
  return (
    <Modal title="Site diary entry" subtitle="A record of the day — kept for claims, disputes and the final account." onClose={onClose} wide>
      <div className="space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Field label="Date"><input type="date" value={f.date} onChange={set("date")} className={input} /></Field>
          <Field label="Weather"><select value={f.weather} onChange={set("weather")} className={input}><option value="">—</option>{["Sunny", "Cloudy", "Light rain", "Heavy rain", "Windy", "Hot", "Cold"].map((w) => <option key={w}>{w}</option>)}</select></Field>
          <Field label="Crew / gang"><input value={f.crew} onChange={set("crew")} placeholder="Main gang" className={input} /></Field>
          <Field label="Headcount"><input type="number" min={0} value={f.headcount} onChange={set("headcount")} className={input} /></Field>
        </div>
        <Field label="Location / area"><input value={f.location} onChange={set("location")} placeholder="Block B, 2nd floor" className={input} /></Field>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Labour on site"><textarea value={f.labour} onChange={set("labour")} placeholder={"4 masons\n6 helpers\n1 foreman"} className={textarea} /></Field>
          <Field label="Plant & equipment"><textarea value={f.plant} onChange={set("plant")} placeholder={"Concrete mixer ×1\nPoker vibrator ×2"} className={textarea} /></Field>
          <Field label="Materials delivered"><textarea value={f.materials} onChange={set("materials")} placeholder={"200 bags cement\n7t ballast"} className={textarea} /></Field>
        </div>
        <Field label="Progress notes"><textarea value={f.notes} onChange={set("notes")} placeholder="Work done today, delays, instructions received, visitors." className={textarea} /></Field>
        <div>
          <div className="text-[11px] text-[#8A95A5] mb-1.5">Photos</div>
          <div className="flex gap-2 flex-wrap">
            {photos.map((u) => <img key={u} src={absoluteFileUrl(u)} alt="" className="h-16 w-24 rounded-md object-cover border border-[#222A35]" />)}
            <button onClick={addPhotos} className="h-16 w-24 rounded-md border-2 border-dashed border-[#222A35] flex flex-col items-center justify-center gap-1 text-[#8A95A5] hover:border-[#FF6B1A] hover:text-white"><Camera className="w-4 h-4" /><span className="text-[10px]">Add</span></button>
          </div>
          {uploader.pending.length > 0 && <div className="mt-2"><UploadTray state={uploader} /></div>}
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className={btnGhost}>Cancel</button>
          <button onClick={save} disabled={busy || uploader.busy} className={btnPrimary}>{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Save entry</button>
        </div>
      </div>
    </Modal>
  );
}

// ── Progress ───────────────────────────────────────────────────────────────────

function Progress({ progress, schedule }: { progress: ProjectHubDto["progress"]; schedule: ProjectHubDto["schedule"] }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel title="Completion" subtitle="Schedule-derived vs reported">
          <div className="p-4 space-y-4">
            <div>
              <div className="flex items-center justify-between text-[12px] mb-1.5"><span className="text-[#C2CAD6]">From the schedule</span><span className="text-white font-display">{progress.schedule == null ? "—" : `${progress.schedule}%`}</span></div>
              <Bar pct={progress.schedule} className="h-2" />
              <div className="text-[10px] text-[#5B6675] mt-1">{progress.schedule == null ? "No schedule items yet" : `Average across ${progress.scheduleItems} items`}</div>
            </div>
            <div>
              <div className="flex items-center justify-between text-[12px] mb-1.5"><span className="text-[#C2CAD6]">Reported by the team</span><span className="text-white font-display">{progress.reported}%</span></div>
              <Bar pct={progress.reported} tone="info" className="h-2" />
            </div>
          </div>
        </Panel>
        <div className="grid grid-cols-2 gap-3">
          <Kpi label="Milestones" value={`${progress.milestonesDone}/${progress.milestonesTotal}`} sub="reached" />
          <Kpi label="Schedule items" value={String(progress.scheduleItems)} />
          <Kpi label="Overdue" value={String(progress.overdueItems)} tone={progress.overdueItems ? "bad" : "good"} />
          <Kpi label="Blocked" value={String(progress.blockedItems)} tone={progress.blockedItems ? "bad" : "good"} />
        </div>
      </div>
      <Panel title="Works programme" subtitle={schedule.length ? `${schedule.length} items` : undefined}>
        {schedule.length === 0 ? (
          <Empty icon={CalendarDays} title="No programme yet" hint="Add tasks and milestones in the Schedule module; progress here is worked out from them." />
        ) : (
          <div className="divide-y divide-[#222A35]">
            {schedule.map((s) => {
              const overdue = s.endDate && new Date(s.endDate) < new Date() && (s.percent ?? 0) < 100;
              return (
                <div key={s.id} className="px-4 py-2.5 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[12.5px] text-white truncate">{s.name}</span>
                      {s.type === "milestone" && <Pill tone="info">Milestone</Pill>}
                      {overdue && <Pill tone="bad"><AlertTriangle className="w-2.5 h-2.5 inline -mt-px mr-0.5" /> Overdue</Pill>}
                    </div>
                    <div className="text-[10.5px] text-[#5B6675]">{fmtDate(s.startDate)} → {fmtDate(s.endDate)}{(s as any).trade ? ` · ${(s as any).trade}` : ""}</div>
                  </div>
                  <div className="w-24 shrink-0"><Bar pct={s.percent} /></div>
                  <span className="text-[11px] text-[#8A95A5] w-9 text-right shrink-0">{s.percent ?? 0}%</span>
                </div>
              );
            })}
          </div>
        )}
      </Panel>
    </div>
  );
}

// ── Defects ────────────────────────────────────────────────────────────────────

const DEFECT_STATUSES = ["open", "in_progress", "ready_for_review", "resolved", "closed", "rejected"];

function Defects({ projectId, items, canEdit, onChanged }: { projectId: string; items: any[]; canEdit: boolean; onChanged: () => void | Promise<void> }) {
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState<"open" | "all">("open");
  const [lightbox, setLightbox] = useState<{ images: string[]; index: number } | null>(null);
  const rows = filter === "open" ? items.filter((p) => !["closed", "resolved"].includes(String(p.status).toLowerCase())) : items;
  const counts = {
    open: items.filter((p) => ["open", "in_progress", "ready_for_review"].includes(String(p.status).toLowerCase())).length,
    resolved: items.filter((p) => ["resolved", "closed"].includes(String(p.status).toLowerCase())).length,
    high: items.filter((p) => p.priority === "high" && !["closed", "resolved"].includes(String(p.status).toLowerCase())).length,
  };
  const setStatus = async (p: any, status: string) => {
    try { await api.updatePunchItem(p.id, { status }); await onChanged(); }
    catch (e: any) { toast.error(e?.message || "Could not update"); }
  };
  const responsible = (p: any) => {
    const names = (p.assignees || []).map((id: string) => resolveName(id)).filter(Boolean);
    return names.length ? names.join(", ") : p.trade || p.assignedTo || "Unassigned";
  };
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Kpi label="Open defects" value={String(counts.open)} tone={counts.open ? "warn" : "good"} />
        <Kpi label="High priority" value={String(counts.high)} tone={counts.high ? "bad" : undefined} sub="still open" />
        <Kpi label="Resolved / closed" value={String(counts.resolved)} tone="good" />
      </div>
      <Panel
        title="Snagging & defects list"
        subtitle="Photo evidence, who is responsible, and where it stands"
        action={<>
          <div className="flex rounded-md border border-[#222A35] overflow-hidden text-[11px]">
            <button onClick={() => setFilter("open")} className={`px-2.5 h-8 ${filter === "open" ? "bg-[#FF6B1A] text-white" : "text-[#8A95A5]"}`}>Open</button>
            <button onClick={() => setFilter("all")} className={`px-2.5 h-8 ${filter === "all" ? "bg-[#FF6B1A] text-white" : "text-[#8A95A5]"}`}>All</button>
          </div>
          {canEdit && <button onClick={() => setAdding(true)} className={btnPrimary}><Plus className="w-3.5 h-3.5" /> Log defect</button>}
        </>}
      >
        {rows.length === 0 ? (
          <Empty icon={Wrench} title={filter === "open" ? "No open defects" : "No defects logged"} hint="Log a snag with a photo, the trade or person responsible, and track it to closed." >
            {canEdit && <button onClick={() => setAdding(true)} className={btnPrimary}><Plus className="w-3.5 h-3.5" /> Log a defect</button>}
          </Empty>
        ) : (
          <div className="divide-y divide-[#222A35]">
            {rows.map((p) => {
              const photos = (p.photos || []).map((u: string) => absoluteFileUrl(u)).filter(Boolean);
              return (
                <div key={p.id} className="px-4 py-3 flex gap-3">
                  {photos.length ? (
                    <button onClick={() => setLightbox({ images: photos, index: 0 })} className="shrink-0 relative">
                      <ImageWithFallback src={photos[0]} alt="" className="h-16 w-20 rounded-md object-cover border border-[#222A35]" />
                      {photos.length > 1 && <span className="absolute bottom-1 right-1 text-[9px] px-1 rounded bg-black/70 text-white">+{photos.length - 1}</span>}
                    </button>
                  ) : (
                    <div className="h-16 w-20 rounded-md border border-dashed border-[#222A35] flex items-center justify-center shrink-0 text-[#3A4350]"><ImageIcon className="w-4 h-4" /></div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[11px] font-mono text-[#5B6675]">{p.code}</span>
                      <span className="text-[12.5px] text-white">{p.title || p.desc}</span>
                      {p.priority === "high" && <Pill tone="bad">High</Pill>}
                    </div>
                    {p.title && p.desc && p.desc !== p.title && <div className="text-[11.5px] text-[#C2CAD6] mt-0.5 line-clamp-2">{p.desc}</div>}
                    <div className="text-[10.5px] text-[#5B6675] mt-1 flex items-center gap-2 flex-wrap">
                      <span className="flex items-center gap-1"><HardHat className="w-3 h-3" /> {responsible(p)}</span>
                      {p.area && <span>· {p.area}</span>}
                      {p.dueDate && <span>· due {fmtDate(p.dueDate)}</span>}
                      <span>· logged {fmtDate(p.createdAt)}</span>
                    </div>
                  </div>
                  <div className="shrink-0">
                    {canEdit ? (
                      <select value={p.status} onChange={(e) => setStatus(p, e.target.value)} className="h-8 bg-[#0A0E14] border border-[#222A35] rounded px-1.5 text-[11px] text-[#C2CAD6]">
                        {DEFECT_STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
                      </select>
                    ) : <Pill tone={statusTone(p.status)}>{statusLabel(p.status)}</Pill>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Panel>
      {adding && <DefectForm projectId={projectId} onClose={() => setAdding(false)} onDone={async () => { setAdding(false); await onChanged(); }} />}
      {lightbox && <ImageLightbox images={lightbox.images} startIndex={lightbox.index} onClose={() => setLightbox(null)} />}
    </div>
  );
}

function DefectForm({ projectId, onClose, onDone }: { projectId: string; onClose: () => void; onDone: () => Promise<void> }) {
  const uploader = useFileUpload();
  const [photos, setPhotos] = useState<string[]>([]);
  const [assignees, setAssignees] = useState<string[]>([]);
  const [f, setF] = useState({ title: "", desc: "", area: "", trade: "", priority: "medium", dueDate: "" });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const addPhotos = async () => {
    const files = await pickFiles({ multiple: true, accept: "image/*", capture: "environment" });
    if (!files.length) return;
    const urls = await uploader.upload(files);
    setPhotos((p) => [...p, ...urls]);
  };
  const save = async () => {
    if (!f.title.trim()) return toast.error("Describe the defect");
    setBusy(true);
    try {
      await api.createPunchItem({ projectId, title: f.title.trim(), desc: f.desc || f.title.trim(), area: f.area || "—", trade: f.trade || undefined, assignees, priority: f.priority, dueDate: f.dueDate || undefined, photos, status: "open", category: "other" });
      toast.success("Defect logged");
      await onDone();
    } catch (e: any) { toast.error(e?.message || "Could not save"); }
    finally { setBusy(false); }
  };
  return (
    <Modal title="Log a defect" subtitle="Goes onto the punch list with the photo as evidence." onClose={onClose}>
      <div className="space-y-3">
        <Field label="Defect"><input autoFocus value={f.title} onChange={set("title")} placeholder="Cracked tiles at lobby entrance" className={input} /></Field>
        <Field label="Details"><textarea value={f.desc} onChange={set("desc")} placeholder="What is wrong and what is required to put it right." className={textarea} /></Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Location / area"><input value={f.area} onChange={set("area")} placeholder="Ground floor lobby" className={input} /></Field>
          <Field label="Responsible trade"><input value={f.trade} onChange={set("trade")} placeholder="Tiling subcontractor" className={input} /></Field>
          <div><MultiAssign compact label="Assign to (team)" value={assignees} onChange={setAssignees} /></div>
          <Field label="Priority"><select value={f.priority} onChange={set("priority")} className={input}>{["low", "medium", "high"].map((p) => <option key={p} value={p}>{statusLabel(p)}</option>)}</select></Field>
          <Field label="Due"><input type="date" value={f.dueDate} onChange={set("dueDate")} className={input} /></Field>
        </div>
        <div>
          <div className="text-[11px] text-[#8A95A5] mb-1.5">Photo evidence</div>
          <div className="flex gap-2 flex-wrap">
            {photos.map((u) => <img key={u} src={absoluteFileUrl(u)} alt="" className="h-16 w-24 rounded-md object-cover border border-[#222A35]" />)}
            <button onClick={addPhotos} className="h-16 w-24 rounded-md border-2 border-dashed border-[#222A35] flex flex-col items-center justify-center gap-1 text-[#8A95A5] hover:border-[#FF6B1A] hover:text-white"><Camera className="w-4 h-4" /><span className="text-[10px]">Add</span></button>
          </div>
          {uploader.pending.length > 0 && <div className="mt-2"><UploadTray state={uploader} /></div>}
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className={btnGhost}>Cancel</button>
          <button onClick={save} disabled={busy || uploader.busy} className={btnPrimary}>{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Log defect</button>
        </div>
      </div>
    </Modal>
  );
}

// ── Health & safety ────────────────────────────────────────────────────────────

const INCIDENT_TYPES = ["injury", "near-miss", "environmental", "property", "struck-by-equipment", "rollover", "cave-in", "traffic-incident", "asphalt-burn"];
const SEVERITIES = ["minor", "moderate", "major", "fatality"];

function Safety({ projectId, incidents, canEdit, onChanged }: { projectId: string; incidents: SafetyIncidentDto[]; canEdit: boolean; onChanged: () => void | Promise<void> }) {
  const [adding, setAdding] = useState(false);
  const open = incidents.filter((i) => i.status !== "closed");
  const setStatus = async (i: SafetyIncidentDto, status: string) => {
    try { await api.updateSafetyIncident(projectId, i.id, { status }); await onChanged(); }
    catch (e: any) { toast.error(e?.message || "Could not update"); }
  };
  const lastIncident = incidents[0]?.date;
  const daysSince = lastIncident ? Math.max(0, Math.floor((Date.now() - new Date(lastIncident).getTime()) / 86400000)) : null;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Kpi label="Incidents logged" value={String(incidents.length)} />
        <Kpi label="Open / investigating" value={String(open.length)} tone={open.length ? "bad" : "good"} />
        <Kpi label="Days since last incident" value={daysSince == null ? "—" : String(daysSince)} tone={daysSince == null || daysSince > 30 ? "good" : undefined} sub={incidents.length ? undefined : "no incidents recorded"} />
      </div>
      <Panel title="Incident log" subtitle="Every incident and near-miss, with its corrective action" action={canEdit && <button onClick={() => setAdding(true)} className={btnPrimary}><Plus className="w-3.5 h-3.5" /> Log incident</button>}>
        {incidents.length === 0 ? (
          <Empty icon={ShieldAlert} title="No incidents recorded" hint="Good. Log near-misses too — they are the cheapest lesson a site gets.">
            {canEdit && <button onClick={() => setAdding(true)} className={btnGhost}><Plus className="w-3.5 h-3.5" /> Log an incident</button>}
          </Empty>
        ) : (
          <div className="divide-y divide-[#222A35]">
            {incidents.map((i) => (
              <div key={i.id} className="px-4 py-3 flex gap-3">
                <div className={`w-1 rounded-full shrink-0 ${i.severity === "fatality" || i.severity === "major" ? "bg-[#EF4444]" : i.severity === "moderate" ? "bg-[#F5A623]" : "bg-[#3B82F6]"}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[12.5px] text-white">{statusLabel(i.incidentType)}</span>
                    <Pill tone={statusTone(i.severity)}>{statusLabel(i.severity)}</Pill>
                    <span className="text-[11px] text-[#5B6675]">{fmtDate(i.date)} · reported by {i.reporter}</span>
                  </div>
                  <p className="text-[11.5px] text-[#C2CAD6] mt-1">{i.description}</p>
                  {i.correctiveAction && <div className="text-[11px] text-[#8A95A5] mt-1"><span className="text-[#5B6675]">Corrective action:</span> {i.correctiveAction}</div>}
                </div>
                <div className="shrink-0">
                  {canEdit ? (
                    <select value={i.status} onChange={(e) => setStatus(i, e.target.value)} className="h-8 bg-[#0A0E14] border border-[#222A35] rounded px-1.5 text-[11px] text-[#C2CAD6]">
                      {["open", "investigating", "closed"].map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
                    </select>
                  ) : <Pill tone={statusTone(i.status)}>{statusLabel(i.status)}</Pill>}
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>
      {adding && <IncidentForm projectId={projectId} onClose={() => setAdding(false)} onDone={async () => { setAdding(false); await onChanged(); }} />}
    </div>
  );
}

function IncidentForm({ projectId, onClose, onDone }: { projectId: string; onClose: () => void; onDone: () => Promise<void> }) {
  const me = (() => { try { return JSON.parse(localStorage.getItem("constructai-user") || "null")?.name || ""; } catch { return ""; } })();
  const [f, setF] = useState({ date: new Date().toISOString().slice(0, 10), incidentType: "near-miss", severity: "minor", description: "", reporter: me, witnesses: "", correctiveAction: "", status: "open" });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = async () => {
    if (!f.description.trim()) return toast.error("Describe what happened");
    if (!f.reporter.trim()) return toast.error("Who is reporting this?");
    setBusy(true);
    try { await api.createSafetyIncident(projectId, f as any); toast.success("Incident logged"); await onDone(); }
    catch (e: any) { toast.error(e?.message || "Could not save"); }
    finally { setBusy(false); }
  };
  return (
    <Modal title="Log a health & safety incident" onClose={onClose}>
      <div className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Date"><input type="date" value={f.date} onChange={set("date")} className={input} /></Field>
          <Field label="Type"><select value={f.incidentType} onChange={set("incidentType")} className={input}>{INCIDENT_TYPES.map((t) => <option key={t} value={t}>{statusLabel(t)}</option>)}</select></Field>
          <Field label="Severity"><select value={f.severity} onChange={set("severity")} className={input}>{SEVERITIES.map((t) => <option key={t} value={t}>{statusLabel(t)}</option>)}</select></Field>
        </div>
        <Field label="What happened"><textarea autoFocus value={f.description} onChange={set("description")} className={textarea} /></Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Reported by"><input value={f.reporter} onChange={set("reporter")} className={input} /></Field>
          <Field label="Witnesses"><input value={f.witnesses} onChange={set("witnesses")} className={input} /></Field>
        </div>
        <Field label="Corrective action"><textarea value={f.correctiveAction} onChange={set("correctiveAction")} placeholder="What was done, or will be done, to stop it happening again." className={textarea} /></Field>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className={btnGhost}>Cancel</button>
          <button onClick={save} disabled={busy} className={btnPrimary}>{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Log incident</button>
        </div>
      </div>
    </Modal>
  );
}
