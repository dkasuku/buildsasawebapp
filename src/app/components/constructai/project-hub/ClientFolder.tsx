// The project's "Client" tab: who the client is, what they can see, and the
// two ways to keep them informed — progress updates tagged to a stage (with
// bulk photos and short videos) and a chat. Built for clients abroad who need
// to trust what is happening on a site they cannot visit.
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Copy, Eye, Loader2, Lock, Mail, MessageCircle, Send, Trash2, UserPlus, Users } from "lucide-react";
import { ChatThread, CommentThread, MediaPicker, UpdateFeed } from "../client/ClientParts";
import { clientApi, STAGES, UPDATE_KINDS, when, type ClientComment, type ClientUpdate, type Media } from "../client/clientData";
import { Tabs } from "../PageShell";

const input = "w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-3 text-[12.5px] text-white placeholder:text-[#5B6675] focus:outline-none focus:border-[#FF6B1A]/60";
const card = "rounded-xl border border-[#222A35] bg-[#11161D]";

export function ClientFolder({ projectId, canInvite, onOpenPortal }: { projectId: string; canInvite: boolean; /** The older view-only link, for clients who won't create an account. */ onOpenPortal?: () => void }) {
  const [clients, setClients] = useState<{ id: string; email: string; name?: string | null; joined: boolean }[] | null>(null);
  const [updates, setUpdates] = useState<ClientUpdate[] | null>(null);
  const [tab, setTab] = useState<"updates" | "chat" | "feedback">("updates");
  const [priv, setPriv] = useState(false);
  const [comments, setComments] = useState<ClientComment[]>([]);
  const [inv, setInv] = useState({ email: "", name: "" });
  const [inviting, setInviting] = useState(false);
  const [f, setF] = useState({ stage: "clearing", kind: "progress", title: "", body: "" });
  const [media, setMedia] = useState<Media[]>([]);
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    clientApi.projectClients(projectId).then(setClients).catch(() => setClients([]));
    clientApi.projectUpdates(projectId).then(setUpdates).catch(() => setUpdates([]));
    clientApi.projectComments(projectId).then(setComments).catch(() => {});
  }, [projectId]);
  const reply = (type: string, tid: string) => (
    <CommentThread mineType="team" comments={comments.filter((c) => c.targetType === type && c.targetId === tid)}
      onSend={async (b, m) => { const c = await clientApi.replyComment(projectId, type, tid, b, m); setComments((x) => [...x, c]); }} />
  );
  const clientComments = comments.filter((c) => c.authorType === "client");
  const link = (email = "") => `${window.location.origin}/?as=client${email ? `&email=${encodeURIComponent(email)}` : ""}`;
  const copyLink = async (email?: string) => { try { await navigator.clipboard.writeText(link(email)); toast.success("Invite link copied. Send it on WhatsApp or SMS."); } catch { toast.error(link(email)); } };

  const invite = async () => {
    if (!inv.email.trim()) return toast.error("Enter the client's email address.");
    setInviting(true);
    try {
      let c;
      try { c = await clientApi.inviteClient(projectId, inv.email.trim(), inv.name.trim() || undefined); }
      catch (e: any) {
        // Already on our team (often added as a viewer): offer to move them to the client panel.
        if (!/client account so they get the client panel/i.test(e?.message || "") || !window.confirm(e.message)) throw e;
        c = await clientApi.inviteClient(projectId, inv.email.trim(), inv.name.trim() || undefined, true);
      }
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
      toast.success(clients?.some((c) => c.joined) ? "Shared with your client." : "Shared. Your client sees it as soon as they create their account.");
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
                {!c.joined && <button onClick={() => copyLink(c.email)} className="text-[#5B6675] hover:text-white" title="Copy invite link to send on WhatsApp or SMS"><Copy className="w-4 h-4" /></button>}
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
        {canInvite && (
          <div className="mt-2 flex flex-wrap gap-2 text-[11.5px]">
            <button onClick={() => copyLink(inv.email.trim())} className="inline-flex items-center gap-1 text-[#8A95A5] hover:text-white"><Copy className="w-3.5 h-3.5" /> Copy invite link</button>
            <a href={`https://wa.me/?text=${encodeURIComponent(`Follow our project on Buildsasa: photos and videos of every stage, approvals and chat. Create your free client account here: ${link(inv.email.trim())}`)}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[#25D366]"><MessageCircle className="w-3.5 h-3.5" /> Send invite on WhatsApp</a>
            <span className="text-[#5B6675]">The client must sign up with the email you invite, then the project appears for them.</span>
            {onOpenPortal && <button onClick={onOpenPortal} className="text-[#8A95A5] hover:text-white underline">Client won't sign up? Share a view-only link instead</button>}
          </div>
        )}
        <div className="mt-3 text-[11px] text-[#5B6675] flex items-start gap-1.5"><Eye className="w-3.5 h-3.5 mt-0.5 shrink-0" />Daily logs are shared by default (photos, videos, weather and headcount; your notes stay internal), and you can switch any log off. Inspections are shared one by one with the "Share with client" button on each inspection.</div>
      </section>

      {clients !== null && clients.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[#2C3744] bg-[#11161D] p-6 text-center">
          <div className="text-[13.5px] text-white">No client on this project yet</div>
          <p className="text-[12px] text-[#8A95A5] mt-1 max-w-md mx-auto">Invite the project owner above first. Then you can share progress updates, reports and documents, and chat with them. Nothing is shared until someone is invited.</p>
        </div>
      ) : (<>
      {clients?.length ? (
        <p className="text-[11.5px] text-[#8A95A5]">Sharing with {clients.map((c) => c.name || c.email).join(", ")}{clients.some((c) => !c.joined) ? " (invited clients see everything once they create their account)" : ""}.</p>
      ) : null}
      <Tabs label="Client sections" value={tab} onChange={setTab} items={[{ id: "updates", label: "Progress updates", count: updates?.length }, { id: "chat", label: "Chat with client" }, { id: "feedback", label: "Client feedback", count: clientComments.length }]} />

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
            <MediaPicker value={media} onChange={setMedia} docs />
            <p className="text-[11px] text-[#5B6675]">Attach photos, short videos, or documents such as your weekly site report, drawings or a proposal.</p>
            <button onClick={post} disabled={posting} className="h-9 px-4 rounded-md bg-[#FF6B1A] text-white text-[12.5px] inline-flex items-center gap-1.5 disabled:opacity-60">{posting && <Loader2 className="w-4 h-4 animate-spin" />}Share with client</button>
          </section>
          {updates === null ? <div className="text-[12px] text-[#5B6675]"><Loader2 className="w-3.5 h-3.5 animate-spin inline mr-1" />Loading…</div>
            : <UpdateFeed updates={updates} onDelete={del} renderComments={(u) => reply("update", u.id)} empty="Nothing shared yet. Post photos of each stage (land clearing, fencing, foundation, roofing…) so the client sees the work as it happens." />}
        </>
      )}
      {tab === "chat" && (
        <>
          <div className="flex gap-1.5">
            <button onClick={() => setPriv(false)} className={`h-8 px-3 rounded-full text-[12px] border inline-flex items-center gap-1.5 ${!priv ? "bg-[#161C24] border-[#2C3744] text-white" : "border-[#222A35] text-[#8A95A5]"}`}><Users className="w-3.5 h-3.5" /> Team chat</button>
            <button onClick={() => setPriv(true)} className={`h-8 px-3 rounded-full text-[12px] border inline-flex items-center gap-1.5 ${priv ? "bg-[#161C24] border-[#2C3744] text-white" : "border-[#222A35] text-[#8A95A5]"}`}><Lock className="w-3.5 h-3.5" /> Private chat</button>
          </div>
          <p className="text-[11.5px] text-[#8A95A5]">{priv ? "Only you and the client can read this chat. Your teammates can't see it." : "Everyone on your team who can open this project can read this chat with the client."}</p>
          <ChatThread key={priv ? "p" : "g"} load={() => clientApi.projectMessages(projectId, priv)} send={(b, m) => clientApi.sendProjectMessage(projectId, b, m, priv)} mine={(m) => m.senderType === "team"} placeholder={priv ? "Private message to the client…" : "Message the client…"} />
        </>
      )}
      {tab === "feedback" && (
        clientComments.length === 0 ? <div className="rounded-xl border border-dashed border-[#2C3744] bg-[#11161D] p-8 text-center text-[12.5px] text-[#8A95A5]">No feedback yet. When the client comments on an update, daily log, inspection, change order or finish, with or without photos, it shows here for you to reply.</div> : (
          <div className="space-y-3">
            {[...new Map(clientComments.slice().reverse().map((c) => [c.targetType + c.targetId, c])).values()].map((c) => (
              <div key={c.targetType + c.targetId} className={`${card} p-4`}>
                <div className="text-[11px] text-[#8A95A5]">On a {c.targetType === "dailylog" ? "daily log" : c.targetType === "changeorder" ? "change order" : c.targetType === "update" ? "progress update" : c.targetType} · latest {when(c.createdAt)}</div>
                <div className="text-[13px] text-white mt-0.5">{(updates || []).find((u) => u.id === c.targetId)?.title || c.body || "Photos from the client"}</div>
                {reply(c.targetType, c.targetId)}
              </div>
            ))}
          </div>
        )
      )}
      </>)}
    </div>
  );
}
