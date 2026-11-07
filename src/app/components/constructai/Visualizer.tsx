// The Visualizer: a raw site photo and the AI's finished interior side by
// side on a draggable slider, with a costed materials table underneath that
// exports to CSV. Shown in the Buildsasa AI chat and, larger, in its preview.
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Download, FolderPlus, Loader2, Maximize2 } from "lucide-react";
import api from "../../services/api";
import { exportCsv, type AiDesignResult } from "./AiAssistantPanel";
import { useProjects } from "./useProjects";

const kes = (n: number) => Math.round(n || 0).toLocaleString("en-KE");

/** Drag (or tap) to compare before and after. Without a "before", just the result. */
export function BeforeAfter({ before, after, tall }: { before?: string; after: string; tall?: boolean }) {
  const [pos, setPos] = useState(50);
  const box = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const move = (clientX: number) => {
    const r = box.current?.getBoundingClientRect();
    if (r) setPos(Math.min(100, Math.max(0, ((clientX - r.left) / r.width) * 100)));
  };
  if (!before) return <img src={after} alt="AI design" className={`w-full rounded-xl object-cover bg-black ${tall ? "max-h-[62vh]" : "max-h-80"}`} />;
  return (
    <div ref={box} className={`relative w-full overflow-hidden rounded-xl bg-black select-none touch-none cursor-ew-resize ${tall ? "aspect-[3/2] max-h-[62vh]" : "aspect-[3/2]"}`}
      onPointerDown={(e) => { dragging.current = true; (e.target as HTMLElement).setPointerCapture?.(e.pointerId); move(e.clientX); }}
      onPointerMove={(e) => dragging.current && move(e.clientX)}
      onPointerUp={() => { dragging.current = false; }}
      onKeyDown={(e) => { if (e.key === "ArrowLeft") setPos((p) => Math.max(0, p - 5)); if (e.key === "ArrowRight") setPos((p) => Math.min(100, p + 5)); }}
      tabIndex={0} role="slider" aria-label="Compare before and after" aria-valuenow={Math.round(pos)} aria-valuemin={0} aria-valuemax={100}>
      <img src={after} alt="After: AI design" className="absolute inset-0 w-full h-full object-cover" draggable={false} />
      <div className="absolute inset-0 overflow-hidden" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}>
        <img src={before} alt="Before: the space as it is" className="absolute inset-0 w-full h-full object-cover" draggable={false} />
      </div>
      <span className="absolute top-2.5 left-2.5 text-[11px] px-2 py-0.5 rounded-md bg-black/65 text-[#ffffff]">BEFORE</span>
      <span className="absolute top-2.5 right-2.5 text-[11px] px-2 py-0.5 rounded-md bg-black/65 text-[#ffffff]">AFTER</span>
      <div className="absolute inset-y-0 w-0.5 bg-white shadow-[0_0_8px_rgba(0,0,0,0.6)]" style={{ left: `${pos}%` }}>
        <span className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-8 h-8 rounded-full bg-white text-[#11161D] text-[12px] font-bold flex items-center justify-center shadow-lg">⇆</span>
      </div>
    </div>
  );
}

function downloadImage(url: string) {
  // Cross-origin downloads ignore the download attribute; fetch the bytes first.
  fetch(url).then((r) => r.blob()).then((b) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(b); a.download = `buildsasa-design-${new Date().toISOString().slice(0, 10)}.png`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }).catch(() => window.open(url, "_blank"));
}
const exportEstimate = (d: AiDesignResult) => d.estimate && exportCsv(
  ["Item", "Description", "Quantity", "Unit", "Rate (KES)", "Amount (KES)"],
  [...d.estimate.items.map((it) => [it.item, it.description, String(it.quantity), it.unit, kes(it.rate), kes(it.amount)]), ["", "Total", "", "", "", kes(d.estimate.total)]],
);

export function EstimateTable({ d, big }: { d: AiDesignResult; big?: boolean }) {
  if (!d.estimate?.items.length) return null;
  const e = d.estimate;
  return (
    <div className="rounded-lg border border-[#222A35] overflow-hidden">
      <div className="overflow-x-auto">
        <table className={`w-full ${big ? "text-[12.5px]" : "text-[11.5px]"}`}>
          <thead className="bg-[#161C24] text-[#8A95A5]"><tr>
            {["#", "Item", "Description", "Qty", "Unit", "Amount (KES)"].map((h) => <th key={h} className={`text-left font-medium px-2.5 py-2 whitespace-nowrap ${h === "Amount (KES)" ? "text-right" : ""}`}>{h}</th>)}
          </tr></thead>
          <tbody>
            {e.items.map((it, k) => (
              <tr key={k} className="border-t border-[#222A35] text-[#C2CAD6] align-top">
                <td className="px-2.5 py-2 text-[#5B6675]">{k + 1}</td>
                <td className="px-2.5 py-2 text-white">{it.item}</td>
                <td className="px-2.5 py-2">{it.description}</td>
                <td className="px-2.5 py-2 whitespace-nowrap">{it.quantity.toLocaleString("en-KE")}</td>
                <td className="px-2.5 py-2">{it.unit}</td>
                <td className="px-2.5 py-2 text-right whitespace-nowrap">{kes(it.amount)}</td>
              </tr>
            ))}
            <tr className="border-t border-[#2C3744] bg-[#161C24]"><td colSpan={5} className="px-2.5 py-2 text-right text-white font-semibold">Total estimated cost</td><td className="px-2.5 py-2 text-right text-white font-semibold whitespace-nowrap">KES {kes(e.total)}</td></tr>
          </tbody>
        </table>
      </div>
      {e.assumptions && <div className="px-3 py-2 border-t border-[#222A35] text-[11px] text-[#8A95A5]">Assumed: {e.assumptions} Prices are estimates; confirm with suppliers.</div>}
    </div>
  );
}

/** The design as it appears in the chat. */
export function DesignCard({ d, onPreview }: { d: AiDesignResult; onPreview?: () => void }) {
  return (
    <div className="space-y-2.5">
      <BeforeAfter before={d.before} after={d.after} />
      <EstimateTable d={d} />
      <div className="flex flex-wrap gap-2">
        {onPreview && <button onClick={onPreview} className="h-8 px-3 rounded-lg border border-[#222A35] text-[12px] text-[#C2CAD6] hover:text-white inline-flex items-center gap-1.5"><Maximize2 className="w-3.5 h-3.5" /> Open in preview</button>}
        {!!d.estimate?.items.length && <button onClick={() => exportEstimate(d)} className="h-8 px-3 rounded-lg bg-[#FF6B1A] text-white text-[12px] inline-flex items-center gap-1.5"><Download className="w-3.5 h-3.5" /> Export to CSV</button>}
        <button onClick={() => downloadImage(d.after)} className="h-8 px-3 rounded-lg border border-[#FF6B1A]/40 text-[#FF8A47] text-[12px] inline-flex items-center gap-1.5"><Download className="w-3.5 h-3.5" /> Download image</button>
      </div>
    </div>
  );
}

/** The preview pane: big slider, the table, and filing it to a project. */
export function DesignPreview({ d }: { d: AiDesignResult }) {
  const { projects } = useProjects();
  const [pid, setPid] = useState("");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!pid) return toast.error("Choose a project first.");
    setSaving(true);
    try { await api.saveDesignToProject(d.id, { projectId: pid, title: d.prompt.slice(0, 120) }); toast.success("Saved to the project's drawings as an AI concept."); }
    catch (e: any) { toast.error(e?.message || "Couldn't save the design."); }
    finally { setSaving(false); }
  };
  return (
    <div className="space-y-4">
      <BeforeAfter before={d.before} after={d.after} tall />
      <p className="text-[12.5px] text-[#C2CAD6]"><span className="text-[#8A95A5]">Brief:</span> {d.prompt}</p>
      <EstimateTable d={d} big />
      {d.estimate?.notes && <div className="rounded-lg border border-[#222A35] bg-[#11161D] p-3 text-[12px] text-[#C2CAD6] whitespace-pre-wrap">{d.estimate.notes}</div>}
      <div className="flex flex-wrap gap-2">
        {!!d.estimate?.items.length && <button onClick={() => exportEstimate(d)} className="h-9 px-4 rounded-lg bg-[#FF6B1A] text-white text-[12.5px] inline-flex items-center gap-1.5"><Download className="w-4 h-4" /> Export to CSV</button>}
        <button onClick={() => downloadImage(d.after)} className="h-9 px-4 rounded-lg border border-[#FF6B1A]/40 text-[#FF8A47] text-[12.5px] inline-flex items-center gap-1.5"><Download className="w-4 h-4" /> Download image</button>
      </div>
      {projects.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <select value={pid} onChange={(e) => setPid(e.target.value)} className="h-9 rounded-lg bg-[#0A0E14] border border-[#222A35] px-2 text-[12.5px] text-white">
            <option value="">Save to a project…</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button onClick={save} disabled={saving || !pid} className="h-9 px-3 rounded-lg border border-[#222A35] text-[12.5px] text-[#C2CAD6] hover:text-white inline-flex items-center gap-1.5 disabled:opacity-50">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <FolderPlus className="w-4 h-4" />} Save to drawings</button>
        </div>
      )}
    </div>
  );
}
