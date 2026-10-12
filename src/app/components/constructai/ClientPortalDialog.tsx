// Share (or switch off) a project's client portal: a private link the client
// opens without an account to follow progress and approve change orders.

import { useState } from "react";
import { toast } from "sonner";
import { Copy, ExternalLink, Loader2, Mail, MessageCircle, X } from "lucide-react";
import api from "../../services/api";

const portalUrl = (token: string) => `${window.location.origin}/?portal=${token}`;

export function ClientPortalDialog({ projectId, projectName, token, onChange, onClose }: {
  projectId: string;
  projectName: string;
  token?: string | null;
  onChange: (token: string | null) => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);

  const turnOn = async () => {
    setBusy(true);
    try { const r = await api.shareProjectPortal(projectId); onChange(r.portalToken); toast.success("Client portal is on"); }
    catch (e: any) { toast.error(e.message || "Could not turn on the portal"); }
    finally { setBusy(false); }
  };
  const turnOff = async () => {
    if (!window.confirm("Turn off the client portal? The current link will stop working. If you turn it on again, the client gets a new link.")) return;
    setBusy(true);
    try { await api.revokeProjectPortal(projectId); onChange(null); toast.success("Client portal turned off"); }
    catch (e: any) { toast.error(e.message || "Could not turn off the portal"); }
    finally { setBusy(false); }
  };
  const copy = async () => {
    if (!token) return;
    try { await navigator.clipboard.writeText(portalUrl(token)); toast.success("Link copied"); }
    catch { toast.error("Could not copy. Select the link and copy it manually."); }
  };
  const message = token ? `Hello, you can follow progress on ${projectName}, see site photos and invoices, and approve changes here: ${portalUrl(token)}` : "";

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-[#222A35] bg-[#11161D]" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-[#222A35] flex items-center justify-between">
          <div className="text-[14px] text-white font-display">Client portal</div>
          <button onClick={onClose} className="text-[#8A95A5] hover:text-white"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-4 text-[12px]">
          <div className="text-[#C7CDD6] space-y-1.5">
            <p>Give your client a private link to this project. No account or password is needed.</p>
            <ul className="list-disc pl-4 text-[#8A95A5] space-y-1">
              <li><span className="text-[#C7CDD6]">They see:</span> progress, timeline, site photos from daily logs, and invoices you've sent</li>
              <li><span className="text-[#C7CDD6]">They can:</span> approve or reject change orders you've set to <em>Owner Approval</em></li>
              <li><span className="text-[#C7CDD6]">They never see:</span> your costs, daily log notes, subcontractors, team or draft invoices</li>
            </ul>
          </div>

          {token ? (
            <>
              <div className="flex gap-2">
                <input readOnly value={portalUrl(token)} onFocus={(e) => e.target.select()} className="flex-1 min-w-0 h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-3 text-white font-mono text-[11px] focus:outline-none" />
                <button onClick={copy} className="h-9 px-3 rounded-md border border-[#222A35] text-white flex items-center gap-1"><Copy className="w-3.5 h-3.5" />Copy</button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <a href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener noreferrer" className="h-10 rounded-md bg-[#25D366] text-white flex items-center justify-center gap-1.5"><MessageCircle className="w-4 h-4" />WhatsApp</a>
                <a href={`mailto:?subject=${encodeURIComponent(`Your project: ${projectName}`)}&body=${encodeURIComponent(message)}`} className="h-10 rounded-md border border-[#222A35] text-white flex items-center justify-center gap-1.5"><Mail className="w-4 h-4" />Email</a>
                <a href={portalUrl(token)} target="_blank" rel="noopener noreferrer" className="h-10 rounded-md border border-[#222A35] text-white flex items-center justify-center gap-1.5"><ExternalLink className="w-4 h-4" />Preview</a>
              </div>
              <button onClick={turnOff} disabled={busy} className="text-[11px] text-[#EF4444] hover:underline disabled:opacity-60">Turn off portal and disable this link</button>
            </>
          ) : (
            <button onClick={turnOn} disabled={busy} className="w-full h-10 rounded-md bg-[#FF6B1A] hover:bg-[#FF7E33] disabled:opacity-60 text-white flex items-center justify-center gap-1.5">
              {busy && <Loader2 className="w-4 h-4 animate-spin" />} Turn on client portal
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
