// Daily Log — the daily site record: which crew was on site, how many people,
// where, and what happened.
//
// Rewritten because the previous version was unusable in a real workspace:
//   * It silently locked onto the FIRST project in the list, with no way to pick
//     another — so logs for every other project were impossible.
//   * "Crew" was a free-text box, unrelated to the Crews module, and headcount
//     was typed by hand. Now the crew is chosen from the crews actually created
//     in the Crews module and the headcount fills in from that roster.
//   * A failed save was swallowed and the row was added to the list anyway, so
//     an unsaved log looked saved until the page was reloaded.
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ClipboardList, Calendar, Users, MapPin, Plus, Trash2, CloudSun, FolderKanban, RefreshCw } from "lucide-react";
import api, { parseCrewMembers, type CrewDto, type DailyLogDto } from "../../services/api";
import { EmptyState } from "./EmptyState";
import { useProjects } from "./useProjects";

type LogRow = DailyLogDto;

const WEATHER = ["", "Clear", "Cloudy", "Light rain", "Heavy rain", "Windy", "Hot", "Cold"];

const todayISO = () => new Date().toISOString().slice(0, 10);

const emptyForm = () => ({
  date: todayISO(),
  crew: "",
  crewId: "",
  headcount: 0,
  location: "",
  notes: "",
  weather: "",
});

export function DailyLog() {
  const { projects, loading: projectsLoading } = useProjects();
  const [projectId, setProjectId] = useState("");
  const [entries, setEntries] = useState<LogRow[]>([]);
  const [crews, setCrews] = useState<CrewDto[]>([]);
  const [form, setForm] = useState(emptyForm());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  // Whether the headcount was typed over the roster figure. Respected on save so
  // a deliberate correction (three of eight absent) is not overwritten.
  const [headcountEdited, setHeadcountEdited] = useState(false);

  // Default to the first project once the list arrives, but keep whatever the
  // user has selected.
  useEffect(() => {
    if (!projectId && projects.length) setProjectId(projects[0].id);
  }, [projects, projectId]);

  // Crews are workspace-wide; loaded once so the dropdown is always populated.
  useEffect(() => {
    api.getCrews().then((rows) => setCrews(rows ?? [])).catch(() => setCrews([]));
  }, []);

  const loadLogs = async (pid: string) => {
    if (!pid) { setEntries([]); return; }
    setLoading(true);
    try { setEntries((await api.getDailyLog(pid)) ?? []); }
    catch (e: any) { toast.error(`Could not load daily logs — ${e?.message || "unknown error"}`); setEntries([]); }
    finally { setLoading(false); }
  };
  useEffect(() => { loadLogs(projectId); }, [projectId]);

  // Crews relevant to the selected project first, then the rest. A crew created
  // before crews were linked to projects has no projectId, so it stays available
  // rather than disappearing from the list.
  const crewOptions = useMemo(() => {
    const project = projects.find((p) => p.id === projectId);
    const mine = crews.filter((c) => c.projectId === projectId || (project && c.project === project.name));
    const others = crews.filter((c) => !mine.includes(c));
    return { mine, others };
  }, [crews, projectId, projects]);

  const headcountFor = (crew?: CrewDto | null) => (crew ? parseCrewMembers(crew.members).length : 0);

  const pickCrew = (crewId: string) => {
    const crew = crews.find((c) => c.id === crewId) || null;
    setForm((s) => ({
      ...s,
      crewId,
      crew: crew?.name ?? "",
      // Headcount comes from the crew's roster automatically. A manual override
      // already made is preserved.
      headcount: headcountEdited ? s.headcount : headcountFor(crew),
      // The crew's usual work location is a sensible default for the log.
      location: s.location || crew?.location || "",
    }));
  };

  const addLog = async () => {
    if (!projectId) return toast.error("Pick a project for this log");
    if (!form.crew.trim()) return toast.error("Pick a crew — create one in the Crews module if the list is empty");
    if (saving) return;
    setSaving(true);
    try {
      const row = await api.createDailyLog(projectId, {
        date: form.date || todayISO(),
        crew: form.crew,
        crewId: form.crewId || null,
        headcount: form.headcount,
        location: form.location,
        notes: form.notes,
        weather: form.weather || null,
      } as any);
      setEntries((prev) => [row, ...prev]);
      setForm(emptyForm());
      setHeadcountEdited(false);
      toast.success("Daily log added");
    } catch (e: any) {
      // The form keeps its values so nothing is retyped, and the row is NOT
      // added to the list — it was never saved.
      toast.error(`Could not save the log — ${e?.message || "unknown error"}`, { duration: 8000 });
    } finally {
      setSaving(false);
    }
  };

  const delLog = async (id?: string) => {
    if (!id || !projectId) return;
    const snapshot = entries;
    setEntries((prev) => prev.filter((r) => r.id !== id));
    try { await api.deleteDailyLog(projectId, id); toast.success("Log deleted"); }
    catch (e: any) {
      // Put it back — it is still on the server.
      setEntries(snapshot);
      toast.error(`Could not delete the log — ${e?.message || "unknown error"}`);
    }
  };

  const selectedCrew = crews.find((c) => c.id === form.crewId) || null;
  const rosterSize = headcountFor(selectedCrew);
  const totalPeopleLogged = entries.reduce((s, e) => s + (Number(e.headcount) || 0), 0);

  return (
    <div className="px-4 sm:px-7 py-5 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[13px] text-white font-display">Daily Log</div>
          <div className="text-[11px] text-[#8A95A5]">Crew headcount, locations &amp; site notes — the daily site record</div>
        </div>
        <div className="flex items-end gap-2">
          <div>
            <label className="text-[10px] text-[#5B6675] uppercase tracking-wider block mb-1">Project</label>
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              disabled={projectsLoading || projects.length === 0}
              className="h-9 min-w-[200px] bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-[12px] text-white focus:outline-none focus:border-[#FF6B1A] disabled:opacity-60"
            >
              {projectsLoading && <option value="">Loading projects…</option>}
              {!projectsLoading && projects.length === 0 && <option value="">No projects yet</option>}
              {projects.map((p) => <option key={p.id} value={p.id}>{p.code ? `${p.code} · ${p.name}` : p.name}</option>)}
            </select>
          </div>
          <button
            onClick={() => loadLogs(projectId)}
            title="Refresh"
            className="h-9 w-9 rounded-md border border-[#222A35] text-[#8A95A5] hover:text-white flex items-center justify-center"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {projects.length === 0 && !projectsLoading ? (
        <div className="rounded-xl border border-[#222A35] bg-[#11161D]">
          <EmptyState
            icon={FolderKanban}
            title="No projects yet"
            description="A daily log belongs to a project. Create a project first, then come back to record crews and site notes."
          />
        </div>
      ) : (
        <>
          {/* Entry form */}
          <div className="rounded-xl border border-[#222A35] bg-[#11161D] p-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
              <div>
                <label className="text-[11px] text-[#8A95A5] block mb-1">Date</label>
                <input
                  type="date"
                  value={form.date}
                  onChange={(e) => setForm((s) => ({ ...s, date: e.target.value }))}
                  className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-[12px] text-white focus:outline-none focus:border-[#FF6B1A]"
                />
              </div>
              <div>
                <label className="text-[11px] text-[#8A95A5] block mb-1">Crew *</label>
                <select
                  value={form.crewId}
                  onChange={(e) => pickCrew(e.target.value)}
                  className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-[12px] text-white focus:outline-none focus:border-[#FF6B1A]"
                >
                  <option value="">
                    {crews.length ? "Select a crew…" : "No crews yet — create one in Crews"}
                  </option>
                  {/* Crews on this project are listed first; the rest stay
                      reachable because a crew may work across projects. */}
                  {crewOptions.mine.length > 0 && (
                    <optgroup label="On this project">
                      {crewOptions.mine.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}{c.trade ? ` · ${c.trade}` : ""} ({parseCrewMembers(c.members).length})</option>
                      ))}
                    </optgroup>
                  )}
                  {crewOptions.others.length > 0 && (
                    <optgroup label="Other crews">
                      {crewOptions.others.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}{c.trade ? ` · ${c.trade}` : ""} ({parseCrewMembers(c.members).length})</option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </div>
              <div>
                <label className="text-[11px] text-[#8A95A5] block mb-1">People on site</label>
                <input
                  type="number"
                  min={0}
                  value={form.headcount}
                  onChange={(e) => { setHeadcountEdited(true); setForm((s) => ({ ...s, headcount: Number(e.target.value) || 0 })); }}
                  className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-[12px] text-white focus:outline-none focus:border-[#FF6B1A]"
                />
                <div className="text-[10px] text-[#5B6675] mt-1">
                  {selectedCrew
                    ? headcountEdited && form.headcount !== rosterSize
                      ? <>Roster has {rosterSize} · <button type="button" onClick={() => { setHeadcountEdited(false); setForm((s) => ({ ...s, headcount: rosterSize })); }} className="text-[#FF6B1A] hover:underline">reset</button></>
                      : `Filled from the ${selectedCrew.name} roster — edit if some are absent`
                    : "Fills automatically when you pick a crew"}
                </div>
              </div>
              <div>
                <label className="text-[11px] text-[#8A95A5] block mb-1">Weather</label>
                <select
                  value={form.weather}
                  onChange={(e) => setForm((s) => ({ ...s, weather: e.target.value }))}
                  className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-[12px] text-white focus:outline-none focus:border-[#FF6B1A]"
                >
                  {WEATHER.map((w) => <option key={w} value={w}>{w || "Not recorded"}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-[11px] text-[#8A95A5] block mb-1">Location / work area</label>
                <input
                  value={form.location}
                  onChange={(e) => setForm((s) => ({ ...s, location: e.target.value }))}
                  placeholder="e.g. Level 3 east wing"
                  className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-[12px] text-white placeholder:text-[#5B6675] focus:outline-none focus:border-[#FF6B1A]"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="text-[11px] text-[#8A95A5] block mb-1">Notes</label>
                <input
                  value={form.notes}
                  onChange={(e) => setForm((s) => ({ ...s, notes: e.target.value }))}
                  placeholder="Work done, deliveries, delays, visitors…"
                  className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-[12px] text-white placeholder:text-[#5B6675] focus:outline-none focus:border-[#FF6B1A]"
                />
              </div>
            </div>
            <div className="flex justify-end">
              <button
                onClick={addLog}
                disabled={saving}
                className="h-9 px-4 rounded-md bg-[#FF6B1A] hover:bg-[#FF7E33] disabled:opacity-60 text-white text-[12px] flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" /> {saving ? "Saving…" : "Add log"}
              </button>
            </div>
          </div>

          {entries.length > 0 && (
            <div className="flex items-center gap-4 text-[11px] text-[#8A95A5]">
              <span>{entries.length} log{entries.length === 1 ? "" : "s"}</span>
              <span className="text-[#5B6675]">·</span>
              <span>{totalPeopleLogged} people recorded in total</span>
            </div>
          )}

          {/* Log list */}
          <div className="grid gap-3">
            {loading && [0, 1].map((i) => <div key={i} className="h-20 rounded-xl border border-[#222A35] bg-[#11161D] animate-pulse" />)}
            {!loading && entries.map((e) => (
              <div key={e.id ?? `${e.date}-${e.crew}`} className="rounded-xl border border-[#222A35] bg-[#11161D] p-4 space-y-2">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-white">
                  <span className="flex items-center gap-1">
                    <Calendar className="w-4 h-4 text-[#FF6B1A]" />
                    {e.date ? new Date(e.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"}
                  </span>
                  <span className="text-[#5B6675] hidden sm:inline">|</span>
                  <span className="flex items-center gap-1"><Users className="w-4 h-4 text-[#5B6675]" /> {e.crew} · {e.headcount} {e.headcount === 1 ? "person" : "people"}</span>
                  {e.location && (
                    <>
                      <span className="text-[#5B6675] hidden sm:inline">|</span>
                      <span className="flex items-center gap-1"><MapPin className="w-4 h-4 text-[#5B6675]" /> {e.location}</span>
                    </>
                  )}
                  {e.weather && (
                    <>
                      <span className="text-[#5B6675] hidden sm:inline">|</span>
                      <span className="flex items-center gap-1"><CloudSun className="w-4 h-4 text-[#5B6675]" /> {e.weather}</span>
                    </>
                  )}
                  {e.id && (
                    <button onClick={() => delLog(e.id)} className="ml-auto text-[11px] text-[#FF6B1A] hover:underline flex items-center gap-1">
                      <Trash2 className="w-3 h-3" /> Delete
                    </button>
                  )}
                </div>
                {e.notes && <div className="text-[12px] text-[#C2CAD6] leading-snug">{e.notes}</div>}
              </div>
            ))}
            {!loading && entries.length === 0 && (
              <div className="rounded-xl border border-[#222A35] bg-[#11161D]">
                <EmptyState
                  icon={ClipboardList}
                  title="No daily logs for this project yet"
                  description="Record the crew on site, how many people turned up, and what happened. Crews come from the Crews module."
                />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default DailyLog;
