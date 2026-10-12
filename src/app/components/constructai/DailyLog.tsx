// Daily Log — the day-by-day site record for a project: what was done, who was
// on site, plant and deliveries, the weather, where, and photo or video evidence.
// The form and the feed are shared with the project's Site folder
// (daily-log/DailyLogParts) so both screens record the day the same way.
import { useMemo, useState } from "react";
import { ClipboardList, FolderKanban, Plus, RefreshCw, Camera, Users, CalendarCheck, AlertTriangle } from "lucide-react";
import { type DailyLogDto } from "../../services/api";
import { EmptyState } from "./EmptyState";
import { useProjects } from "./useProjects";
import { SiteWeather } from "./SiteWeather";
import { DailyLogEditor, DailyLogFeed, parseUrls, useDailyLogs } from "./daily-log/DailyLogParts";

export function DailyLog() {
  const { projects, loading: projectsLoading } = useProjects();
  const [picked, setPicked] = useState("");
  const projectId = picked || projects[0]?.id || "";
  const project = projects.find((p) => p.id === projectId);
  const { logs, loading, load, upsert, remove } = useDailyLogs(projectId);
  const [editing, setEditing] = useState<DailyLogDto | "new" | null>(null);

  const week = useMemo(() => {
    const since = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
    const recent = logs.filter((l) => String(l.date).slice(0, 10) >= since);
    return {
      days: new Set(recent.map((l) => String(l.date).slice(0, 10))).size,
      people: recent.reduce((s, l) => s + (Number(l.headcount) || 0), 0),
      media: recent.reduce((s, l) => s + parseUrls(l.photos).length + parseUrls(l.videos).length, 0),
    };
  }, [logs]);
  const today = new Date().toISOString().slice(0, 10);
  const loggedToday = logs.some((l) => String(l.date).slice(0, 10) === today);

  return (
    <div className="px-4 sm:px-7 py-5 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[13px] text-white font-display flex items-center gap-2"><ClipboardList className="w-4 h-4 text-[#FF6B1A]" /> Daily Log</div>
          <div className="text-[11px] text-[#8A95A5]">The day-by-day site record, your evidence for claims, delays and disputes</div>
        </div>
        <div className="flex items-end gap-2 flex-wrap">
          <select
            value={projectId}
            onChange={(e) => setPicked(e.target.value)}
            disabled={projectsLoading || projects.length === 0}
            className="h-9 min-w-[200px] bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-[12px] text-white focus:outline-none focus:border-[#FF6B1A] disabled:opacity-60"
          >
            {projectsLoading && <option value="">Loading projects…</option>}
            {!projectsLoading && projects.length === 0 && <option value="">No projects yet</option>}
            {projects.map((p) => <option key={p.id} value={p.id}>{p.code ? `${p.code} · ${p.name}` : p.name}</option>)}
          </select>
          <button onClick={load} title="Refresh" className="h-9 w-9 rounded-md border border-[#222A35] text-[#8A95A5] hover:text-white flex items-center justify-center"><RefreshCw className="w-3.5 h-3.5" /></button>
          {projectId && (
            <button onClick={() => setEditing("new")} className="h-9 px-4 rounded-md bg-[#FF6B1A] hover:bg-[#FF7E33] text-white text-[12px] flex items-center gap-1.5"><Plus className="w-4 h-4" /> New daily log</button>
          )}
        </div>
      </div>

      {projects.length === 0 && !projectsLoading ? (
        <div className="rounded-xl border border-[#222A35] bg-[#11161D]">
          <EmptyState icon={FolderKanban} title="No projects yet" description="A daily log belongs to a project. Create a project first, then come back to record each day on site." />
        </div>
      ) : (
        <>
          {projectId && !loading && !loggedToday && (
            <button onClick={() => setEditing("new")} className="w-full text-left rounded-xl border border-[#FF6B1A]/30 bg-[#FF6B1A]/5 px-4 py-3 flex items-center gap-3">
              <AlertTriangle className="w-4 h-4 text-[#FF6B1A] shrink-0" />
              <span className="text-[12.5px] text-[#E6EAF0] flex-1">No log for today on {project?.name || "this project"} yet. Record it while the day is fresh.</span>
              <span className="text-[12px] text-[#FF6B1A] shrink-0">Write today's log →</span>
            </button>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-4 items-start">
            <div className="space-y-4 min-w-0 order-2 lg:order-1">
              <div className="grid grid-cols-3 gap-2">
                <Stat icon={CalendarCheck} label="Days logged" value={`${week.days} / 7`} sub="last 7 days" warn={week.days < 5} />
                <Stat icon={Users} label="Labour-days" value={String(week.people)} sub="last 7 days" />
                <Stat icon={Camera} label="Photos & videos" value={String(week.media)} sub="last 7 days" />
              </div>
              {!loading && logs.length === 0 ? (
                <div className="rounded-xl border border-[#222A35] bg-[#11161D]">
                  <EmptyState icon={ClipboardList} title="No daily logs for this project yet" description="Record each day: what got done, who was on site, deliveries, delays and visitors, with photos. It's your best evidence if there's ever a dispute." />
                  <div className="pb-6 text-center"><button onClick={() => setEditing("new")} className="h-9 px-4 rounded-md bg-[#FF6B1A] text-white text-[12px] inline-flex items-center gap-1.5"><Plus className="w-4 h-4" /> Write the first log</button></div>
                </div>
              ) : (
                <DailyLogFeed logs={logs} loading={loading} canEdit onEdit={(l) => setEditing(l)} onDelete={remove} />
              )}
            </div>
            <div className="order-1 lg:order-2 lg:sticky lg:top-4">
              {projectId && <SiteWeather projectId={projectId} compact />}
            </div>
          </div>
        </>
      )}

      {editing && projectId && (
        <DailyLogEditor
          projectId={projectId}
          projectLatLng={project?.lat != null && project?.lng != null ? { lat: project.lat, lng: project.lng } : null}
          log={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(row) => { upsert(row); setEditing(null); }}
        />
      )}
    </div>
  );
}

function Stat({ icon: Icon, label, value, sub, warn }: { icon: any; label: string; value: string; sub: string; warn?: boolean }) {
  return (
    <div className="rounded-xl border border-[#222A35] bg-[#11161D] p-3">
      <div className="text-[10px] text-[#5B6675] uppercase tracking-wider flex items-center gap-1"><Icon className="w-3 h-3" />{label}</div>
      <div className={`text-[18px] font-display mt-1 ${warn ? "text-[#F59E0B]" : "text-white"}`}>{value}</div>
      <div className="text-[10px] text-[#5B6675]">{sub}</div>
    </div>
  );
}

export default DailyLog;
