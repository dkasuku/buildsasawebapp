// ============================================================================
// ResponsesPanel — side drawer showing responses submitted to a template's
// public share link, with CSV export. Auth-only (owner/team).
// ============================================================================

import { useEffect, useState } from "react";
import { X, Download, Loader2, Inbox, Clock, User } from "lucide-react";
import { toast } from "sonner";
import api from "../../services/api";
import type { ChecklistTemplateDto } from "../../services/api";

type Sub = { id: string; respondentName?: string | null; respondentEmail?: string | null; data: string; createdAt: string };
type Answer = { group?: string; question?: string; type?: string; answer?: string };

const parse = (s: Sub): Answer[] => { try { const a = JSON.parse(s.data || "[]"); return Array.isArray(a) ? a : []; } catch { return []; } };

export function ResponsesPanel({ template, onClose }: { template: ChecklistTemplateDto; onClose: () => void }) {
  const [subs, setSubs] = useState<Sub[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    let alive = true;
    api.getTemplateSubmissions(template.id).then((r) => { if (alive) { setSubs(r as Sub[]); setLoading(false); } }).catch(() => { if (alive) setLoading(false); });
    return () => { window.removeEventListener("keydown", onKey); alive = false; };
  }, [template.id, onClose]);

  const exportCSV = () => {
    if (!subs.length) return;
    const cols: string[] = [];
    subs.forEach((s) => parse(s).forEach((a) => { if (a.question && !cols.includes(a.question)) cols.push(a.question); }));
    const header = ["Submitted", "Name", "Email", ...cols];
    const rows = subs.map((s) => {
      const m: Record<string, string> = {};
      parse(s).forEach((a) => { if (a.question) m[a.question] = String(a.answer ?? ""); });
      return [new Date(s.createdAt).toLocaleString(), s.respondentName || "", s.respondentEmail || "", ...cols.map((c) => m[c] ?? "")];
    });
    const csv = [header, ...rows].map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `responses-${template.title.replace(/\s+/g, "-").toLowerCase()}.csv`; a.click();
    toast.success("Responses exported");
  };

  return (
    <>
      <div onClick={onClose} className="fixed inset-0 z-[65] bg-black/40" />
      <aside className="fixed inset-y-0 right-0 z-[70] w-full sm:w-[440px] bg-[#0A0E14] border-l border-[#222A35] flex flex-col shadow-2xl">
        <div className="shrink-0 px-4 py-3.5 border-b border-[#222A35] bg-[#11161D] flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-[#FF6B1A]/15 flex items-center justify-center"><Inbox className="w-4 h-4 text-[#FF6B1A]" /></div>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-[0.12em] text-[#5B6675] leading-none">Responses</div>
            <div className="text-[13px] text-white font-display truncate mt-0.5">{template.title}</div>
          </div>
          <button onClick={exportCSV} disabled={!subs.length} title="Export CSV" className="h-8 px-2.5 rounded-md border border-[#222A35] text-[#C2CAD6] hover:text-white hover:border-[#2C3744] flex items-center gap-1.5 text-[12px] disabled:opacity-40"><Download className="w-3.5 h-3.5" /> CSV</button>
          <button onClick={onClose} className="h-8 w-8 rounded-md text-[#8A95A5] hover:text-white hover:bg-[#161C24] flex items-center justify-center"><X className="w-4 h-4" /></button>
        </div>

        <div className="px-4 py-2.5 border-b border-[#222A35] text-[11px] text-[#5B6675] tabular-nums">{loading ? "Loading…" : `${subs.length} response${subs.length === 1 ? "" : "s"}`}</div>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {loading ? (
            <div className="text-center py-12 text-[#5B6675] text-[12px]"><Loader2 className="w-4 h-4 animate-spin inline" /> Loading responses…</div>
          ) : subs.length === 0 ? (
            <div className="text-center py-12 text-[#5B6675] text-[12px] border border-dashed border-[#222A35] rounded-lg">No responses yet. Share the public link to start collecting.</div>
          ) : subs.map((s) => (
            <div key={s.id} className="rounded-lg border border-[#222A35] bg-[#11161D] p-3">
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-1.5 text-[12px] text-white min-w-0"><User className="w-3.5 h-3.5 text-[#8A95A5] shrink-0" /><span className="truncate">{s.respondentName || "Anonymous"}</span>{s.respondentEmail && <span className="text-[10px] text-[#5B6675] truncate">· {s.respondentEmail}</span>}</div>
                <div className="text-[10px] text-[#5B6675] flex items-center gap-1 shrink-0"><Clock className="w-3 h-3" /> {new Date(s.createdAt).toLocaleDateString()}</div>
              </div>
              <div className="space-y-1.5">
                {parse(s).map((a, i) => (
                  <div key={i} className="text-[11px]">
                    <div className="text-[#8A95A5]">{a.group ? <span className="text-[#5B6675]">{a.group} · </span> : null}{a.question}</div>
                    <div className="text-white">{(a.answer ?? "").toString().split("|").join(", ") || <span className="text-[#5B6675]">—</span>}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </aside>
    </>
  );
}

export default ResponsesPanel;
