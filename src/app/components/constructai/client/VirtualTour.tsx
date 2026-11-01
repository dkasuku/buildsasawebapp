// 360° virtual tours: a building, compound or house as a set of scenes (one
// 360° photo each) joined by hotspots, so a client abroad can stand in every
// room and walk from one to the next. The contractor builds the tour in the
// project's Client tab; the client sees it in their site's "360° tour" tab.
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Viewer } from "@photo-sphere-viewer/core";
import { MarkersPlugin } from "@photo-sphere-viewer/markers-plugin";
import "@photo-sphere-viewer/core/index.css";
import "@photo-sphere-viewer/markers-plugin/index.css";
import { ArrowLeft, Compass, Crosshair, Eye, EyeOff, Loader2, MapPin, Plus, Send, Trash2, Upload, X } from "lucide-react";
import api from "../../../services/api";
import { MAX_DOCUMENT_MB } from "../../../services/uploadPolicy";
import { clientApi, STAGES, stageLabel, when, type TourScene, type VirtualTour } from "./clientData";

const input = "w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-3 text-[12.5px] text-white placeholder:text-[#5B6675] focus:outline-none focus:border-[#FF6B1A]/60";
const card = "rounded-xl border border-[#222A35] bg-[#11161D]";
const ghost = "h-8 px-3 rounded-md border border-[#222A35] bg-[#0A0E14] text-[12px] text-[#C2CAD6] hover:text-white hover:border-[#2C3744] inline-flex items-center gap-1.5 disabled:opacity-60";
const primary = "h-9 px-4 rounded-md bg-[#FF6B1A] text-white text-[12.5px] inline-flex items-center gap-1.5 disabled:opacity-60";
const uid = () => Math.random().toString(36).slice(2, 10);

const hotspotHtml = (label: string) =>
  `<div style="display:flex;flex-direction:column;align-items:center;gap:4px;cursor:pointer;transform:translateY(-50%)">
    <div style="width:38px;height:38px;border-radius:50%;background:rgba(255,107,26,.92);border:3px solid #fff;box-shadow:0 2px 10px rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
    </div>
    <div style="padding:2px 8px;border-radius:999px;background:rgba(0,0,0,.7);color:#fff;font:600 11px system-ui;white-space:nowrap">${label.replace(/[<>&"]/g, "")}</div>
  </div>`;

/** The panorama itself. Hotspots walk to another scene; in placing mode the
 *  next click on the photo reports where it landed instead. */
export function TourViewer({ scenes, sceneId, onScene, placing, onPlace, viewerRef, height = 460 }: {
  scenes: TourScene[]; sceneId: string; onScene: (id: string) => void;
  placing?: boolean; onPlace?: (yaw: number, pitch: number) => void;
  viewerRef?: React.MutableRefObject<Viewer | null>; height?: number;
}) {
  const el = useRef<HTMLDivElement>(null);
  const v = useRef<Viewer | null>(null);
  const loaded = useRef<string>("");
  // Event handlers are bound once; these keep them reading the latest props.
  const latest = useRef({ onScene, placing, onPlace });
  latest.current = { onScene, placing, onPlace };
  const scene = scenes.find((s) => s.id === sceneId) || scenes[0];

  useEffect(() => {
    if (!el.current || !scene) return;
    const viewer = new Viewer({
      container: el.current, panorama: scene.url, defaultYaw: scene.yaw || 0, defaultZoomLvl: 30,
      navbar: ["zoom", "move", "fullscreen"], touchmoveTwoFingers: false, mousewheelCtrlKey: false,
      loadingTxt: "Loading 360° photo…", plugins: [[MarkersPlugin, {}]],
    });
    loaded.current = scene.url;
    v.current = viewer;
    if (viewerRef) viewerRef.current = viewer;
    viewer.getPlugin<MarkersPlugin>(MarkersPlugin).addEventListener("select-marker", ({ marker }) => {
      const target = marker.data?.target;
      if (target && !latest.current.placing) latest.current.onScene(target);
    });
    viewer.addEventListener("click", ({ data }) => {
      if (latest.current.placing && !data.rightclick) latest.current.onPlace?.(data.yaw, data.pitch);
    });
    return () => { viewer.destroy(); v.current = null; if (viewerRef) viewerRef.current = null; loaded.current = ""; };
    // The viewer is created once; scene changes go through setPanorama below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!scene]);

  // Switch scene with a short fade, then draw its hotspots.
  useEffect(() => {
    const viewer = v.current;
    if (!viewer || !scene) return;
    const markers = viewer.getPlugin<MarkersPlugin>(MarkersPlugin);
    const draw = () => markers.setMarkers(scene.hotspots.map((h) => {
      const label = h.label || scenes.find((s) => s.id === h.target)?.name || "Go";
      return { id: h.id, position: { yaw: h.yaw, pitch: h.pitch }, html: hotspotHtml(label), size: { width: 120, height: 70 }, anchor: "center center", data: { target: h.target } };
    }));
    if (loaded.current === scene.url) { draw(); return; }
    markers.clearMarkers();
    loaded.current = scene.url;
    viewer.setPanorama(scene.url, { position: { yaw: scene.yaw || 0, pitch: 0 }, transition: { speed: 900, rotation: false }, showLoader: true })
      .then(draw).catch(() => toast.error(`Couldn't load the 360° photo for ${scene.name}.`));
  }, [scene, scenes]);

  useEffect(() => { if (el.current) el.current.style.cursor = placing ? "crosshair" : ""; }, [placing]);

  if (!scene) return null;
  return <div ref={el} className="w-full rounded-xl overflow-hidden bg-black border border-[#222A35]" style={{ height }} />;
}

function SceneStrip({ scenes, sceneId, onScene }: { scenes: TourScene[]; sceneId: string; onScene: (id: string) => void }) {
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
      {scenes.map((s, i) => (
        <button key={s.id} onClick={() => onScene(s.id)} className={`shrink-0 w-28 rounded-lg overflow-hidden border text-left ${s.id === sceneId ? "border-[#FF6B1A]" : "border-[#222A35]"}`}>
          <div className="h-14 bg-cover bg-center" style={{ backgroundImage: `url("${s.url}")` }} />
          <div className="px-1.5 py-1 text-[11px] text-[#C2CAD6] truncate bg-[#0A0E14]">{i === 0 ? "★ " : ""}{s.name}</div>
        </button>
      ))}
    </div>
  );
}

/** Read the photo's size before uploading: a 360° photo is twice as wide as tall. */
async function isEquirect(file: File) {
  try { const b = await createImageBitmap(file); const r = b.width / b.height; b.close?.(); return r > 1.9 && r < 2.1; } catch { return true; }
}

// ───────────────────────── Contractor side ─────────────────────────

/** The tours on a project: create, build (upload scenes, place hotspots), share. */
export function TourBuilder({ projectId, canShare, hasClient }: { projectId: string; canShare: boolean; hasClient: boolean }) {
  const [tours, setTours] = useState<VirtualTour[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [f, setF] = useState({ title: "", stage: "handover" });
  const [busy, setBusy] = useState(false);
  useEffect(() => { clientApi.projectTours(projectId).then(setTours).catch(() => setTours([])); }, [projectId]);
  const put = (t: VirtualTour) => setTours((x) => (x || []).map((y) => (y.id === t.id ? t : y)));

  const create = async () => {
    if (!f.title.trim()) return toast.error("Give the tour a name.");
    setBusy(true);
    try { const t = await clientApi.createTour(projectId, { title: f.title.trim(), stage: f.stage }); setTours((x) => [t, ...(x || [])]); setF({ ...f, title: "" }); setOpen(t.id); }
    catch (e: any) { toast.error(e?.message || "Couldn't create the tour."); }
    finally { setBusy(false); }
  };
  const share = async (t: VirtualTour, on: boolean) => {
    try { put(await clientApi.shareTour(projectId, t.id, on)); toast.success(on ? "Tour shared. Your client has been emailed." : "Tour hidden from the client."); }
    catch (e: any) { toast.error(e?.message || "Couldn't change sharing."); }
  };
  const del = async (t: VirtualTour) => {
    if (!window.confirm(`Delete the tour "${t.title}"?${t.sharedAt ? " Your client will no longer see it." : ""}`)) return;
    try { await clientApi.deleteTour(projectId, t.id); setTours((x) => (x || []).filter((y) => y.id !== t.id)); setOpen(null); }
    catch (e: any) { toast.error(e?.message || "Couldn't delete."); }
  };

  const current = tours?.find((t) => t.id === open);
  if (current) return <TourEditor projectId={projectId} tour={current} onChange={put} onBack={() => setOpen(null)} onShare={canShare ? (on) => share(current, on) : undefined} onDelete={() => del(current)} hasClient={hasClient} />;

  return (
    <div className="space-y-3">
      <section className={`${card} p-4 space-y-3`}>
        <div className="text-[13px] text-white flex items-center gap-2"><Compass className="w-4 h-4 text-[#FF6B1A]" /> New 360° virtual tour</div>
        <p className="text-[12px] text-[#8A95A5]">Walk your client through a house, a building or the whole compound. Take a 360° photo in each room or area, upload them, then link them with arrows so the client can move from the gate to the living room to the bedrooms.</p>
        <div className="grid sm:grid-cols-[1fr_200px_auto] gap-2">
          <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} onKeyDown={(e) => e.key === "Enter" && create()} placeholder="e.g. Finished house walk-through" className={input} />
          <select value={f.stage} onChange={(e) => setF({ ...f, stage: e.target.value })} className={input}>{STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select>
          <button onClick={create} disabled={busy} className={primary}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Create tour</button>
        </div>
      </section>
      {tours === null ? <div className="text-[12px] text-[#5B6675]"><Loader2 className="w-3.5 h-3.5 animate-spin inline mr-1" />Loading…</div>
        : tours.length === 0 ? <div className="rounded-xl border border-dashed border-[#2C3744] bg-[#11161D] p-8 text-center text-[12.5px] text-[#8A95A5]">No tours yet. A 360° tour lets a client abroad stand inside the house and look around every room.</div>
        : <TourCards tours={tours} onOpen={(t) => setOpen(t.id)} showStatus />}
    </div>
  );
}

function TourCards({ tours, onOpen, showStatus }: { tours: VirtualTour[]; onOpen: (t: VirtualTour) => void; showStatus?: boolean }) {
  return (
    <div className="grid sm:grid-cols-2 gap-3">
      {tours.map((t) => (
        <button key={t.id} onClick={() => onOpen(t)} className={`${card} overflow-hidden text-left hover:border-[#2C3744]`}>
          <div className="h-36 bg-[#0A0E14] bg-cover bg-center relative" style={t.scenes[0] ? { backgroundImage: `url("${t.scenes[0].url}")` } : undefined}>
            {!t.scenes[0] && <Compass className="absolute inset-0 m-auto w-8 h-8 text-[#2C3744]" />}
            <span className="absolute bottom-2 left-2 text-[11px] px-2 py-0.5 rounded-full bg-black/70 text-white inline-flex items-center gap-1"><Compass className="w-3 h-3" /> 360° · {t.scenes.length} scene{t.scenes.length === 1 ? "" : "s"}</span>
            {showStatus && <span className={`absolute top-2 right-2 text-[10.5px] px-2 py-0.5 rounded-full ${t.sharedAt ? "bg-[#22C55E] text-white" : "bg-black/70 text-[#F59E0B]"}`}>{t.sharedAt ? "Shared" : "Draft"}</span>}
          </div>
          <div className="p-3">
            <div className="text-[13.5px] text-white font-medium truncate">{t.title}</div>
            <div className="text-[11px] text-[#5B6675] mt-0.5">{stageLabel(t.stage)}{t.createdBy ? ` · ${t.createdBy}` : ""}{t.sharedAt ? ` · ${when(t.sharedAt)}` : ""}</div>
          </div>
        </button>
      ))}
    </div>
  );
}

function TourEditor({ projectId, tour, onChange, onBack, onShare, onDelete, hasClient }: {
  projectId: string; tour: VirtualTour; onChange: (t: VirtualTour) => void; onBack: () => void;
  onShare?: (on: boolean) => void; onDelete: () => void; hasClient: boolean;
}) {
  const [sceneId, setSceneId] = useState(tour.scenes[0]?.id || "");
  const [uploading, setUploading] = useState(0);
  const [placing, setPlacing] = useState<string | null>(null); // target scene id while placing a hotspot
  const fileRef = useRef<HTMLInputElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const scene = tour.scenes.find((s) => s.id === sceneId) || tour.scenes[0];

  const save = async (scenes: TourScene[]) => {
    const prev = tour;
    onChange({ ...tour, scenes });
    try { onChange(await clientApi.saveTour(projectId, tour.id, { scenes })); }
    catch (e: any) { onChange(prev); toast.error(e?.message || "Couldn't save the tour."); }
  };
  const patchScene = (id: string, p: Partial<TourScene>) => save(tour.scenes.map((s) => (s.id === id ? { ...s, ...p } : s)));

  const upload = async (files: FileList | null) => {
    const list = Array.from(files || []);
    if (!list.length) return;
    const ok: File[] = [];
    for (const file of list) {
      if (await isEquirect(file)) ok.push(file);
      else toast.error(`${file.name} isn't a 360° photo. It must be twice as wide as it is tall (an "equirectangular" export from a 360 camera or a Photo Sphere).`);
    }
    if (!ok.length) { if (fileRef.current) fileRef.current.value = ""; return; }
    setUploading(0.01);
    try {
      const { urls, failed } = await api.uploadFiles(ok, (p) => setUploading(Math.max(0.01, p)), { panorama: true });
      failed.forEach((x) => toast.error(`${x.name}: ${x.error}`));
      const names = ok.filter((x) => !failed.some((y) => y.name === x.name)).map((x) => x.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").slice(0, 80));
      const added = urls.map((url, i) => ({ id: uid(), name: names[i] || `Scene ${tour.scenes.length + i + 1}`, url, yaw: 0, hotspots: [] }));
      if (added.length) { await save([...tour.scenes, ...added]); if (!scene) setSceneId(added[0].id); }
    } catch (e: any) { toast.error(e?.message || "Upload failed. Check your connection and try again."); }
    finally { setUploading(0); if (fileRef.current) fileRef.current.value = ""; }
  };

  const place = (yaw: number, pitch: number) => {
    if (!scene || !placing) return;
    patchScene(scene.id, { hotspots: [...scene.hotspots, { id: uid(), yaw, pitch, target: placing }] });
    setPlacing(null);
    toast.success("Arrow added. Click it to test the walk.");
  };
  const removeScene = (s: TourScene) => {
    if (!window.confirm(`Remove "${s.name}" from the tour? Arrows pointing to it go too.`)) return;
    const rest = tour.scenes.filter((x) => x.id !== s.id).map((x) => ({ ...x, hotspots: x.hotspots.filter((h) => h.target !== s.id) }));
    setSceneId(rest[0]?.id || "");
    save(rest);
  };
  const makeStart = (s: TourScene) => save([s, ...tour.scenes.filter((x) => x.id !== s.id)]);
  const setStartView = () => {
    const v = viewerRef.current;
    if (v && scene) { patchScene(scene.id, { yaw: v.getPosition().yaw }); toast.success(`${scene.name} now opens facing this way.`); }
  };
  const others = tour.scenes.filter((s) => s.id !== scene?.id);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={onBack} className={ghost}><ArrowLeft className="w-4 h-4" /> All tours</button>
        <div className="text-[14px] text-white font-medium truncate">{tour.title}</div>
        <span className={`text-[10.5px] px-2 py-0.5 rounded-full ${tour.sharedAt ? "bg-[#22C55E]/10 text-[#22C55E]" : "bg-[#F59E0B]/10 text-[#F59E0B]"}`}>{tour.sharedAt ? "Shared with client" : "Draft · only your team sees it"}</span>
        <div className="ml-auto flex gap-2">
          {onShare && (tour.sharedAt
            ? <button onClick={() => onShare(false)} className={ghost}><EyeOff className="w-4 h-4" /> Hide from client</button>
            : <button onClick={() => onShare(true)} disabled={!tour.scenes.length || !hasClient} title={!hasClient ? "Invite the client first (Client access, above)" : !tour.scenes.length ? "Add a 360° photo first" : ""} className={primary}><Send className="w-4 h-4" /> Share with client</button>)}
          <button onClick={onDelete} className={`${ghost} hover:text-[#EF4444]`} title="Delete tour"><Trash2 className="w-4 h-4" /></button>
        </div>
      </div>

      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={(e) => upload(e.target.files)} />
      {!scene ? (
        <div className="rounded-xl border border-dashed border-[#2C3744] bg-[#11161D] p-8 text-center">
          <Compass className="w-8 h-8 text-[#FF6B1A] mx-auto" />
          <div className="text-[13.5px] text-white mt-2">Upload your 360° photos</div>
          <p className="text-[12px] text-[#8A95A5] mt-1 max-w-lg mx-auto">One photo per room or area: gate, compound, living room, kitchen, each bedroom. Use a 360 camera (Insta360, Ricoh Theta…) or a phone's Photo Sphere mode, and export the flat 2:1 JPG. Up to {MAX_DOCUMENT_MB} MB each.</p>
          <button onClick={() => fileRef.current?.click()} disabled={!!uploading} className={`${primary} mt-4`}>{uploading ? <><Loader2 className="w-4 h-4 animate-spin" /> Uploading {Math.round(uploading * 100)}%</> : <><Upload className="w-4 h-4" /> Choose 360° photos</>}</button>
        </div>
      ) : (<>
        <div className="relative">
          <TourViewer scenes={tour.scenes} sceneId={scene.id} onScene={setSceneId} placing={!!placing} onPlace={place} viewerRef={viewerRef} />
          {placing && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 rounded-full bg-[#FF6B1A] text-white text-[12px] px-3 py-1.5 shadow-lg inline-flex items-center gap-2">
              <Crosshair className="w-4 h-4" /> Click the spot (a doorway, a path) that leads to {tour.scenes.find((s) => s.id === placing)?.name}
              <button onClick={() => setPlacing(null)} className="ml-1" aria-label="Cancel"><X className="w-4 h-4" /></button>
            </div>
          )}
        </div>
        <SceneStrip scenes={tour.scenes} sceneId={scene.id} onScene={setSceneId} />
        <button onClick={() => fileRef.current?.click()} disabled={!!uploading} className={ghost}>{uploading ? <><Loader2 className="w-4 h-4 animate-spin" /> Uploading {Math.round(uploading * 100)}%</> : <><Upload className="w-4 h-4" /> Add more 360° photos</>}</button>

        <section className={`${card} p-4 space-y-3`}>
          <div className="grid sm:grid-cols-[1fr_auto] gap-2 items-end">
            <label className="block"><span className="text-[11px] text-[#8A95A5]">Scene name</span>
              <input key={scene.id} defaultValue={scene.name} onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== scene.name && patchScene(scene.id, { name: e.target.value.trim() })} placeholder="e.g. Living room" className={input} />
            </label>
            <div className="flex flex-wrap gap-2">
              <button onClick={setStartView} className={ghost} title="Turn the photo to the view the client should see first, then click"><Eye className="w-4 h-4" /> Open facing this way</button>
              {tour.scenes[0]?.id !== scene.id && <button onClick={() => makeStart(scene)} className={ghost}>★ Start tour here</button>}
              <button onClick={() => removeScene(scene)} className={`${ghost} hover:text-[#EF4444]`}><Trash2 className="w-4 h-4" /> Remove scene</button>
            </div>
          </div>
          <div>
            <div className="text-[12.5px] text-white">Arrows to other scenes</div>
            <p className="text-[11.5px] text-[#8A95A5]">Pick where an arrow leads, then click the doorway or path in the photo above. Clicking an arrow walks the client there.</p>
            {others.length === 0 ? <p className="text-[11.5px] text-[#5B6675] mt-2">Add a second 360° photo to link scenes together.</p> : (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {others.map((s) => (
                  <button key={s.id} onClick={() => setPlacing(placing === s.id ? null : s.id)} className={`h-8 px-3 rounded-full text-[12px] border inline-flex items-center gap-1.5 ${placing === s.id ? "bg-[#FF6B1A] border-[#FF6B1A] text-white" : "border-[#222A35] text-[#C2CAD6] hover:text-white"}`}><Plus className="w-3.5 h-3.5" /> {s.name}</button>
                ))}
              </div>
            )}
            {scene.hotspots.length > 0 && (
              <div className="mt-3 space-y-1.5">
                {scene.hotspots.map((h) => (
                  <div key={h.id} className="flex items-center gap-2 text-[12px] rounded-lg border border-[#222A35] px-3 py-1.5">
                    <MapPin className="w-3.5 h-3.5 text-[#FF6B1A]" />
                    <span className="text-[#C2CAD6]">Goes to <b className="text-white">{tour.scenes.find((s) => s.id === h.target)?.name}</b></span>
                    <button onClick={() => patchScene(scene.id, { hotspots: scene.hotspots.filter((x) => x.id !== h.id) })} className="ml-auto text-[#5B6675] hover:text-[#EF4444]" aria-label="Remove arrow"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </>)}
    </div>
  );
}

// ───────────────────────── Client side ─────────────────────────

/** The shared tours on a site; opening one fills the page with the viewer. */
export function TourGallery({ tours, renderComments }: { tours: VirtualTour[]; renderComments?: (t: VirtualTour) => React.ReactNode }) {
  const [open, setOpen] = useState<VirtualTour | null>(null);
  const [sceneId, setSceneId] = useState("");
  if (open) {
    const scene = open.scenes.find((s) => s.id === sceneId) || open.scenes[0];
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <button onClick={() => setOpen(null)} className={ghost}><ArrowLeft className="w-4 h-4" /> All tours</button>
          <div className="min-w-0"><div className="text-[14px] text-white font-medium truncate">{open.title}</div><div className="text-[11px] text-[#8A95A5]">{scene?.name} · drag to look around, tap the arrows to move</div></div>
        </div>
        {scene && <TourViewer scenes={open.scenes} sceneId={scene.id} onScene={setSceneId} height={Math.min(560, Math.round(window.innerHeight * 0.62))} />}
        {open.scenes.length > 1 && scene && <SceneStrip scenes={open.scenes} sceneId={scene.id} onScene={setSceneId} />}
        {open.description && <p className="text-[12.5px] text-[#C2CAD6] whitespace-pre-wrap">{open.description}</p>}
        {renderComments && <div className={`${card} p-4`}><div className="text-[12.5px] text-white">Ask about this tour</div>{renderComments(open)}</div>}
      </div>
    );
  }
  if (!tours.length) return <div className="rounded-xl border border-dashed border-[#2C3744] bg-[#11161D] p-8 text-center text-[12.5px] text-[#8A95A5]">No 360° tours shared yet. When your contractor shares one, you can stand inside your house and look around every room from wherever you are.</div>;
  return <TourCards tours={tours} onOpen={(t) => { setSceneId(t.scenes[0]?.id || ""); setOpen(t); }} />;
}
