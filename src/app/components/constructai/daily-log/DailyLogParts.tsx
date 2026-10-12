// The daily log, shared by the Daily Log page and each project's Site folder so
// there is one way to record the day. (There used to be two forms writing the
// same records: the page had no photos and a one-line note, the project folder
// had photos but ignored the Crews module.)
//
// An entry is the day's record for one crew: what got done, who was there,
// plant and deliveries, the weather (filled in from the forecast), where on site
// (typed, GPS or pinned on a map), and photos or a short video as evidence.
// Media can be shown to the client in the portal or kept internal.

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Camera, Check, CloudSun, Eye, EyeOff, Loader2, MapPin, Package, Pencil, Trash2, Truck, Users, Video, ChevronDown, X,
} from "lucide-react";
import api, { absoluteFileUrl, parseCrewMembers, type CrewDto, type DailyLogDto } from "../../../services/api";
import { pickFiles, useFileUpload } from "../useFileUpload";
import { UploadTray } from "../UploadTray";
import { ImageLightbox } from "../ImageLightbox";
import { MapPicker } from "../MapPicker";
import { currentPosition, getForecast, logWeatherFor, describeWeather } from "../../../services/weather";

export const LOG_WEATHER = ["Clear", "Cloudy", "Light rain", "Heavy rain", "Windy", "Hot", "Cold"];
const todayISO = () => new Date().toISOString().slice(0, 10);
export const parseUrls = (v?: string[] | string | null): string[] => {
  if (!v) return [];
  if (Array.isArray(v)) return v.filter(Boolean);
  try { const a = JSON.parse(v); return Array.isArray(a) ? a.filter(Boolean) : []; } catch { return []; }
};

const input = "w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-3 text-[12px] text-white placeholder:text-[#5B6675] focus:outline-none focus:border-[#FF6B1A]";
const area = "w-full bg-[#0A0E14] border border-[#222A35] rounded-md px-3 py-2 text-[12px] text-white placeholder:text-[#5B6675] focus:outline-none focus:border-[#FF6B1A]";
const lbl = "text-[11px] text-[#8A95A5] block mb-1";

// ── Editor ────────────────────────────────────────────────────────────────────

export function DailyLogEditor({ projectId, projectLatLng, log, onClose, onSaved }: {
  projectId: string;
  /** The project's own pin, used for the weather when the entry has none. */
  projectLatLng?: { lat: number; lng: number } | null;
  log?: DailyLogDto | null;
  onClose: () => void;
  onSaved: (row: DailyLogDto) => void;
}) {
  const editing = !!log;
  const [crews, setCrews] = useState<CrewDto[]>([]);
  const [f, setF] = useState({
    date: log?.date ? String(log.date).slice(0, 10) : todayISO(),
    crew: log?.crew || "", crewId: log?.crewId || "", headcount: log ? String(log.headcount ?? "") : "",
    location: log?.location || "", weather: log?.weather || "",
    notes: log?.notes || "", labour: log?.labour || "", plant: log?.plant || "", materials: log?.materials || "",
  });
  const [latLng, setLatLng] = useState<{ lat: number; lng: number } | null>(log?.lat != null && log?.lng != null ? { lat: log.lat, lng: log.lng } : null);
  const [photos, setPhotos] = useState<string[]>(parseUrls(log?.photos));
  const [videos, setVideos] = useState<string[]>(parseUrls(log?.videos));
  const [clientVisible, setClientVisible] = useState(log?.clientVisible ?? true);
  const [more, setMore] = useState(!!(log?.labour || log?.plant || log?.materials));
  const [weatherNote, setWeatherNote] = useState("");
  const [fetchingWeather, setFetchingWeather] = useState(false);
  const [busy, setBusy] = useState(false);
  const uploader = useFileUpload();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((x) => ({ ...x, [k]: e.target.value }));

  useEffect(() => { api.getCrews().then((r) => setCrews(r ?? [])).catch(() => setCrews([])); }, []);

  const fillWeather = async (quiet = false) => {
    setFetchingWeather(true);
    try {
      const at = latLng || projectLatLng || await currentPosition();
      if (!at) { if (!quiet) toast.error("Pin the location or allow location access to get the weather"); return; }
      const fc = await getForecast(at.lat, at.lng);
      setF((x) => ({ ...x, weather: logWeatherFor(fc) }));
      setWeatherNote(`${describeWeather(fc.code)}, ${fc.tempC}°C now`);
    } catch { if (!quiet) toast.error("Couldn't reach the weather service. Pick the weather by hand."); }
    finally { setFetchingWeather(false); }
  };
  // A new entry for today fills the weather in by itself.
  useEffect(() => { if (!editing && f.date === todayISO() && (projectLatLng || latLng)) fillWeather(true); }, []);

  // Typing a crew name that matches a crew in the Crews module links it and
  // fills the headcount from its roster; any other name is kept as typed.
  const pickCrew = (name: string) => {
    const c = crews.find((x) => x.name.toLowerCase() === name.trim().toLowerCase());
    setF((x) => ({
      ...x, crew: name, crewId: c?.id || "",
      headcount: c && !x.headcount ? String(parseCrewMembers(c.members).length) : x.headcount,
      location: x.location || c?.location || "",
    }));
  };

  const addMedia = async (kind: "photo" | "video") => {
    const files = await pickFiles(kind === "photo" ? { multiple: true, accept: "image/*", capture: "environment" } : { multiple: false, accept: "video/*", capture: "environment" });
    if (!files.length) return;
    const urls = await uploader.upload(files);
    if (kind === "photo") setPhotos((p) => [...p, ...urls]); else setVideos((v) => [...v, ...urls]);
  };

  const save = async () => {
    if (!f.crew.trim()) return toast.error("Pick or type the crew on site");
    if (!f.notes.trim()) return toast.error("Write what was done today");
    if (uploader.busy) return toast.error("Wait for the uploads to finish");
    setBusy(true);
    const payload = { ...f, crewId: f.crewId || null, headcount: Number(f.headcount) || 0, weather: f.weather || null, photos, videos, lat: latLng?.lat ?? null, lng: latLng?.lng ?? null, clientVisible } as any;
    try {
      const row = editing ? await api.updateDailyLog(projectId, log!.id, payload) : await api.createDailyLog(projectId, payload);
      toast.success(editing ? "Entry updated" : "Daily log saved");
      onSaved(row);
    } catch (e: any) { toast.error(`Could not save: ${e?.message || "unknown error"}`, { duration: 8000 }); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-[#11161D] border border-[#222A35] rounded-t-2xl sm:rounded-xl w-full sm:max-w-2xl max-h-[94vh] flex flex-col">
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-[#222A35]">
          <div>
            <div className="text-[15px] text-white font-display">{editing ? "Edit daily log" : "New daily log"}</div>
            <div className="text-[11.5px] text-[#8A95A5] mt-0.5">The day's record. It protects you in claims and disputes, so be specific.</div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-md text-[#8A95A5] hover:text-white hover:bg-[#161C24] flex items-center justify-center"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div><label className={lbl}>Date</label><input type="date" value={f.date} max={todayISO()} onChange={set("date")} className={input} /></div>
            <div className="col-span-1 sm:col-span-2">
              <label className={lbl}>Crew on site *</label>
              <input list="dl-crews" value={f.crew} onChange={(e) => pickCrew(e.target.value)} placeholder="Pick a crew or type a name" className={input} />
              <datalist id="dl-crews">{crews.map((c) => <option key={c.id} value={c.name}>{c.trade || ""}</option>)}</datalist>
            </div>
            <div><label className={lbl}>People on site</label><input type="number" min={0} value={f.headcount} onChange={set("headcount")} className={input} /></div>
          </div>

          <div>
            <label className={lbl}>Work done today *</label>
            <textarea value={f.notes} onChange={set("notes")} rows={4} placeholder={"e.g. Poured ground-floor slab (Block B), 18 m³.\nDelay: 2 hrs waiting for ready-mix.\nVisitor: structural engineer inspected rebar, approved."} className={area} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={lbl}>Where on site</label>
              <MapPicker value={f.location} latLng={latLng} onChange={(v) => setF((x) => ({ ...x, location: v }))} onLatLngChange={setLatLng} placeholder="e.g. Block B, ground floor" />
            </div>
            <div>
              <label className={lbl}>Weather</label>
              <div className="flex gap-2">
                <select value={f.weather} onChange={set("weather")} className={input}>
                  <option value="">Not recorded</option>
                  {[...new Set([...LOG_WEATHER, f.weather].filter(Boolean))].map((w) => <option key={w}>{w}</option>)}
                </select>
                <button type="button" onClick={() => fillWeather(false)} disabled={fetchingWeather} title="Fill from today's forecast" className="h-9 px-3 shrink-0 rounded-md border border-[#222A35] text-[11px] text-[#8A95A5] hover:text-white flex items-center gap-1.5">
                  {fetchingWeather ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CloudSun className="w-3.5 h-3.5" />} Auto
                </button>
              </div>
              {weatherNote && <div className="text-[10.5px] text-[#5B6675] mt-1">From the forecast: {weatherNote}</div>}
            </div>
          </div>

          <div>
            <button type="button" onClick={() => setMore((m) => !m)} className="text-[11.5px] text-[#FF6B1A] flex items-center gap-1">
              <ChevronDown className={`w-3.5 h-3.5 transition ${more ? "rotate-180" : ""}`} /> Labour, plant and deliveries {more ? "" : "(optional)"}
            </button>
            {more && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-2">
                <div><label className={lbl}>Labour</label><textarea value={f.labour} onChange={set("labour")} rows={3} placeholder={"4 masons\n6 helpers"} className={area} /></div>
                <div><label className={lbl}>Plant & equipment</label><textarea value={f.plant} onChange={set("plant")} rows={3} placeholder={"Concrete mixer ×1\nPoker vibrator ×2"} className={area} /></div>
                <div><label className={lbl}>Materials delivered</label><textarea value={f.materials} onChange={set("materials")} rows={3} placeholder={"200 bags cement\n7 t ballast"} className={area} /></div>
              </div>
            )}
          </div>

          <div>
            <label className={lbl}>Photos and video evidence</label>
            <div className="flex gap-2 flex-wrap">
              {photos.map((u) => (
                <div key={u} className="relative">
                  <img src={absoluteFileUrl(u)} alt="" className="h-16 w-24 rounded-md object-cover border border-[#222A35]" />
                  <button onClick={() => setPhotos((p) => p.filter((x) => x !== u))} className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-[#11161D] border border-[#222A35] text-[#8A95A5] hover:text-red-400 flex items-center justify-center" aria-label="Remove photo"><X className="w-3 h-3" /></button>
                </div>
              ))}
              {videos.map((u) => (
                <div key={u} className="relative">
                  <video src={absoluteFileUrl(u)} className="h-16 w-24 rounded-md object-cover border border-[#222A35] bg-black" muted preload="metadata" />
                  <Video className="absolute bottom-1 left-1 w-3.5 h-3.5 text-white drop-shadow" />
                  <button onClick={() => setVideos((v) => v.filter((x) => x !== u))} className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-[#11161D] border border-[#222A35] text-[#8A95A5] hover:text-red-400 flex items-center justify-center" aria-label="Remove video"><X className="w-3 h-3" /></button>
                </div>
              ))}
              <button onClick={() => addMedia("photo")} className="h-16 w-24 rounded-md border-2 border-dashed border-[#222A35] flex flex-col items-center justify-center gap-1 text-[#8A95A5] hover:border-[#FF6B1A] hover:text-white"><Camera className="w-4 h-4" /><span className="text-[10px]">Photos</span></button>
              <button onClick={() => addMedia("video")} className="h-16 w-24 rounded-md border-2 border-dashed border-[#222A35] flex flex-col items-center justify-center gap-1 text-[#8A95A5] hover:border-[#FF6B1A] hover:text-white"><Video className="w-4 h-4" /><span className="text-[10px]">Short video</span></button>
            </div>
            <div className="text-[10.5px] text-[#5B6675] mt-1">Videos up to 20 MB (about 30–60 seconds).</div>
            {uploader.pending.length > 0 && <div className="mt-2"><UploadTray state={uploader} /></div>}
          </div>

          <label className="flex items-start gap-2.5 rounded-lg border border-[#222A35] bg-[#0A0E14] px-3 py-2.5 cursor-pointer">
            <input type="checkbox" checked={clientVisible} onChange={(e) => setClientVisible(e.target.checked)} className="mt-0.5 accent-[#FF6B1A]" />
            <span className="text-[12px] text-[#C2CAD6]">Show these photos and videos to the client in the portal
              <span className="block text-[10.5px] text-[#5B6675]">Untick for anything internal, like an accident or a supplier problem. The written notes are never shown to the client.</span>
            </span>
          </label>
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-[#222A35]">
          <button onClick={onClose} className="h-9 px-3 rounded-md border border-[#222A35] text-[12px] text-[#C2CAD6] hover:text-white">Cancel</button>
          <button onClick={save} disabled={busy || uploader.busy} className="h-9 px-4 rounded-md bg-[#FF6B1A] hover:bg-[#FF7E33] disabled:opacity-60 text-white text-[12px] flex items-center gap-1.5">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} {editing ? "Save changes" : "Save daily log"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Feed ──────────────────────────────────────────────────────────────────────

export function DailyLogFeed({ logs, loading, canEdit, onEdit, onDelete }: {
  logs: DailyLogDto[];
  loading?: boolean;
  canEdit: boolean;
  onEdit: (log: DailyLogDto) => void;
  onDelete: (log: DailyLogDto) => void;
}) {
  const [lightbox, setLightbox] = useState<{ images: string[]; index: number } | null>(null);
  const groups = useMemo(() => {
    const m = new Map<string, DailyLogDto[]>();
    logs.forEach((l) => { const k = String(l.date).slice(0, 10); if (!m.has(k)) m.set(k, []); m.get(k)!.push(l); });
    return [...m.entries()];
  }, [logs]);

  if (loading) return <div className="space-y-3">{[0, 1].map((i) => <div key={i} className="h-28 rounded-xl border border-[#222A35] bg-[#11161D] animate-pulse" />)}</div>;

  return (
    <div className="space-y-5">
      {groups.map(([day, list]) => (
        <div key={day}>
          <div className="flex items-baseline gap-2 mb-2">
            <div className="text-[13px] text-white font-display">{dayLabel(day)}</div>
            <div className="text-[11px] text-[#5B6675]">{new Date(day).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short", year: "numeric" })} · {list.reduce((s, l) => s + (Number(l.headcount) || 0), 0)} people</div>
          </div>
          <div className="space-y-2.5">
            {list.map((l) => {
              const photos = parseUrls(l.photos).map((u) => absoluteFileUrl(u));
              const videos = parseUrls(l.videos).map((u) => absoluteFileUrl(u));
              return (
                <div key={l.id} className="rounded-xl border border-[#222A35] bg-[#11161D] p-4">
                  <div className="flex items-start gap-2 flex-wrap">
                    <span className="text-[12.5px] text-white flex items-center gap-1.5"><Users className="w-3.5 h-3.5 text-[#FF6B1A]" />{l.crew}<span className="text-[#8A95A5]">· {l.headcount} {l.headcount === 1 ? "person" : "people"}</span></span>
                    {l.weather && <span className="text-[10.5px] px-2 py-0.5 rounded-full bg-[#3B82F6]/15 text-[#60A5FA] flex items-center gap-1"><CloudSun className="w-3 h-3" />{l.weather}</span>}
                    {(photos.length > 0 || videos.length > 0) && (l.clientVisible === false
                      ? <span className="text-[10.5px] px-2 py-0.5 rounded-full bg-[#222A35] text-[#8A95A5] flex items-center gap-1"><EyeOff className="w-3 h-3" />Internal</span>
                      : <span className="text-[10.5px] px-2 py-0.5 rounded-full bg-[#22C55E]/10 text-[#22C55E] flex items-center gap-1"><Eye className="w-3 h-3" />Client can see media</span>)}
                    {canEdit && (
                      <div className="ml-auto flex items-center gap-3 text-[11px] [&_button]:text-[11px]">
                        <button onClick={() => onEdit(l)} className="text-[#8A95A5] hover:text-white flex items-center gap-1"><Pencil className="w-3 h-3" />Edit</button>
                        <button onClick={() => onDelete(l)} className="text-[#8A95A5] hover:text-red-400 flex items-center gap-1"><Trash2 className="w-3 h-3" /></button>
                      </div>
                    )}
                  </div>
                  {l.location && (
                    <div className="text-[11px] text-[#8A95A5] mt-1 flex items-center gap-1">
                      <MapPin className="w-3 h-3" />
                      {l.lat != null && l.lng != null
                        ? <a href={`https://www.openstreetmap.org/?mlat=${l.lat}&mlon=${l.lng}#map=18/${l.lat}/${l.lng}`} target="_blank" rel="noopener noreferrer" className="hover:text-white underline decoration-dotted">{l.location}</a>
                        : l.location}
                    </div>
                  )}
                  {l.notes && <p className="text-[12.5px] text-[#D5DBE3] mt-2 whitespace-pre-wrap leading-relaxed">{l.notes}</p>}
                  {(l.labour || l.plant || l.materials) && (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-2.5">
                      <Cell icon={Users} label="Labour" value={l.labour} />
                      <Cell icon={Truck} label="Plant" value={l.plant} />
                      <Cell icon={Package} label="Delivered" value={l.materials} />
                    </div>
                  )}
                  {(photos.length > 0 || videos.length > 0) && (
                    <div className="flex gap-2 mt-3 overflow-x-auto pb-1">
                      {photos.map((src, i) => (
                        <button key={`${src}-${i}`} onClick={() => setLightbox({ images: photos, index: i })} className="shrink-0">
                          <img src={src} alt="" loading="lazy" className="h-20 w-28 rounded-md object-cover border border-[#222A35] hover:border-[#FF6B1A]" />
                        </button>
                      ))}
                      {videos.map((src) => <video key={src} src={src} controls preload="metadata" className="h-20 w-36 rounded-md border border-[#222A35] bg-black shrink-0" />)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {lightbox && <ImageLightbox images={lightbox.images} startIndex={lightbox.index} onClose={() => setLightbox(null)} />}
    </div>
  );
}

function Cell({ icon: Icon, label, value }: { icon: any; label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="rounded-lg border border-[#222A35] bg-[#0A0E14] px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-[#5B6675] flex items-center gap-1"><Icon className="w-3 h-3" /> {label}</div>
      <div className="text-[11.5px] text-[#C2CAD6] whitespace-pre-wrap mt-0.5">{value}</div>
    </div>
  );
}

function dayLabel(iso: string) {
  const today = todayISO();
  const y = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  if (iso === today) return "Today";
  if (iso === y) return "Yesterday";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** Load, add, edit and delete one project's logs. Shared by both screens. */
export function useDailyLogs(projectId: string) {
  const [logs, setLogs] = useState<DailyLogDto[]>([]);
  const [loading, setLoading] = useState(false);
  const load = async () => {
    if (!projectId) { setLogs([]); return; }
    setLoading(true);
    try { setLogs((await api.getDailyLog(projectId)) ?? []); }
    catch (e: any) { toast.error(`Could not load daily logs: ${e?.message || "unknown error"}`); setLogs([]); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [projectId]);
  const upsert = (row: DailyLogDto) => setLogs((xs) => {
    const next = xs.some((x) => x.id === row.id) ? xs.map((x) => (x.id === row.id ? row : x)) : [row, ...xs];
    return next.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  });
  const remove = async (log: DailyLogDto) => {
    if (!window.confirm("Delete this daily log entry? It can't be recovered.")) return false;
    try { await api.deleteDailyLog(projectId, log.id); setLogs((xs) => xs.filter((x) => x.id !== log.id)); toast.success("Entry deleted"); return true; }
    catch (e: any) { toast.error(`Could not delete: ${e?.message || "unknown error"}`); return false; }
  };
  return { logs, loading, load, upsert, remove };
}

