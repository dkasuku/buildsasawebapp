// Daily log: the day-by-day site record for a project. What was done, who was
// on site, plant and deliveries, the weather, and photo or video evidence.
// The form and the feed are shared with the project's Site folder
// (daily-log/DailyLogParts) so both screens record the day the same way.
import { useMemo, useState } from "react";
import { FolderKanban, Plus, Pencil, Trash2, Camera, CloudSun } from "lucide-react";
import { absoluteFileUrl, type DailyLogDto } from "../../services/api";
import { EmptyState } from "./EmptyState";
import { useProjects } from "./useProjects";
import { SiteWeather } from "./SiteWeather";
import { ImageLightbox } from "./ImageLightbox";
import { PageHeader } from "./PageShell";
import { DailyLogEditor, DailyLogFeed, parseUrls, useDailyLogs } from "./daily-log/DailyLogParts";

const iso = (d: Date) => {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
};
const dayOf = (l: DailyLogDto) => String(l.date).slice(0, 10);
const longDay = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" });
const time = (s?: string) => (s ? new Date(s).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "");
const chips = (s?: string | null) => (s || "").split(/[,\n;]+/).map((x) => x.trim()).filter(Boolean);

export function DailyLog() {
  const { projects, loading: projectsLoading } = useProjects();
  const [picked, setPicked] = useState("");
  const [range, setRange] = useState<7 | 14>(7);
  const projectId = picked || projects[0]?.id || "";
  const project = projects.find((p) => p.id === projectId);
  const { logs, loading, upsert, remove } = useDailyLogs(projectId);
  const [editing, setEditing] = useState<DailyLogDto | "new" | null>(null);

  const today = iso(new Date());
  const days = useMemo(() => Array.from({ length: range }, (_, i) => iso(new Date(Date.now() - (range - 1 - i) * 86400000))), [range]);
  const byDay = useMemo(() => {
    const m = new Map<string, DailyLogDto[]>();
    logs.forEach((l) => { const k = dayOf(l); if (!m.has(k)) m.set(k, []); m.get(k)!.push(l); });
    return m;
  }, [logs]);
  const inRange = logs.filter((l) => dayOf(l) >= days[0]);
  const stats = {
    logged: days.filter((d) => byDay.has(d)).length,
    labour: inRange.reduce((s, l) => s + (Number(l.headcount) || 0), 0),
    media: inRange.reduce((s, l) => s + parseUrls(l.photos).length + parseUrls(l.videos).length, 0),
    deliveries: inRange.filter((l) => (l.materials || "").trim()).length,
  };
  const todays = byDay.get(today) ?? [];
  const earlier = days.filter((d) => d !== today).reverse();
  const older = logs.filter((l) => dayOf(l) < days[0]);

  return (
    <div>
      <PageHeader
        title="Daily log"
        subtitle="Day-by-day site record — your evidence for claims, delays and disputes."
        actions={<>
          <label className="sr-only" htmlFor="dl-project">Project</label>
          <select id="dl-project" className="ws-select" style={{ minWidth: 200 }} value={projectId} onChange={(e) => setPicked(e.target.value)} disabled={projectsLoading || projects.length === 0}>
            {projectsLoading && <option value="">Loading projects…</option>}
            {!projectsLoading && projects.length === 0 && <option value="">No projects yet</option>}
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <label className="sr-only" htmlFor="dl-range">Period</label>
          <select id="dl-range" className="ws-select" value={range} onChange={(e) => setRange(Number(e.target.value) as 7 | 14)}>
            <option value={7}>This week</option>
            <option value={14}>Last 2 weeks</option>
          </select>
          {projectId && <button type="button" className="ws-btn-primary" onClick={() => setEditing("new")}><Plus aria-hidden /> New daily log</button>}
        </>}
      />
      <div className="ws-page">

      {projects.length === 0 && !projectsLoading ? (
        <div className="ws-card">
          <EmptyState icon={FolderKanban} title="No projects yet" description="A daily log belongs to a project. Create a project first, then come back to record each day on site." />
        </div>
      ) : (
        <>
          {/* Last N days strip */}
          <section className="ws-card flex flex-wrap items-center gap-x-6 gap-y-3 px-[18px] py-3" aria-label={`Last ${range} days`}>
            <div className="flex items-center gap-1" role="list" aria-label="Days logged">
              {days.map((d) => (
                <span key={d} role="listitem" title={`${longDay(d)}: ${byDay.has(d) ? "logged" : "not logged"}`} aria-label={`${longDay(d)}: ${byDay.has(d) ? "logged" : "not logged"}`}
                  className="w-3.5 h-3.5 rounded-[3px]" style={{ background: byDay.has(d) ? "var(--ws-primary)" : "var(--ws-divider)", outline: d === today ? "1.5px solid var(--ws-ink)" : undefined, outlineOffset: 1 }} />
              ))}
            </div>
            <StripStat strong={`${stats.logged} of ${range}`} text="days logged" />
            <StripStat strong={String(stats.labour)} text="labour-days" />
            <StripStat strong={String(stats.media)} text="photos & videos" />
            <StripStat strong={String(stats.deliveries)} text={stats.deliveries === 1 ? "day with deliveries" : "days with deliveries"} />
          </section>

          <div className="flex flex-wrap gap-6 items-start">
            <div className="ws-main">
              {loading ? <div className="ws-card h-40 animate-pulse" /> : todays.length > 0 ? (
                todays.map((l) => <TodayCard key={l.id} log={l} onEdit={() => setEditing(l)} onDelete={() => remove(l)} />)
              ) : (
                <section className="ws-card" aria-label="Today">
                  <div className="ws-card-head">
                    <div className="flex items-center gap-2"><h2 className="ws-h2">{longDay(today)}</h2><span className="ws-pill ws-pill-ink">Today</span></div>
                  </div>
                  <div className="ws-card-body">
                    <div className="ws-dashed-row">No log for today on {project?.name || "this project"} yet. Record it while the day is fresh with <strong>New daily log</strong>.</div>
                  </div>
                </section>
              )}

              <section className="ws-card" aria-labelledby="dl-earlier">
                <div className="ws-card-head"><h2 id="dl-earlier" className="ws-h2">{range === 7 ? "Earlier this week" : "Earlier in the last 2 weeks"}</h2></div>
                <ul>
                  {earlier.map((d) => {
                    const list = byDay.get(d) ?? [];
                    const weekend = [0, 6].includes(new Date(`${d}T12:00:00`).getDay());
                    return (
                      <li key={d} className="flex items-center gap-3 px-[18px] py-2.5" style={{ borderBottom: "1px solid var(--ws-divider)", fontSize: 13.5 }}>
                        <span style={{ width: 150, fontWeight: 500 }}>{longDay(d)}</span>
                        {list.length ? (
                          <>
                            <span className="ws-pill ws-pill-green">Logged</span>
                            <span className="truncate flex-1" style={{ color: "var(--ws-muted)" }}>{list.reduce((s, l) => s + (Number(l.headcount) || 0), 0)} on site · {list[0].notes?.slice(0, 80) || list[0].crew}</span>
                            <button type="button" className="ws-link" onClick={() => setEditing(list[0])}>Open</button>
                          </>
                        ) : (
                          <>
                            <span className="ws-pill">{weekend ? "No work day?" : "Not logged"}</span>
                            <span className="flex-1" />
                            <button type="button" className="ws-link" onClick={() => setEditing("new")}>Add log</button>
                          </>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>

              {older.length > 0 && (
                <section aria-labelledby="dl-older" className="flex flex-col gap-3">
                  <h2 id="dl-older" className="ws-h2">Older entries</h2>
                  <DailyLogFeed logs={older} canEdit onEdit={(l) => setEditing(l)} onDelete={remove} />
                </section>
              )}
            </div>

            <aside className="ws-aside" aria-label="Site conditions">
              {projectId && <SiteWeather projectId={projectId} compact />}
              <section className="ws-card ws-card-body">
                <h2 className="ws-h2">Why log every day</h2>
                <p className="ws-sub mt-1.5">A dated record of who was on site, what got done and what held you up is what wins extension-of-time claims and settles payment disputes. Two minutes at the end of each day is enough.</p>
              </section>
            </aside>
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
    </div>
  );
}

function StripStat({ strong, text }: { strong: string; text: string }) {
  return <span style={{ fontSize: 13.5, color: "var(--ws-muted)" }}><strong style={{ color: "var(--ws-text)", fontWeight: 600 }}>{strong}</strong> {text}</span>;
}

function TodayCard({ log, onEdit, onDelete }: { log: DailyLogDto; onEdit: () => void; onDelete: () => void }) {
  const [lightbox, setLightbox] = useState<number | null>(null);
  const photos = parseUrls(log.photos).map((u) => absoluteFileUrl(u));
  const trades = chips(log.labour);
  return (
    <section className="ws-card" aria-label="Today's entry">
      <div className="ws-card-head">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="ws-h2">{longDay(dayOf(log))}</h2>
          <span className="ws-pill ws-pill-ink">Today</span>
          {log.weather && <span className="ws-pill ws-pill-blue"><CloudSun className="w-3.5 h-3.5" aria-hidden />{log.weather}</span>}
          <span className="ws-pill">{log.headcount} on site</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="ws-sub">{log.crew ? `Crew: ${log.crew}` : "Logged"}{log.createdAt ? ` · ${time(log.createdAt)}` : ""}</span>
          <button type="button" className="ws-btn" onClick={onEdit}><Pencil aria-hidden /> Edit</button>
          <button type="button" className="ws-icon-btn" onClick={onDelete} aria-label="Delete this entry"><Trash2 /></button>
        </div>
      </div>
      <div className="ws-card-body ws-grid-2" style={{ gap: 20 }}>
        <div className="flex flex-col gap-4">
          <Block title="Work done">{log.notes || <span style={{ color: "var(--ws-muted)" }}>Nothing written.</span>}</Block>
          <Block title="Plant & deliveries">
            {log.plant || log.materials ? <>{log.plant && <div>Plant: {log.plant}</div>}{log.materials && <div>Delivered: {log.materials}</div>}</> : <span style={{ color: "var(--ws-muted)" }}>None recorded.</span>}
          </Block>
        </div>
        <div className="flex flex-col gap-4">
          <Block title="Labour">
            {trades.length ? <div className="flex flex-wrap gap-1.5">{trades.map((t) => <span key={t} className="ws-pill">{t}</span>)}</div> : <span style={{ color: "var(--ws-muted)" }}>{log.headcount} people, trades not listed.</span>}
          </Block>
          {photos.length ? (
            <div className="flex gap-2 flex-wrap">
              {photos.map((src, i) => (
                <button key={src} type="button" onClick={() => setLightbox(i)} aria-label={`Open photo ${i + 1}`}><img src={src} alt="" className="h-16 w-20 rounded-md object-cover" style={{ border: "1px solid var(--ws-border)" }} /></button>
              ))}
            </div>
          ) : (
            <button type="button" onClick={onEdit} className="ws-dashed-row flex items-center gap-2 text-left w-full"><Camera className="w-4 h-4" aria-hidden /> Add photos from site</button>
          )}
        </div>
      </div>
      {lightbox != null && <ImageLightbox images={photos} startIndex={lightbox} onClose={() => setLightbox(null)} />}
    </section>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 style={{ fontSize: 12.5, color: "var(--ws-muted)", fontWeight: 500, marginBottom: 4 }}>{title}</h3>
      <div style={{ fontSize: 13.5, color: "var(--ws-text)", whiteSpace: "pre-wrap" }}>{children}</div>
    </div>
  );
}

export default DailyLog;
