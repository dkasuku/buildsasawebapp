// Finish selections for one project: tiles, paint, fittings and fixtures chosen
// room by room. The team adds items as drafts, sends them to the client, who
// approves or asks for changes in the client portal, then the team marks them
// ordered and installed. Changing what the client saw sends an item back to
// draft, so an approval always matches what was approved.

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Palette, Plus, Send, Pencil, Trash2, ImagePlus, Loader2, ExternalLink, CheckCircle2, Package, Hammer, MessageSquare } from "lucide-react";
import api, { absoluteFileUrl, type SelectionDto, type SelectionStatus } from "../../../services/api";
import { useFileUpload } from "../useFileUpload";
import { Panel, Modal, Field, Empty, input, textarea, btnPrimary, btnGhost, useMoney } from "./shared";

const CATEGORIES = ["Tiles", "Flooring", "Paint", "Sanitary ware", "Taps & mixers", "Lighting", "Electrical fittings", "Doors & ironmongery", "Cabinetry", "Worktops", "Wallpaper & decor", "Appliances", "Other"];
const ROOM_SUGGESTIONS = ["Kitchen", "Living room", "Dining", "Master bedroom", "Bedroom 2", "Master bathroom", "Guest bathroom", "Corridor", "Balcony", "Exterior"];
const UNITS = ["m2", "m", "no", "litre", "set", "roll", "item"];

export const SELECTION_STATUS: Record<SelectionStatus, { label: string; color: string }> = {
  draft: { label: "Draft", color: "#8A95A5" },
  awaiting_client: { label: "Waiting for client", color: "#3B82F6" },
  approved: { label: "Approved", color: "#22C55E" },
  changes_requested: { label: "Changes requested", color: "#F59E0B" },
  ordered: { label: "Ordered", color: "#A855F7" },
  installed: { label: "Installed", color: "#14B8A6" },
};

type Form = { room: string; category: string; name: string; spec: string; supplier: string; quantity: string; unit: string; price: string; imageUrl: string; link: string; notes: string };
const EMPTY: Form = { room: "", category: "Tiles", name: "", spec: "", supplier: "", quantity: "", unit: "m2", price: "", imageUrl: "", link: "", notes: "" };

export function SelectionsFolder({ projectId, canEdit, portalOn, onOpenPortal }: { projectId: string; canEdit: boolean; portalOn: boolean; onOpenPortal?: () => void }) {
  const money = useMoney();
  const [items, setItems] = useState<SelectionDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<SelectionDto | "new" | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [saving, setSaving] = useState(false);
  const uploader = useFileUpload();
  const fileRef = useRef<HTMLInputElement>(null);

  const load = () => api.getSelections(projectId).then(setItems).catch((e) => toast.error(e.message || "Could not load selections")).finally(() => setLoading(false));
  useEffect(() => { load(); }, [projectId]);

  const rooms = useMemo(() => {
    const m = new Map<string, SelectionDto[]>();
    items.forEach((s) => { if (!m.has(s.room)) m.set(s.room, []); m.get(s.room)!.push(s); });
    return [...m.entries()];
  }, [items]);
  const count = (st: SelectionStatus) => items.filter((s) => s.status === st).length;
  const drafts = count("draft");
  const allowance = items.reduce((sum, s) => sum + (s.unitPriceKES || 0) * (s.quantity || 0), 0);

  const openNew = (room = "") => { setForm({ ...EMPTY, room }); uploader.reset(); setEditing("new"); };
  const openEdit = (s: SelectionDto) => {
    setForm({ room: s.room, category: s.category, name: s.name, spec: s.spec || "", supplier: s.supplier || "", quantity: s.quantity != null ? String(s.quantity) : "", unit: s.unit || "", price: money.fromBase(s.unitPriceKES), imageUrl: s.imageUrl || "", link: s.link || "", notes: s.notes || "" });
    uploader.reset();
    setEditing(s);
  };

  const pickImage = async (files: FileList | null) => {
    const [url] = await uploader.upload(files);
    if (url) setForm((f) => ({ ...f, imageUrl: url }));
  };

  const save = async () => {
    if (!form.room.trim() || !form.category || !form.name.trim()) return toast.error("Add the room, category and item name");
    if (uploader.busy) return toast.error("Wait for the photo to finish uploading");
    const payload = {
      room: form.room, category: form.category, name: form.name, spec: form.spec, supplier: form.supplier,
      quantity: form.quantity === "" ? null : Number(form.quantity), unit: form.unit,
      unitPriceKES: form.price === "" ? null : money.toBase(form.price), imageUrl: form.imageUrl, link: form.link, notes: form.notes,
    };
    setSaving(true);
    try {
      if (editing === "new") {
        const row = await api.createSelection(projectId, payload);
        setItems((xs) => [...xs, row]);
        toast.success("Added as a draft. Send it to the client when ready.");
      } else if (editing) {
        const row = await api.updateSelection(editing.id, payload);
        setItems((xs) => xs.map((x) => (x.id === row.id ? row : x)));
        toast.success(row.status === "draft" && editing.status !== "draft" ? "Saved. It's back in draft, so send it to the client again." : "Saved");
      }
      setEditing(null);
    } catch (e: any) { toast.error(e.message || "Could not save"); }
    finally { setSaving(false); }
  };

  const setStatus = async (s: SelectionDto, status: SelectionStatus, confirm?: string) => {
    if (confirm && !window.confirm(confirm)) return;
    try {
      const row = await api.updateSelection(s.id, { status });
      setItems((xs) => xs.map((x) => (x.id === row.id ? row : x)));
    } catch (e: any) { toast.error(e.message || "Could not update"); }
  };

  const remove = async (s: SelectionDto) => {
    if (!window.confirm(`Delete "${s.name}"?`)) return;
    try { await api.deleteSelection(s.id); setItems((xs) => xs.filter((x) => x.id !== s.id)); }
    catch (e: any) { toast.error(e.message || "Could not delete"); }
  };

  const sendAll = async () => {
    try {
      const r = await api.sendSelections(projectId);
      await load();
      if (portalOn) toast.success(`${r.sent} item${r.sent === 1 ? "" : "s"} sent. The client can approve them in the portal.`);
      else toast.success(`${r.sent} item${r.sent === 1 ? "" : "s"} marked as waiting for the client. Turn on the client portal so they can approve them.`, { duration: 7000 });
    } catch (e: any) { toast.error(e.message || "Could not send"); }
  };

  return (
    <Panel
      title="Finish selections"
      subtitle="Tiles, paint, fittings and fixtures chosen room by room, approved by the client before ordering"
      action={canEdit ? (
        <div className="flex gap-2">
          {drafts > 0 && <button onClick={sendAll} className={btnGhost}><Send className="w-3.5 h-3.5" /> Send {drafts} to client</button>}
          <button onClick={() => openNew()} className={btnPrimary}><Plus className="w-3.5 h-3.5" /> Add item</button>
        </div>
      ) : undefined}
    >
      <div className="p-4">
      {items.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[#8A95A5] mb-4">
          {(Object.keys(SELECTION_STATUS) as SelectionStatus[]).filter((k) => count(k)).map((k) => (
            <span key={k} className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: SELECTION_STATUS[k].color }} />{count(k)} {SELECTION_STATUS[k].label.toLowerCase()}</span>
          ))}
          {allowance > 0 && <span className="ml-auto text-[#C2CAD6]">Total allowance {money.fmt(allowance)}</span>}
        </div>
      )}
      {!portalOn && items.some((s) => s.status === "awaiting_client") && (
        <div className="mb-4 rounded-lg border border-[#3B82F6]/30 bg-[#3B82F6]/5 px-3 py-2 text-[11.5px] text-[#C2CAD6] flex items-center gap-2 flex-wrap">
          The client approves selections in the client portal, which is off for this project.
          {onOpenPortal && <button onClick={onOpenPortal} className="text-[#3B82F6] hover:underline">Turn it on</button>}
        </div>
      )}

      {loading ? (
        <div className="py-10 text-center text-[12px] text-[#5B6675]"><Loader2 className="w-4 h-4 animate-spin inline" /></div>
      ) : items.length === 0 ? (
        <Empty icon={Palette} title="No selections yet" hint="Add the tiles, paint colours, sanitary ware and fittings for each room, with a photo. The client approves them from their phone before you order.">
          {canEdit && <button onClick={() => openNew()} className={btnPrimary}><Plus className="w-3.5 h-3.5" /> Add the first item</button>}
        </Empty>
      ) : (
        <div className="space-y-5">
          {rooms.map(([room, list]) => (
            <div key={room}>
              <div className="flex items-center justify-between mb-2">
                <div className="text-[12px] text-white font-display">{room} <span className="text-[#5B6675]">· {list.length}</span></div>
                {canEdit && <button onClick={() => openNew(room)} className="text-[11px] text-[#FF6B1A] hover:underline flex items-center gap-1"><Plus className="w-3 h-3" />Add to {room}</button>}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2.5">
                {list.map((s) => {
                  const st = SELECTION_STATUS[s.status];
                  return (
                    <div key={s.id} className="rounded-lg border border-[#222A35] bg-[#0A0E14] overflow-hidden flex flex-col">
                      <div className="flex gap-3 p-3">
                        {s.imageUrl
                          ? <a href={absoluteFileUrl(s.imageUrl)} target="_blank" rel="noopener noreferrer" className="shrink-0"><img src={absoluteFileUrl(s.imageUrl)} alt="" className="w-16 h-16 rounded-md object-cover border border-[#222A35]" /></a>
                          : <div className="w-16 h-16 shrink-0 rounded-md border border-dashed border-[#222A35] flex items-center justify-center"><Palette className="w-5 h-5 text-[#3A4350]" /></div>}
                        <div className="min-w-0 flex-1">
                          <div className="text-[10px] uppercase tracking-wider text-[#5B6675]">{s.category}</div>
                          <div className="text-[12.5px] text-white leading-snug">{s.name}</div>
                          {s.spec && <div className="text-[11px] text-[#8A95A5] truncate">{s.spec}</div>}
                          <div className="text-[11px] text-[#8A95A5] mt-0.5">
                            {s.quantity != null && `${s.quantity} ${s.unit || ""}`}{s.quantity != null && s.unitPriceKES != null && " · "}{s.unitPriceKES != null && `${money.fmt(s.unitPriceKES)}${s.unit ? `/${s.unit}` : ""}`}
                          </div>
                        </div>
                      </div>
                      <div className="px-3 pb-2 text-[11px] space-y-1">
                        <span className="px-2 py-0.5 rounded-full text-[10px]" style={{ background: `${st.color}20`, color: st.color }}>{st.label}</span>
                        {s.decidedBy && (s.status === "approved" || s.status === "changes_requested") && <span className="text-[10px] text-[#5B6675] ml-1.5">by {s.decidedBy}</span>}
                        {s.clientComment && <div className="flex gap-1.5 text-[#F59E0B]"><MessageSquare className="w-3 h-3 mt-0.5 shrink-0" />"{s.clientComment}"</div>}
                        {s.supplier && <div className="text-[#5B6675]">Supplier: {s.supplier}</div>}
                      </div>
                      {canEdit && (
                        <div className="mt-auto flex items-center gap-3 px-3 py-2 border-t border-[#222A35] text-[11px] [&_button]:text-[11px] flex-wrap">
                          <button onClick={() => openEdit(s)} className="text-[#8A95A5] hover:text-white flex items-center gap-1"><Pencil className="w-3 h-3" />{s.status === "changes_requested" ? "Revise" : "Edit"}</button>
                          {s.status === "awaiting_client" && <button onClick={() => setStatus(s, "approved", `Record that the client approved "${s.name}" (in person, by phone or on paper)?`)} className="text-[#22C55E] hover:underline flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />Client approved</button>}
                          {s.status === "approved" && <button onClick={() => setStatus(s, "ordered")} className="text-[#A855F7] hover:underline flex items-center gap-1"><Package className="w-3 h-3" />Mark ordered</button>}
                          {s.status === "ordered" && <button onClick={() => setStatus(s, "installed")} className="text-[#14B8A6] hover:underline flex items-center gap-1"><Hammer className="w-3 h-3" />Mark installed</button>}
                          {s.link && <a href={s.link} target="_blank" rel="noopener noreferrer" className="text-[#8A95A5] hover:text-white" title="Product page"><ExternalLink className="w-3 h-3" /></a>}
                          <button onClick={() => remove(s)} className="text-[#8A95A5] hover:text-red-400 ml-auto" title="Delete"><Trash2 className="w-3 h-3" /></button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      </div>
      {editing && (
        <Modal title={editing === "new" ? "Add selection" : `Edit ${editing.name}`} subtitle={editing !== "new" && ["awaiting_client", "approved", "changes_requested"].includes(editing.status) ? "Changing what the client sees puts this item back in draft so they can approve it again." : undefined} onClose={() => setEditing(null)}>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Room *">
                <input list="selection-rooms" value={form.room} onChange={(e) => setForm({ ...form, room: e.target.value })} placeholder="e.g. Master bathroom" className={input} />
                <datalist id="selection-rooms">{[...new Set([...rooms.map(([r]) => r), ...ROOM_SUGGESTIONS])].map((r) => <option key={r} value={r} />)}</datalist>
              </Field>
              <Field label="Category *">
                <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className={input}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
              </Field>
            </div>
            <Field label="Item *"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Porcelain floor tile, matt grey" className={input} /></Field>
            <Field label="Size, colour, code or finish"><input value={form.spec} onChange={(e) => setForm({ ...form, spec: e.target.value })} placeholder="e.g. 60×60 cm, Ash Grey, code PG-6060" className={input} /></Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Quantity"><input placeholder="e.g. 40" type="number" inputMode="decimal" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} className={input} /></Field>
              <Field label="Unit"><select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} className={input}>{[...new Set([form.unit, ...UNITS])].filter(Boolean).map((u) => <option key={u}>{u}</option>)}</select></Field>
              <Field label={money.unit("Price / unit")}><input placeholder="e.g. 2500" type="number" inputMode="decimal" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} className={input} /></Field>
            </div>
            <Field label="Photo">
              <div className="flex items-center gap-3">
                {(uploader.pending[0]?.previewUrl || form.imageUrl) && <img src={uploader.pending[0]?.previewUrl || absoluteFileUrl(form.imageUrl)} alt="" className="w-16 h-16 rounded-md object-cover border border-[#222A35]" />}
                <button type="button" onClick={() => fileRef.current?.click()} className={btnGhost} disabled={uploader.busy}>{uploader.busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImagePlus className="w-3.5 h-3.5" />}{form.imageUrl ? "Change photo" : "Add photo"}</button>
                {form.imageUrl && !uploader.busy && <button type="button" onClick={() => { setForm({ ...form, imageUrl: "" }); uploader.reset(); }} className="text-[11px] text-[#8A95A5] hover:text-red-400">Remove</button>}
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { pickImage(e.target.files); e.target.value = ""; }} />
              </div>
            </Field>
            <Field label="Notes for the client" hint="Shown to the client in the portal."><textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="e.g. Anti-slip finish, suitable for wet areas" className={textarea} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Supplier" hint="Internal only. The client doesn't see it."><input placeholder="e.g. Tile & Carpet Centre" value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} className={input} /></Field>
              <Field label="Product link"><input value={form.link} onChange={(e) => setForm({ ...form, link: e.target.value })} placeholder="https://" className={input} /></Field>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setEditing(null)} className={btnGhost}>Cancel</button>
              <button onClick={save} disabled={saving || uploader.busy} className={btnPrimary}>{saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}Save</button>
            </div>
          </div>
        </Modal>
      )}
    </Panel>
  );
}
