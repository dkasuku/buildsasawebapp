// ============================================================================
// AI Design Studio — opened from Plans & Drawings. Describe what you want (and
// optionally add photos of the site, the room or a sketch), pick what to make —
// a 2D floor plan, a 3D render, an architectural concept or an interior design —
// and the AI returns a concept image with written recommendations. Designs can
// be downloaded, shared, used as the reference for the next version, or saved
// into a project, where they appear in its drawings as an "AI Concept" sheet.
// ============================================================================

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ArrowLeft, X, Sparkles, LayoutGrid, Box, Building2, Sofa, Camera, ImagePlus, Loader2, Download, Share2, FolderPlus,
  Trash2, RefreshCw, Info, Check, MessageCircle, Copy, Wand2,
} from "lucide-react";
import api, { absoluteFileUrl, type AiDesignDto, type DesignMode } from "../../services/api";
import { useFileUpload, pickFiles } from "./useFileUpload";
import { useProjects } from "./useProjects";

const MODES: { key: DesignMode; label: string; icon: any; hint: string; examples: string[] }[] = [
  { key: "plan2d", label: "2D floor plan", icon: LayoutGrid, hint: "A labelled top-down layout with room sizes",
    examples: ["3-bedroom bungalow, 120 m², open-plan kitchen and living, master en-suite, covered parking", "Petrol station forecourt with 4 pump islands, convenience shop, car wash bay and staff office", "Ground-floor plan for a 6-unit apartment block, 2 bedrooms each, central staircase"] },
  { key: "render3d", label: "3D render", icon: Box, hint: "A realistic visual of the finished building",
    examples: ["Modern 4-storey apartment block in Kilimani, grey and white finish, balconies, landscaped entrance", "Small community stadium with 3,000-seat covered grandstand, floodlights and running track", "Two-storey maisonette with stone cladding, clay roof tiles and a garden in Karen"] },
  { key: "architectural", label: "Architectural concept", icon: Building2, hint: "Form, facade and materials study",
    examples: ["Front elevation of a 3-storey commercial building with shops on the ground floor and offices above", "Facade concept for a church that seats 500, with natural ventilation and clerestory windows", "Massing study for a mixed-use block on a corner plot in Westlands"] },
  { key: "interior", label: "Interior design", icon: Sofa, hint: "Styled rooms, finishes and furniture",
    examples: ["Modern kitchen with white cabinets, quartz worktop, island with bar stools, warm lighting", "Hotel reception lobby, African contemporary style, natural wood and stone, double volume", "Restaurant interior for 60 diners, industrial style, exposed brick, pendant lights"] },
];
const STYLES = ["Modern", "Contemporary African", "Minimalist", "Industrial", "Classic", "Tropical", "Scandinavian", "Luxury"];

export function DesignStudio({ onClose }: { onClose: () => void }) {
  const { projects } = useProjects();
  const [mode, setMode] = useState<DesignMode>("render3d");
  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState("");
  const [aspect, setAspect] = useState<"square" | "landscape" | "portrait">("landscape");
  const [refs, setRefs] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [history, setHistory] = useState<AiDesignDto[]>([]);
  const [current, setCurrent] = useState<AiDesignDto | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState<AiDesignDto | null>(null);
  const [sharing, setSharing] = useState<AiDesignDto | null>(null);
  const uploader = useFileUpload();
  const timer = useRef<number | null>(null);

  useEffect(() => {
    api.getDesigns().then((r) => { setHistory(r.designs); setRemaining(r.remainingToday); setEnabled(r.enabled); if (r.designs[0]) setCurrent(r.designs[0]); }).catch(() => {});
    const esc = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, []);
  useEffect(() => { if (mode === "plan2d") setAspect("square"); }, [mode]);

  const addRefs = async (camera: boolean) => {
    const files = await pickFiles({ multiple: !camera, accept: "image/*", ...(camera ? { capture: "environment" } : {}) });
    if (!files.length) return;
    const room = 4 - refs.length;
    if (files.length > room) toast.info(`You can use up to 4 reference photos. Added the first ${room}.`);
    const urls = await uploader.upload(files.slice(0, room));
    setRefs((r) => [...r, ...urls].slice(0, 4));
  };

  const generate = async () => {
    if (prompt.trim().length < 8) return toast.error("Describe what you want in a sentence or two.");
    if (uploader.busy) return toast.error("Wait for the photos to finish uploading.");
    setBusy(true); setElapsed(0); setError(null);
    timer.current = window.setInterval(() => setElapsed((s) => s + 1), 1000);
    try {
      const d = await api.generateDesign({ mode, prompt, images: refs, style: style || undefined, aspect });
      setHistory((h) => [d, ...h]);
      setCurrent(d);
      if (d.remainingToday != null) setRemaining(d.remainingToday);
      toast.success("Design ready");
    } catch (e: any) { setError(e.message || "The design couldn't be generated. Please try again."); }
    finally { setBusy(false); if (timer.current) window.clearInterval(timer.current); }
  };

  const iterate = (d: AiDesignDto) => {
    setRefs([d.imageUrl]);
    setMode(d.mode);
    setPrompt("");
    toast("Using this design as the reference. Describe what to change.");
  };
  const remove = async (d: AiDesignDto) => {
    if (!window.confirm("Delete this design from your history? Copies already saved to a project stay there.")) return;
    try { await api.deleteDesign(d.id); setHistory((h) => h.filter((x) => x.id !== d.id)); if (current?.id === d.id) setCurrent(null); }
    catch (e: any) { toast.error(e.message || "Couldn't delete"); }
  };
  const download = (d: AiDesignDto) => {
    const a = document.createElement("a");
    a.href = absoluteFileUrl(d.imageUrl); a.download = `buildsasa-${d.mode}-${d.id.slice(-5)}.png`; a.target = "_blank"; a.rel = "noopener";
    document.body.appendChild(a); a.click(); a.remove();
  };

  const m = MODES.find((x) => x.key === mode)!;
  const pill = (active: boolean) => `h-8 px-3 rounded-full text-[11.5px] border transition ${active ? "bg-[#FF6B1A] border-[#FF6B1A] text-white" : "border-[#222A35] text-[#C2CAD6] hover:text-white hover:border-[#FF6B1A]/50"}`;

  return (
    <div className="fixed inset-0 z-[58] bg-[#0A0E14] flex flex-col text-[#E6EAF0]">
      {/* Header */}
      <div className="shrink-0 px-3 sm:px-5 py-3 border-b border-[#222A35] bg-[#11161D] flex items-center gap-3">
        <button onClick={onClose} className="h-9 px-2.5 rounded-md border border-[#222A35] text-[#C2CAD6] hover:text-white flex items-center gap-1.5 text-[12px]"><ArrowLeft className="w-4 h-4" /><span className="hidden sm:inline">Back</span></button>
        <div className="min-w-0 flex-1">
          <div className="text-[15px] text-white font-display flex items-center gap-2"><Sparkles className="w-4 h-4 text-[#FF6B1A]" /> AI Design Studio</div>
          <div className="text-[11px] text-[#8A95A5] truncate">Floor plans, 3D renders, architectural and interior concepts from a description or a photo</div>
        </div>
        {remaining != null && <div className="hidden sm:block text-[11px] text-[#8A95A5]">{remaining} designs left today</div>}
        <button onClick={onClose} className="w-9 h-9 rounded-md border border-[#222A35] text-[#8A95A5] hover:text-white flex items-center justify-center"><X className="w-4 h-4" /></button>
      </div>

      <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-y-auto lg:overflow-hidden">
        {/* Controls */}
        <div className="lg:w-[400px] shrink-0 border-b lg:border-b-0 lg:border-r border-[#222A35] lg:overflow-y-auto p-4 sm:p-5 space-y-5">
          {!enabled && <div className="rounded-lg border border-[#F59E0B]/40 bg-[#F59E0B]/10 p-3 text-[12px] text-[#FBBF24]">AI design isn't switched on for this server yet. Contact Buildsasa support.</div>}
          <div>
            <div className="text-[11px] uppercase tracking-wider text-[#5B6675] mb-2">1. What do you want to create?</div>
            <div className="grid grid-cols-2 gap-2">
              {MODES.map((x) => (
                <button key={x.key} onClick={() => setMode(x.key)} className={`rounded-lg border p-3 text-left transition ${mode === x.key ? "border-[#FF6B1A] bg-[#FF6B1A]/10" : "border-[#222A35] bg-[#11161D] hover:border-[#FF6B1A]/40"}`}>
                  <x.icon className={`w-5 h-5 ${mode === x.key ? "text-[#FF6B1A]" : "text-[#8A95A5]"}`} />
                  <div className="text-[12.5px] text-white mt-1.5">{x.label}</div>
                  <div className="text-[10.5px] text-[#8A95A5] leading-snug mt-0.5">{x.hint}</div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="text-[11px] uppercase tracking-wider text-[#5B6675] mb-2">2. Describe it</div>
            <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={5} placeholder={`e.g. ${m.examples[0]}`} className="w-full bg-[#11161D] border border-[#222A35] rounded-lg px-3 py-2.5 text-[13px] text-white placeholder:text-[#5B6675] focus:outline-none focus:border-[#FF6B1A] resize-y" />
            <div className="flex flex-wrap gap-1.5 mt-2">
              {m.examples.map((ex) => (
                <button key={ex} onClick={() => setPrompt(ex)} className="text-[10.5px] text-left px-2 py-1 rounded-md bg-[#11161D] border border-[#222A35] text-[#8A95A5] hover:text-white max-w-full truncate">{ex.length > 48 ? ex.slice(0, 48) + "…" : ex}</button>
              ))}
            </div>
          </div>

          <div>
            <div className="text-[11px] uppercase tracking-wider text-[#5B6675] mb-2">3. Reference photos <span className="normal-case tracking-normal">(optional, up to 4)</span></div>
            <div className="text-[11px] text-[#8A95A5] mb-2">A photo of the site, the room to redesign, or a hand sketch. The AI works from it.</div>
            <div className="flex gap-2 flex-wrap">
              {refs.map((u) => (
                <div key={u} className="relative">
                  <img src={absoluteFileUrl(u)} alt="" className="w-[72px] h-[72px] rounded-lg object-cover border border-[#222A35]" />
                  <button onClick={() => setRefs((r) => r.filter((x) => x !== u))} className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-[#11161D] border border-[#222A35] text-[#8A95A5] hover:text-red-400 flex items-center justify-center" aria-label="Remove"><X className="w-3 h-3" /></button>
                </div>
              ))}
              {refs.length < 4 && <>
                <button onClick={() => addRefs(false)} className="w-[72px] h-[72px] rounded-lg border-2 border-dashed border-[#222A35] text-[#8A95A5] hover:text-white hover:border-[#FF6B1A] flex flex-col items-center justify-center gap-1"><ImagePlus className="w-4 h-4" /><span className="text-[10px]">Upload</span></button>
                <button onClick={() => addRefs(true)} className="w-[72px] h-[72px] rounded-lg border-2 border-dashed border-[#222A35] text-[#8A95A5] hover:text-white hover:border-[#FF6B1A] flex flex-col items-center justify-center gap-1"><Camera className="w-4 h-4" /><span className="text-[10px]">Take photo</span></button>
              </>}
            </div>
            {uploader.busy && <div className="text-[11px] text-[#8A95A5] mt-2 flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" /> Uploading…</div>}
          </div>

          <div>
            <div className="text-[11px] uppercase tracking-wider text-[#5B6675] mb-2">4. Style and shape <span className="normal-case tracking-normal">(optional)</span></div>
            <div className="flex flex-wrap gap-1.5">
              {STYLES.map((s) => <button key={s} onClick={() => setStyle(style === s ? "" : s)} className={pill(style === s)}>{s}</button>)}
            </div>
            <div className="flex gap-1.5 mt-2">
              {([["landscape", "Wide"], ["square", "Square"], ["portrait", "Tall"]] as const).map(([k, l]) => <button key={k} onClick={() => setAspect(k)} className={pill(aspect === k)}>{l}</button>)}
            </div>
          </div>

          <button onClick={generate} disabled={busy || !enabled} className="w-full h-12 rounded-lg bg-[#FF6B1A] hover:bg-[#FF7E33] disabled:opacity-60 text-white text-[14px] font-medium flex items-center justify-center gap-2">
            {busy ? <><Loader2 className="w-4 h-4 animate-spin" /> Designing… {elapsed}s</> : <><Wand2 className="w-4 h-4" /> Generate design</>}
          </button>
          <div className="text-[10.5px] text-[#5B6675] flex gap-1.5"><Info className="w-3 h-3 shrink-0 mt-0.5" />AI designs are concepts for ideas and client discussion. They aren't construction drawings: dimensions and structure must be checked and drawn by a qualified architect or engineer before building.</div>
        </div>

        {/* Result */}
        <div className="flex-1 min-w-0 lg:overflow-y-auto p-4 sm:p-5 space-y-4">
          {busy && (
            <div className="rounded-xl border border-[#222A35] bg-[#11161D] aspect-[3/2] max-h-[70vh] flex flex-col items-center justify-center gap-3 text-center p-6">
              <div className="w-12 h-12 rounded-full bg-[#FF6B1A]/15 flex items-center justify-center"><Sparkles className="w-6 h-6 text-[#FF6B1A] animate-pulse" /></div>
              <div className="text-[14px] text-white">Designing: {m.label}…</div>
              <div className="text-[12px] text-[#8A95A5]">This usually takes 20 to 60 seconds.</div>
            </div>
          )}
          {!busy && error && (
            <div className="rounded-xl border border-[#EF4444]/40 bg-[#EF4444]/10 p-4 flex gap-3">
              <Info className="w-4 h-4 text-[#F87171] shrink-0 mt-0.5" />
              <div className="flex-1">
                <div className="text-[13px] text-white">The design wasn't created</div>
                <div className="text-[12px] text-[#FCA5A5] mt-0.5">{error}</div>
              </div>
              <button onClick={() => setError(null)} className="text-[#8A95A5] hover:text-white"><X className="w-4 h-4" /></button>
            </div>
          )}
          {!busy && !current && (
            <div className="rounded-xl border border-dashed border-[#222A35] bg-[#11161D] aspect-[3/2] max-h-[70vh] flex flex-col items-center justify-center gap-2 text-center p-6">
              <Sparkles className="w-8 h-8 text-[#FF6B1A]" />
              <div className="text-[15px] text-white font-display">Your designs appear here</div>
              <div className="text-[12px] text-[#8A95A5] max-w-sm">Pick what to create, describe it, and press Generate. Try one of the examples to start.</div>
            </div>
          )}
          {!busy && current && (
            <div className="space-y-3">
              <div className="rounded-xl border border-[#222A35] bg-[#11161D] overflow-hidden">
                <a href={absoluteFileUrl(current.imageUrl)} target="_blank" rel="noopener noreferrer"><img src={absoluteFileUrl(current.imageUrl)} alt="AI design" className="w-full max-h-[70vh] object-contain bg-white" /></a>
              </div>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => setSaving(current)} className="h-9 px-3.5 rounded-md bg-[#FF6B1A] hover:bg-[#FF7E33] text-white text-[12px] flex items-center gap-1.5"><FolderPlus className="w-4 h-4" />{current.projectId ? "Saved · save again" : "Save to project"}</button>
                <button onClick={() => setSharing(current)} className="h-9 px-3 rounded-md border border-[#222A35] text-[12px] text-white flex items-center gap-1.5"><Share2 className="w-4 h-4" />Share</button>
                <button onClick={() => download(current)} className="h-9 px-3 rounded-md border border-[#222A35] text-[12px] text-white flex items-center gap-1.5"><Download className="w-4 h-4" />Download</button>
                <button onClick={() => iterate(current)} className="h-9 px-3 rounded-md border border-[#222A35] text-[12px] text-white flex items-center gap-1.5"><RefreshCw className="w-4 h-4" />Refine this design</button>
                <button onClick={() => remove(current)} className="h-9 px-3 rounded-md border border-[#222A35] text-[12px] text-[#8A95A5] hover:text-red-400 flex items-center gap-1.5 ml-auto"><Trash2 className="w-4 h-4" /></button>
              </div>
              <div className="text-[12px] text-[#8A95A5]"><span className="text-[#C2CAD6]">{MODES.find((x) => x.key === current.mode)?.label}:</span> {current.prompt}</div>
              {current.notes && (
                <div className="rounded-xl border border-[#222A35] bg-[#11161D] p-4">
                  <div className="text-[12.5px] text-white mb-2 flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5 text-[#FF6B1A]" /> Design recommendations</div>
                  <div className="text-[12.5px] text-[#D5DBE3] whitespace-pre-wrap leading-relaxed">{current.notes.replace(/\*\*|#{1,6} ?/g, "")}</div>
                </div>
              )}
            </div>
          )}

          {history.length > 0 && (
            <div>
              <div className="text-[11px] uppercase tracking-wider text-[#5B6675] mb-2">Your designs</div>
              <div className="grid grid-cols-3 sm:grid-cols-4 xl:grid-cols-6 gap-2">
                {history.map((d) => (
                  <button key={d.id} onClick={() => setCurrent(d)} className={`relative rounded-lg overflow-hidden border ${current?.id === d.id ? "border-[#FF6B1A]" : "border-[#222A35] hover:border-[#FF6B1A]/50"}`}>
                    <img src={absoluteFileUrl(d.imageUrl)} alt="" loading="lazy" className="w-full aspect-square object-cover bg-white" />
                    {d.projectId && <span className="absolute top-1 right-1 w-5 h-5 rounded-full bg-[#22C55E] flex items-center justify-center" title="Saved to a project"><Check className="w-3 h-3 text-white" /></span>}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {saving && <SaveDialog design={saving} projects={projects} onClose={() => setSaving(null)} onSaved={(pid) => { setHistory((h) => h.map((x) => (x.id === saving.id ? { ...x, projectId: pid } : x))); setCurrent((c) => (c && c.id === saving.id ? { ...c, projectId: pid } : c)); setSaving(null); }} />}
      {sharing && <ShareDialog design={sharing} onClose={() => setSharing(null)} />}
    </div>
  );
}

function SaveDialog({ design, projects, onClose, onSaved }: { design: AiDesignDto; projects: { id: string; name: string; code: string }[]; onClose: () => void; onSaved: (projectId: string) => void }) {
  const [projectId, setProjectId] = useState(projects[0]?.id || "");
  const [title, setTitle] = useState({ plan2d: "Floor plan concept", render3d: "3D render concept", architectural: "Architectural concept", interior: "Interior design concept" }[design.mode]);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!projectId) return toast.error("Choose a project");
    setBusy(true);
    try {
      const r = await api.saveDesignToProject(design.id, { projectId, title });
      toast.success(`Saved to ${r.projectName} as ${r.drawing.number}. Find it in the project's Drawings and in Plans & Drawings.`, { duration: 7000 });
      onSaved(projectId);
    } catch (e: any) { toast.error(e.message || "Couldn't save"); }
    finally { setBusy(false); }
  };
  const input = "w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-3 text-[12px] text-white focus:outline-none focus:border-[#FF6B1A]";
  return (
    <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-[#222A35] bg-[#11161D]" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-[#222A35] flex items-center justify-between"><div className="text-[14px] text-white font-display">Save design to a project</div><button onClick={onClose} className="text-[#8A95A5] hover:text-white"><X className="w-4 h-4" /></button></div>
        <div className="p-5 space-y-3">
          <img src={absoluteFileUrl(design.imageUrl)} alt="" className="w-full max-h-48 object-contain rounded-lg bg-white" />
          {projects.length === 0 ? <div className="text-[12px] text-[#F59E0B]">Create a project first, then save designs to it.</div> : (
            <div><div className="text-[11px] text-[#8A95A5] mb-1">Project</div><select value={projectId} onChange={(e) => setProjectId(e.target.value)} className={input}>{projects.map((p) => <option key={p.id} value={p.id}>{p.code ? `${p.code} · ${p.name}` : p.name}</option>)}</select></div>
          )}
          <div><div className="text-[11px] text-[#8A95A5] mb-1">Title</div><input value={title} onChange={(e) => setTitle(e.target.value)} className={input} /></div>
          <div className="text-[11px] text-[#5B6675]">It's filed in the project's drawings as an "AI Concept" sheet, where the team can open it, mark it up and share it.</div>
        </div>
        <div className="px-5 py-4 border-t border-[#222A35] flex gap-2"><button onClick={onClose} className="flex-1 h-10 rounded-md border border-[#222A35] text-[12px] text-white">Cancel</button><button onClick={save} disabled={busy || !projectId} className="flex-1 h-10 rounded-md bg-[#FF6B1A] disabled:opacity-60 text-white text-[12px] flex items-center justify-center gap-1.5">{busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}Save</button></div>
      </div>
    </div>
  );
}

function ShareDialog({ design, onClose }: { design: AiDesignDto; onClose: () => void }) {
  const url = absoluteFileUrl(design.imageUrl);
  const text = `Design concept from Buildsasa: ${design.prompt.slice(0, 120)}${design.prompt.length > 120 ? "…" : ""} ${url}`;
  const copy = () => navigator.clipboard?.writeText(url).then(() => toast.success("Link copied")).catch(() => toast.error("Couldn't copy"));
  return (
    <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-[#222A35] bg-[#11161D]" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-[#222A35] flex items-center justify-between"><div className="text-[14px] text-white font-display">Share design</div><button onClick={onClose} className="text-[#8A95A5] hover:text-white"><X className="w-4 h-4" /></button></div>
        <div className="p-5 space-y-3">
          <p className="text-[12px] text-[#8A95A5]">Anyone with this link can view the image. Share it with your client or team.</p>
          <div className="flex gap-2"><input readOnly value={url} onFocus={(e) => e.target.select()} className="flex-1 min-w-0 h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-[11px] text-[#C2CAD6]" /><button onClick={copy} className="h-9 px-3 rounded-md border border-[#222A35] text-[11px] text-white flex items-center gap-1"><Copy className="w-3.5 h-3.5" />Copy</button></div>
          <a href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer" className="h-10 rounded-md bg-[#25D366] text-white text-[12px] flex items-center justify-center gap-1.5"><MessageCircle className="w-4 h-4" />Send on WhatsApp</a>
        </div>
      </div>
    </div>
  );
}
