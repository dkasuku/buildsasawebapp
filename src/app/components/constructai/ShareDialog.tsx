// ============================================================================
// ShareDialog — generate a shareable link for a checklist template and choose
// Public (fillable by anyone, no login) or Private (link off, team-only).
// ============================================================================

import { useState } from "react";
import { toast } from "sonner";
import { X, Link2, Copy, Globe, Lock, Loader2, ExternalLink, Inbox } from "lucide-react";
import api from "../../services/api";
import type { ChecklistTemplateDto } from "../../services/api";

export function ShareDialog({ template, onClose, onUpdated, onViewResponses }: { template: ChecklistTemplateDto; onClose: () => void; onUpdated?: () => void; onViewResponses?: () => void }) {
  const t = template as any;
  const [isPublic, setIsPublic] = useState<boolean>(!!t.sharePublic);
  const [token, setToken] = useState<string>(t.shareToken || "");
  const [busy, setBusy] = useState(false);

  const link = token ? `${window.location.origin}/?form=${token}` : "";

  const apply = async (next: boolean) => {
    setBusy(true);
    try {
      const r = await api.shareTemplate(template.id, next);
      setToken(r.token);
      setIsPublic(r.public);
      onUpdated?.();
      toast.success(next ? "Public link is on" : "Link set to private");
    } catch (e: any) { toast.error(e?.message || "Could not update sharing"); }
    setBusy(false);
  };

  const copy = () => { if (link) { navigator.clipboard?.writeText(link); toast.success("Link copied"); } };

  return (
    <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-[#222A35] bg-[#11161D]" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-[#222A35] flex items-center justify-between">
          <div className="text-[15px] text-white font-display flex items-center gap-2"><Link2 className="w-4 h-4 text-[#FF6B1A]" /> Share form</div>
          <button onClick={onClose} className="text-[#8A95A5] hover:text-white"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-5 space-y-4">
          <div className="text-[12px] text-[#8A95A5]">Sharing <span className="text-white">{template.title}</span></div>

          {/* visibility choice */}
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => apply(true)} disabled={busy} className={`rounded-lg border p-3 text-left ${isPublic ? "border-[#FF6B1A] bg-[#FF6B1A]/5" : "border-[#222A35] bg-[#0A0E14]"}`}>
              <div className="flex items-center gap-1.5 text-[12px] text-white"><Globe className="w-3.5 h-3.5 text-[#22C55E]" /> Public</div>
              <div className="text-[10px] text-[#5B6675] mt-1">Anyone with the link can fill it — no login.</div>
            </button>
            <button onClick={() => apply(false)} disabled={busy} className={`rounded-lg border p-3 text-left ${!isPublic ? "border-[#FF6B1A] bg-[#FF6B1A]/5" : "border-[#222A35] bg-[#0A0E14]"}`}>
              <div className="flex items-center gap-1.5 text-[12px] text-white"><Lock className="w-3.5 h-3.5 text-[#8A95A5]" /> Private</div>
              <div className="text-[10px] text-[#5B6675] mt-1">Link is off; only your team uses it in the app.</div>
            </button>
          </div>

          {/* link */}
          {isPublic && link && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[#8A95A5] mb-1">Public link</div>
              <div className="flex gap-2">
                <input readOnly value={link} className="flex-1 h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-2.5 text-[12px] text-[#C2CAD6] focus:outline-none" onFocus={(e) => e.currentTarget.select()} />
                <button onClick={copy} className="h-9 px-3 rounded-md bg-[#FF6B1A] text-white text-[12px] flex items-center gap-1.5"><Copy className="w-3.5 h-3.5" /> Copy</button>
              </div>
              <a href={link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] text-[#FF6B1A] hover:underline mt-2"><ExternalLink className="w-3 h-3" /> Open the form</a>
            </div>
          )}

          {busy && <div className="text-[11px] text-[#8A95A5] flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Updating…</div>}
        </div>

        <div className="px-5 py-4 border-t border-[#222A35] flex items-center justify-between">
          {onViewResponses ? <button onClick={onViewResponses} className="text-[12px] text-[#FF6B1A] hover:underline flex items-center gap-1.5"><Inbox className="w-3.5 h-3.5" /> View responses</button> : <span />}
          <button onClick={onClose} className="h-9 px-4 rounded-md border border-[#222A35] text-[12px] text-[#8A95A5] hover:text-white">Done</button>
        </div>
      </div>
    </div>
  );
}

export default ShareDialog;
