// ============================================================================
// ChecklistPreviewPanel — read-only side drawer that previews a checklist
// TEMPLATE (its items grouped by section). An Edit action opens the full
// Form Builder loaded with this template.
// ============================================================================

import { useEffect } from "react";
import { X, PenTool, AlertTriangle, FileText } from "lucide-react";
import type { ChecklistTemplateDto } from "../../services/api";

const TYPE_LABEL: Record<string, string> = {
  text: "Text", number: "Number", percentage: "Percentage",
  yes_no: "Yes / No", checkbox: "Checkbox", photo: "Photo", date: "Date", dropdown: "Dropdown",
};

const asArr = (v: any): string[] => {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") { try { const p = JSON.parse(v); return Array.isArray(p) ? p : (v ? [v] : []); } catch { return v ? v.split("|").map((s) => s.trim()).filter(Boolean) : []; } }
  return [];
};

export function ChecklistPreviewPanel({ template, onClose, onEdit, canEdit }: { template: ChecklistTemplateDto; onClose: () => void; onEdit?: () => void; canEdit?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const items: any[] = (() => { try { const a = JSON.parse(template.items || "[]"); return Array.isArray(a) ? a : []; } catch { return []; } })();
  const order: string[] = [];
  const map = new Map<string, any[]>();
  items.forEach((it) => {
    const g = (it.questionGroup || it.group || "Ungrouped").trim() || "Ungrouped";
    if (!map.has(g)) { map.set(g, []); order.push(g); }
    map.get(g)!.push(it);
  });

  return (
    <>
      <div onClick={onClose} className="fixed inset-0 z-[65] bg-black/40 transition-opacity" />
      <aside className="fixed inset-y-0 right-0 z-[70] w-full sm:w-[420px] bg-[#0A0E14] border-l border-[#222A35] flex flex-col shadow-2xl">
        <div className="shrink-0 px-4 py-3.5 border-b border-[#222A35] bg-[#11161D] flex items-center gap-2.5">
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-[0.12em] text-[#5B6675] leading-none">Template preview</div>
            <div className="text-[13px] text-white font-display truncate mt-0.5">{template.title}</div>
          </div>
          {canEdit && onEdit && <button onClick={onEdit} title="Edit in Form Builder" className="h-8 px-2.5 rounded-md border border-[#222A35] text-[#C2CAD6] hover:text-white hover:border-[#2C3744] flex items-center gap-1.5 text-[12px]"><PenTool className="w-3.5 h-3.5" /> Edit</button>}
          <button onClick={onClose} title="Close" className="h-8 w-8 rounded-md text-[#8A95A5] hover:text-white hover:bg-[#161C24] flex items-center justify-center"><X className="w-4 h-4" /></button>
        </div>

        <div className="px-4 py-2.5 border-b border-[#222A35] text-[11px] text-[#5B6675] flex flex-wrap gap-x-3 tabular-nums">
          <span>{template.trade}</span>
          {template.category && <span>· {template.category}</span>}
          <span>· {items.length} item(s)</span>
          <span>· {order.length} group(s)</span>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {items.length === 0 ? (
            <div className="text-[12px] text-[#5B6675] py-8 text-center border border-dashed border-[#222A35] rounded-lg">This template has no items.</div>
          ) : order.map((g) => (
            <div key={g}>
              <div className="text-[10px] uppercase tracking-[0.08em] text-[#FF6B1A] font-semibold mb-1.5 pb-1 border-b border-[#222A35]">{g}</div>
              <div className="space-y-1.5">
                {map.get(g)!.map((it, i) => {
                  const caption = it.caption || it.question || it.title || "Untitled";
                  const opts = it.answerOptions !== undefined ? asArr(it.answerOptions) : asArr(it.options);
                  const acts = asArr(it.correctiveActions);
                  const type = TYPE_LABEL[it.questionType] || it.questionType || "—";
                  return (
                    <div key={i} className="rounded-md border border-[#222A35] bg-[#11161D] p-2.5">
                      <div className="flex items-start gap-2">
                        <span className="font-mono text-[10px] text-[#5B6675] tabular-nums mt-0.5">{String(i + 1).padStart(2, "0")}</span>
                        <div className="flex-1 min-w-0">
                          <div className="text-[12px] text-white">{caption} {it.required && <span className="text-[#EF4444]">*</span>}</div>
                          <div className="flex flex-wrap items-center gap-1.5 mt-1">
                            <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#222A35] text-[#8A95A5]">{type}</span>
                            {opts.map((o) => <span key={o} className="text-[10px] px-1.5 py-0.5 rounded bg-[#0A0E14] border border-[#222A35] text-[#C2CAD6]">{o}</span>)}
                            {it.photoAvailable === "Yes" && <span className="text-[10px] text-[#5B6675]">photo</span>}
                          </div>
                          {it.policy && <div className="text-[10px] text-[#5B6675] mt-1 flex items-center gap-1"><FileText className="w-3 h-3 shrink-0" /> Ref: {it.policy}</div>}
                          {it.correctiveOption && acts.length > 0 && <div className="text-[10px] text-[#F5A623] mt-1 flex items-start gap-1"><AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" /> If "{it.correctiveOption}" → {acts.join(", ")}</div>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="shrink-0 p-3 border-t border-[#222A35] flex justify-end gap-2">
          <button onClick={onClose} className="h-9 px-4 rounded-md border border-[#222A35] text-[12px] text-[#8A95A5] hover:text-white">Close</button>
          {canEdit && onEdit && <button onClick={onEdit} className="h-9 px-4 rounded-md bg-[#FF6B1A] hover:bg-[#FF7E33] text-white text-[12px] font-medium flex items-center gap-1.5"><PenTool className="w-3.5 h-3.5" /> Edit in Form Builder</button>}
        </div>
      </aside>
    </>
  );
}

export default ChecklistPreviewPanel;
