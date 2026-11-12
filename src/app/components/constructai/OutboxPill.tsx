// What is waiting on this phone to be sent (idea.md 6.3). Invisible when the
// outbox is empty. Amber while things wait for signal, red if the server
// refused something; tap to see each item, retry it or discard it.
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CloudOff, Loader2, RotateCw, Trash2, X } from "lucide-react";
import { discard, flushOutbox, onOutboxChange, outboxItems, retry, startOutbox, type OutboxItem } from "../../services/outbox";

export function OutboxPill() {
  const [items, setItems] = useState<OutboxItem[]>([]);
  const [open, setOpen] = useState(false);
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    startOutbox();
    const load = () => outboxItems().then(setItems).catch(() => {});
    load();
    const off = onOutboxChange(load);
    const sent = (e: Event) => toast.success(`Sent: ${(e as CustomEvent).detail?.label || "saved item"}`);
    const on = () => setOnline(true), down = () => setOnline(false);
    window.addEventListener("buildsasa:outbox-sent", sent);
    window.addEventListener("online", on); window.addEventListener("offline", down);
    return () => { off(); window.removeEventListener("buildsasa:outbox-sent", sent); window.removeEventListener("online", on); window.removeEventListener("offline", down); };
  }, []);

  if (!items.length) return null;
  const refused = items.filter((i) => i.error).length;
  const sendNow = async () => { setSending(true); try { await flushOutbox(); } finally { setSending(false); } };

  return (
    <div className="fixed left-3 bottom-3 z-[70] pb-[env(safe-area-inset-bottom)]">
      {open && (
        <div className="mb-2 w-[min(92vw,340px)] rounded-xl border border-[#222A35] bg-[#11161D] shadow-2xl overflow-hidden">
          <div className="px-3.5 py-2.5 border-b border-[#222A35] flex items-center gap-2 text-[13px] text-white">
            Saved on this phone <span className="text-[#8A95A5] text-[12px]">{online ? "· sending" : "· waiting for signal"}</span>
            <button onClick={() => setOpen(false)} className="ml-auto text-[#8A95A5]" aria-label="Close"><X className="w-4 h-4" /></button>
          </div>
          <div className="max-h-[50vh] overflow-y-auto divide-y divide-[#222A35]">
            {items.map((i) => (
              <div key={i.id} className="px-3.5 py-2.5 text-[12.5px]">
                <div className="text-white">{i.label}</div>
                <div className="text-[11px] text-[#8A95A5]">{new Date(i.createdAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}{i.files?.some((f) => f.blobs.length) ? ` · ${i.files!.reduce((s, f) => s + f.blobs.length, 0)} photo(s)` : ""}</div>
                {i.error && <div className="text-[11.5px] text-[#F87171] mt-1">Not accepted: {i.error}</div>}
                {i.error && (
                  <div className="flex gap-3 mt-1.5">
                    <button onClick={() => retry(i.id)} className="text-[12px] text-[#FF8A47] inline-flex items-center gap-1"><RotateCw className="w-3.5 h-3.5" /> Try again</button>
                    <button onClick={() => { if (window.confirm("Discard this? It will not be sent.")) discard(i.id); }} className="text-[12px] text-[#8A95A5] inline-flex items-center gap-1"><Trash2 className="w-3.5 h-3.5" /> Discard</button>
                  </div>
                )}
              </div>
            ))}
          </div>
          {online && !refused && <button onClick={sendNow} disabled={sending} className="w-full h-10 border-t border-[#222A35] text-[12.5px] text-[#FF8A47] inline-flex items-center justify-center gap-1.5">{sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCw className="w-4 h-4" />} Send now</button>}
        </div>
      )}
      <button onClick={() => setOpen((o) => !o)} aria-label={`${items.length} item(s) saved on this phone`}
        className={`h-10 px-3.5 rounded-full shadow-lg text-[12.5px] font-medium inline-flex items-center gap-1.5 transition-transform active:scale-[0.97] text-[#ffffff] ${refused ? "bg-[#DC2626]" : "bg-[#D97706]"}`}>
        {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CloudOff className="w-4 h-4" />}
        {refused ? `${refused} not sent` : `${items.length} waiting to send`}
      </button>
    </div>
  );
}
