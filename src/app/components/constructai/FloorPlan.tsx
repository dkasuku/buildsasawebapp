// Floor plans: an editable plan sheet (public/floor-plan.html, the Floor Plan
// Maker) with Buildsasa AI on top. Describe a building and DeepSeek draws the
// rooms, doors, windows and furniture; then drag anything to change it, or ask
// the AI to change the current plan.
import { useCallback, useEffect, useRef, useState } from "react";
import { Download, FileImage, FileText, Loader2, Maximize2, Minimize2, PenTool, RefreshCw, Ruler, Sparkles, Wand2 } from "lucide-react";
import { toast } from "sonner";
import api, { http } from "../../services/api";
import { exportDxf, exportPdf, exportPng, exportSvg, type ExportDrawing, type PlanData } from "./floorPlanExport";

type Plan = { name: string; units: "cm"; items: any[] };
const PENDING_KEY = "buildsasa-floorplan-prompt";
const EXAMPLES = [
  "3-bedroom bungalow, 120 m², open kitchen, master en-suite",
  "2-bedroom rental unit, 70 m², one bathroom",
  "4-bedroom maisonette ground floor with parking for 2 cars",
  "Shop 6 m × 10 m with a store and a toilet at the back",
];

/** Ask the AI chat to open this page with a description ready (used by the chat's floor-plan card). */
export const queueFloorPlanPrompt = (prompt: string) => { try { sessionStorage.setItem(PENDING_KEY, prompt); } catch { /* noop */ } };

export function FloorPlan() {
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [change, setChange] = useState(false);
  const [issues, setIssues] = useState<string[] | null>(null);
  // Expanded: the plan takes the whole screen; Esc or the button brings it back.
  const [full, setFull] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => send({ type: "buildsasa:fit" }), 160);
    if (!full) return () => clearTimeout(t);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setFull(false);
    window.addEventListener("keydown", esc);
    return () => { clearTimeout(t); window.removeEventListener("keydown", esc); };
  }, [full]);
  const pending = useRef<string | null>(null);

  const send = (msg: any) => frame.current?.contentWindow?.postMessage(msg, window.location.origin);

  // Export: ask the sheet for a clean drawing + the plan, then build the file.
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);
  const getExport = () => new Promise<{ exp: ExportDrawing | null; plan: PlanData } | null>((resolve) => {
    const id = Math.random().toString(36).slice(2);
    const on = (e: MessageEvent) => { if (e.origin === window.location.origin && e.data?.type === "buildsasa:export" && e.data.id === id) { window.removeEventListener("message", on); resolve({ exp: e.data.exp, plan: e.data.plan }); } };
    window.addEventListener("message", on);
    send({ type: "buildsasa:get-export", id });
    setTimeout(() => { window.removeEventListener("message", on); resolve(null); }, 2000);
  });
  const doExport = async (kind: "pdf" | "pdf4" | "png" | "dxf" | "svg") => {
    setExportOpen(false);
    const got = await getExport();
    if (!got || !got.exp || !got.plan.items.some((i) => i.kind === "room")) return toast.error("Draw a plan with at least one room first.");
    // Rule: an unchecked plan never goes out looking final. Warn, and list the open points in the drawing notes.
    if (issues && issues.length && !window.confirm(`This plan still has ${issues.length} building-rule point${issues.length === 1 ? "" : "s"} to look at. Export anyway? They will be listed in the drawing notes.`)) return;
    setExporting(kind);
    try {
      if (kind === "pdf" || kind === "pdf4") {
        const company = await api.getCompany().catch(() => null);
        // The title block names the client; optional, remembered for next time.
        let client = ""; try { client = localStorage.getItem("buildsasa-floorplan-client") || ""; } catch { /* noop */ }
        const typed = window.prompt("Client's name for the drawing's title block (optional):", client);
        if (typed === null) { setExporting(null); return; }
        client = typed.trim(); try { localStorage.setItem("buildsasa-floorplan-client", client); } catch { /* noop */ }
        await exportPdf(got.exp, got.plan, { company: company?.name, project: lastBrief || got.plan.name, client, issues: issues || [] }, kind === "pdf4" ? "a4" : "a3");
      } else if (kind === "png") await exportPng(got.exp, got.plan);
      else if (kind === "svg") exportSvg(got.exp, got.plan);
      else exportDxf(got.plan);
      toast.success(kind === "pdf" ? "A3 drawing downloaded (PDF)." : kind === "pdf4" ? "A4 drawing downloaded (PDF)." : kind === "dxf" ? "DXF downloaded: opens in AutoCAD and other CAD software." : `${kind.toUpperCase()} downloaded.`);
    } catch (e: any) { toast.error(e?.message || "Couldn't export the plan."); }
    setExporting(null);
  };
  const currentPlan = () => new Promise<Plan | null>((resolve) => {
    const id = Math.random().toString(36).slice(2);
    const on = (e: MessageEvent) => { if (e.origin === window.location.origin && e.data?.type === "buildsasa:plan" && e.data.id === id) { window.removeEventListener("message", on); resolve(e.data.plan); } };
    window.addEventListener("message", on);
    send({ type: "buildsasa:get-plan", id });
    setTimeout(() => { window.removeEventListener("message", on); resolve(null); }, 1500);
  });

  // The description the current plan was drawn from, for "Try another design".
  const [lastBrief, setLastBrief] = useState<string>(() => { try { return localStorage.getItem("buildsasa-floorplan-brief") || ""; } catch { return ""; } });
  // What's selected on the sheet, for "Redesign this room".
  const [selected, setSelected] = useState<{ kind: string; name: string; x: number; y: number; w: number; h: number } | null>(null);
  useEffect(() => {
    const on = (e: MessageEvent) => { if (e.origin === window.location.origin && e.data?.type === "buildsasa:selection") setSelected(e.data.item); };
    window.addEventListener("message", on);
    return () => window.removeEventListener("message", on);
  }, []);

  const draw = useCallback(async (text: string, edit: boolean, opts: { variation?: boolean; focus?: typeof selected } = {}) => {
    const prompt = text.trim();
    if (!prompt || busy) return;
    setBusy(true);
    try {
      const current = edit || opts.focus ? await currentPlan() : null;
      const r = await http<{ plan: Plan; area: number; issues?: string[] }>("/api/ai/floor-plan", { method: "POST", body: JSON.stringify({ prompt, current, variation: !!opts.variation, focus: opts.focus || undefined }) });
      const what = opts.focus ? `${opts.focus.name} redesigned` : opts.variation ? "New design" : edit ? "Plan changed" : "Plan drawn";
      send({ type: "buildsasa:load-plan", plan: r.plan, message: `${what}: about ${r.area} m². Undo on the sheet brings back the last version.` });
      if (!edit && !opts.focus) { setLastBrief(prompt); try { localStorage.setItem("buildsasa-floorplan-brief", prompt); } catch { /* noop */ } }
      setChange(true);
      setIssues(r.issues || []);
    } catch (e: any) { toast.error(e?.message || "Couldn't draw the plan. Try again."); }
    setBusy(false);
  }, [busy]);

  // The sheet says when it's ready; then run a description the AI chat queued.
  useEffect(() => {
    try { pending.current = sessionStorage.getItem(PENDING_KEY); sessionStorage.removeItem(PENDING_KEY); } catch { /* noop */ }
    if (pending.current) setQ(pending.current);
    const on = (e: MessageEvent) => { if (e.origin === window.location.origin && e.data?.type === "buildsasa:plan-ready") setReady(true); };
    window.addEventListener("message", on);
    return () => window.removeEventListener("message", on);
  }, []);
  useEffect(() => { if (ready && pending.current) { const p = pending.current; pending.current = null; draw(p, false); } }, [ready, draw]);

  return (
    <div className={full ? "fixed inset-0 z-[80] flex flex-col bg-[#0A0E14]" : "flex flex-col h-[calc(100dvh-170px)] min-h-[520px]"}>
      <div className="px-4 sm:px-6 py-3 border-b border-[#222A35] bg-[#11161D]">
        <form onSubmit={(e) => { e.preventDefault(); draw(q, change); }} className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1 min-w-0">
            <Sparkles className="w-4 h-4 text-[#FF8A47] absolute left-3 top-1/2 -translate-y-1/2" />
            <input aria-label="Describe the floor plan" value={q} onChange={(e) => setQ(e.target.value)}
              placeholder={change ? "Change it, e.g. make the kitchen bigger, add a store, move the master bedroom to the right" : "Describe the house, e.g. 3-bedroom bungalow, 120 m², open kitchen, master en-suite"}
              className="w-full h-11 rounded-lg bg-[#0A0E14] border border-[#222A35] pl-9 pr-3 text-[14px] text-white placeholder:text-[#5B6675] focus:outline-none focus:border-[#FF6B1A]/60" />
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setFull((f) => !f)} aria-label={full ? "Back to normal size" : "Expand the plan to full screen"} title={full ? "Back to normal size (Esc)" : "Expand to full screen"}
              className="h-11 px-3 rounded-lg border border-[#222A35] bg-[#0A0E14] text-[#C2CAD6] hover:text-white inline-flex items-center justify-center gap-1.5 text-[13px] whitespace-nowrap">
              {full ? <><Minimize2 className="w-4 h-4" /> Exit full screen</> : <><Maximize2 className="w-4 h-4" /> Expand</>}
            </button>
            <div className="relative">
              <button type="button" onClick={() => setExportOpen((o) => !o)} aria-haspopup="menu" aria-expanded={exportOpen} aria-label="Export the plan"
                className="h-11 px-3 rounded-lg border border-[#222A35] bg-[#0A0E14] text-[#C2CAD6] hover:text-white inline-flex items-center justify-center gap-1.5 text-[13px] whitespace-nowrap">
                {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Export
              </button>
              {exportOpen && (
                <>
                  <div className="fixed inset-0 z-[90]" onClick={() => setExportOpen(false)} />
                  <div role="menu" className="absolute right-0 top-12 z-[91] w-[290px] rounded-xl border border-[#222A35] bg-[#11161D] shadow-2xl p-1.5">
                    {([
                      ["pdf", FileText, "PDF drawing, A3 (to scale)", "Title block, dimensions, room and window schedules. Best detail, usually 1:100."],
                      ["pdf4", FileText, "PDF drawing, A4 (to scale)", "The same drawing for any office printer, usually 1:150 or 1:200."],
                      ["png", FileImage, "Image (PNG)", "For WhatsApp and quick sharing."],
                      ["dxf", Ruler, "CAD file (DXF)", "Opens in AutoCAD for an architect or draughtsman."],
                      ["svg", PenTool, "Vector (SVG)", "Editable in design software."],
                    ] as const).map(([k, I, t, d]) => (
                      <button key={k} role="menuitem" onClick={() => doExport(k)} className="w-full text-left rounded-lg px-2.5 py-2 hover:bg-[#161C24] flex items-start gap-2.5">
                        <I className="w-4 h-4 mt-0.5 text-[#FF8A47] shrink-0" />
                        <span className="min-w-0"><span className="block text-[13px] text-white">{t}</span><span className="block text-[11.5px] text-[#8A95A5] leading-snug">{d}</span></span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
            <button type="submit" disabled={busy || !q.trim()} className="h-11 px-4 rounded-lg bg-[#FF6B1A] hover:bg-[#FF7E33] text-[#ffffff] text-[13.5px] font-medium inline-flex items-center justify-center gap-1.5 disabled:opacity-50 flex-1 sm:flex-none whitespace-nowrap">
              {busy ? <><Loader2 className="w-4 h-4 animate-spin" /> Drawing…</> : <><Wand2 className="w-4 h-4" /> {change ? "Change plan" : "Draw plan"}</>}
            </button>
          </div>
        </form>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px]">
          <label className="inline-flex items-center gap-1.5 text-[12.5px] text-[#C2CAD6] cursor-pointer">
            <input type="checkbox" checked={change} onChange={(e) => setChange(e.target.checked)} className="accent-[#FF6B1A] w-4 h-4" /> Change the plan on the sheet
          </label>
          {!change && EXAMPLES.map((ex) => <button key={ex} type="button" onClick={() => setQ(ex)} className="h-7 px-2.5 rounded-full border border-[#222A35] text-[12px] text-[#8A95A5] hover:text-white whitespace-nowrap">{ex}</button>)}
        </div>
        {/* Redo with the AI: the whole plan, or just the selected room. Undo/Redo on the sheet step between versions. */}
        {(lastBrief || selected) && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {lastBrief && (
              <button type="button" disabled={busy} onClick={() => draw(lastBrief, false, { variation: true })} title={`Redraw "${lastBrief}" with a different arrangement`}
                className="h-9 px-3 rounded-lg border border-[#FF6B1A]/50 bg-[#FF6B1A]/10 text-[12.5px] text-white hover:bg-[#FF6B1A]/20 inline-flex items-center gap-1.5 disabled:opacity-50">
                <RefreshCw className="w-3.5 h-3.5 text-[#FF8A47]" /> Try another design
              </button>
            )}
            {selected?.kind === "room" ? (
              <button type="button" disabled={busy} onClick={() => draw(change && q.trim() ? q : `Redesign ${selected.name}`, true, { focus: selected })} title="Redo only this room: its furniture, doors and windows. Type in the box first to say how."
                className="h-9 px-3 rounded-lg border border-[#222A35] bg-[#0A0E14] text-[12.5px] text-white hover:border-[#FF6B1A]/60 inline-flex items-center gap-1.5 disabled:opacity-50">
                <Wand2 className="w-3.5 h-3.5 text-[#FF8A47]" /> Redesign {selected.name || "this room"}
              </button>
            ) : (
              <span className="text-[11.5px] text-[#8A95A5]">Tip: tap a room on the sheet to redesign just that room.</span>
            )}
            <span className="text-[11.5px] text-[#5B6675]">Undo and Redo on the sheet go back and forward between versions.</span>
          </div>
        )}
        {issues && (issues.length === 0
          ? <div className="mt-2 text-[12px] text-[#22C55E]">Checked against the building rules: rooms, doors, windows, light, sizes and circulation all pass.</div>
          : <details className="mt-2 text-[12px] text-[#FBBF24]">
              <summary className="cursor-pointer">Checked against the building rules: {issues.length} thing{issues.length === 1 ? "" : "s"} to look at</summary>
              <ul className="mt-1 ml-4 list-disc text-[#C2CAD6] space-y-0.5">{issues.map((x) => <li key={x}>{x}</li>)}</ul>
              <div className="text-[#8A95A5] mt-1">Fix them by dragging, or tick "Change the plan" and ask, e.g. "fix the problems".</div>
            </details>)}
      </div>
      <div className="relative flex-1 min-h-0">
        <iframe ref={frame} src="/floor-plan.html" title="Floor plan sheet" className="absolute inset-0 w-full h-full border-0 bg-white" />
        {busy && <div className="absolute inset-0 bg-black/30 flex items-center justify-center pointer-events-none"><div className="rounded-xl bg-[#11161D] border border-[#222A35] px-4 py-3 text-[13px] text-white inline-flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin text-[#FF8A47]" /> Buildsasa AI is drawing your plan…</div></div>}
      </div>
    </div>
  );
}
