// The project's "Client" tab: who the client is, what they can see, and the
// two ways to keep them informed — progress updates tagged to a stage (with
// bulk photos and short videos) and a chat. Built for clients abroad who need
// to trust what is happening on a site they cannot visit.
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Eye, Loader2, Mail, MessageCircle, Send, Trash2, UserPlus } from "lucide-react";
import { ChatThread, MediaPicker, UpdateFeed } from "../client/ClientParts";
import { clientApi, STAGES, UPDATE_KINDS, type ClientUpdate, type Media } from "../client/clientData";

const input = "w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-3 text-[12.5px] text-white placeholder:text-[#5B6675] focus:outline-none focus:border-[#FF6B1A]/60";
const card = "rounded-xl border border-[#222A35] bg-[#11161D]";

export function ClientFolder({ projectId, canInvite }: { projectId: string; canInvite: boolean }) {
  const [clients, setClients] = useState<{ id: string; email: string; name?: string | null; joined: boolean }[] | null>(null);
  const [updates, setUpdates] = useState<ClientUpdate[] | null>(null);
  const [tab, setTab] = useState<"updates" | "chat">("updates");
  const [inv, setInv] = useState({ email: "", name: "" });
  const [inviting, setInviting] = useState(false);
  const [f, setF] = useState({ stage: "clearing", kind: "progress", title: "", body: "" });
  const [media, setMedia] = useState<Media[]>([]);
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    clientApi.projectClients(projectId).then(setClients).catch(() => setClients([]));
    clientApi.projectUpdates(projectId).then(setUpdates).catch(() => setUpdates([]));
  }, [projectId]);

  const invite = async () => {
    if (!inv.email.trim()) return toast.error("Enter the client's email address.");
    setInviting(true);
    try {
      const c = await clientApi.inviteClient(projectId, inv.email.trim(), inv.name.trim() || undefined);
      setClients((x) => [...(x || []).filter((y) => y.id !== c.id), c]);
      setInv({ email: "", name: "" });
      toast.success(c.joined ? "Added. The client can see this project now." : "Invitation emailed. The project appears once they create their free client account.");
    } catch (e: any) { toast.error(e?.message || "Couldn't invite the client."); }
    finally { setInviting(false); }
  };
  const remove = async (id: string) => {
    if (!window.confirm("Stop sharing this project with this client?")) return;
    try { await clientApi.removeClient(projectId, id); setClients((x) => (x || []).filter((c) => c.id !== id)); } catch (e: any) { toast.error(e?.message || "Couldn't remove."); }
  };
  const post = async () => {
    if (!f.title.trim()) return toast.error("Give the update a short title.");
    setPosting(true);
    try {
      const u = await clientApi.postUpdate(projectId, { ...f, media });
      setUpdates((x) => [u, ...(x || [])]);
      setF((x) => ({ ...x, title: "", body: "" })); setMedia([]);
      toast.success(clients?.length ? "Shared with your client." : "Saved. Invite the client so they can see it.");
    } catch (e: any) { toast.error(e?.message || "Couldn't share the update."); }
    finally { setPosting(false); }
  };
  const del = async (u: ClientUpdate) => {
    if (!window.confirm("Remove this update? The client will no longer see it.")) return;
    try { await clientApi.deleteUpdate(projectId, u.id); setUpdates((x) => (x || []).filter((y) => y.id !== u.id)); } catch (e: any) { toast.error(e?.message || "Couldn't remove."); }
  };

  return (
    <div className="space-y-4">
      <section className={`${card} p-4`}>
        <div className="flex items-center gap-2 text-[13px] text-white"><UserPlus className="w-4 h-4 text-[#FF6B1A]" /> Client access</div>
        <p className="text-[12px] text-[#8A95A5] mt-1">Invite the project owner by email. They get a free Buildsasa client account where they see progress updates, daily logs you share, shared inspections, change orders, finish selections and invoices, and can chat with you.</p>
        <div className="mt-3 space-y-1.5">
          {clients === null ? <div className="text-[12px] text-[#5B6675]"><Loader2 className="w-3.5 h-3.5 animate-spin inline mr-1" />Loading…</div>
            : clients.length === 0 ? <div className="text-[12px] text-[#5B6675]">No client invited yet.</div>
            : clients.map((c) => (
              <div key={c.id} className="flex items-center gap-2 text-[12.5px] rounded-lg border border-[#222A35] px-3 py-2">
                <Mail className="w-4 h-4 text-[#5B6675]" />
                <span className="text-white truncate">{c.name ? `${c.name} · ` : ""}{c.email}</span>
                <span className={`ml-auto text-[10.5px] px-2 py-0.5 rounded-full ${c.joined ? "bg-[#22C55E]/10 text-[#22C55E]" : "bg-[#F59E0B]/10 text-[#F59E0B]"}`}>{c.joined ? "Has access" : "Invited"}</span>
                {canInvite && <button onClick={() => remove(c.id)} className="text-[#5B6675] hover:text-[#EF4444]" title="Remove access"><Trash2 className="w-4 h-4" /></button>}
              </div>
            ))}
        </div>
        {canInvite && (
          <div className="grid sm:grid-cols-[1fr_1fr_auto] gap-2 mt-3">
            <input value={inv.name} onChange={(e) => setInv({ ...inv, name: e.target.value })} placeholder="Client's name, e.g. Mary Wanjiru" className={input} />
            <input value={inv.email} onChange={(e) => setInv({ ...inv, email: e.target.value })} placeholder="Client's email, e.g. mary@gmail.com" className={input} />
            <button onClick={invite} disabled={inviting} className="h-9 px-3 rounded-md bg-[#FF6B1A] text-white text-[12px] inline-flex items-center justify-center gap-1.5 disabled:opacity-60">{inviting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Invite</button>
          </div>
        )}
        <div className="mt-3 text-[11px] text-[#5B6675] flex items-start gap-1.5"><Eye className="w-3.5 h-3.5 mt-0.5 shrink-0" />Daily logs are shared by default (photos, videos, weather and headcount; your notes stay internal), and you can switch any log off. Inspections are shared one by one with the "Share with client" button on each inspection.</div>
      </section>

      <div className="flex gap-1.5">
        <button onClick={() => setTab("updates")} className={`h-9 px-3 rounded-lg text-[12.5px] border ${tab === "updates" ? "bg-[#FF6B1A] border-[#FF6B1A] text-white" : "border-[#222A35] text-[#C2CAD6]"}`}>Progress updates{updates?.length ? ` · ${updates.length}` : ""}</button>
        <button onClick={() => setTab("chat")} className={`h-9 px-3 rounded-lg text-[12.5px] border inline-flex items-center gap-1.5 ${tab === "chat" ? "bg-[#FF6B1A] border-[#FF6B1A] text-white" : "border-[#222A35] text-[#C2CAD6]"}`}><MessageCircle className="w-4 h-4" /> Chat with client</button>
      </div>

      {tab === "updates" && (
        <>
          <section className={`${card} p-4 space-y-3`}>
            <div className="text-[13px] text-white">Share an update with the client</div>
            <div className="grid sm:grid-cols-2 gap-2">
              <label className="block"><span className="text-[11px] text-[#8A95A5]">Stage</span>
                <select value={f.stage} onChange={(e) => setF({ ...f, stage: e.target.value })} className={input}>{STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select>
              </label>
              <label className="block"><span className="text-[11px] text-[#8A95A5]">Type</span>
                <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} className={input}>{UPDATE_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}</select>
              </label>
            </div>
            <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Fence posts set along the north boundary" className={input} />
            <textarea value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} rows={3} placeholder="e.g. 48 concrete posts set at 3 m spacing. Chain-link goes up on Thursday if the weather holds." className="w-full bg-[#0A0E14] border border-[#222A35] rounded-md px-3 py-2 text-[12.5px] text-white placeholder:text-[#5B6675] focus:outline-none focus:border-[#FF6B1A]/60" />
            <MediaPicker value={media} onChange={setMedia} />
            <button onClick={post} disabled={posting} className="h-9 px-4 rounded-md bg-[#FF6B1A] text-white text-[12.5px] inline-flex items-center gap-1.5 disabled:opacity-60">{posting && <Loader2 className="w-4 h-4 animate-spin" />}Share with client</button>
          </section>
          {updates === null ? <div className="text-[12px] text-[#5B6675]"><Loader2 className="w-3.5 h-3.5 animate-spin inline mr-1" />Loading…</div>
            : <UpdateFeed updates={updates} onDelete={del} empty="Nothing shared yet. Post photos of each stage (land clearing, fencing, foundation, roofing…) so the client sees the work as it happens." />}
        </>
      )}
      {tab === "chat" && <ChatThread load={() => clientApi.projectMessages(projectId)} send={(b, m) => clientApi.sendProjectMessage(projectId, b, m)} mine={(m) => m.senderType === "team"} placeholder="Message the client…" />}
    </div>
  );
}
