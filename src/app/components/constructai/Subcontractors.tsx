// ============================================================================
// Subcontractor & supplier management.
//
// One place for who they are (the Directory), what they have been engaged for
// (Commitments, across every project) and what they have been paid. The two
// halves already existed as separate modules; this joins them by company name
// and adds "record a payment", which was the step that had no home.
// ============================================================================

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Banknote, Building2, Check, ChevronDown, ChevronRight, Loader2, Mail, Phone, Plus, Search, Truck, Users, Wallet } from "lucide-react";
import api, { type SubcontractorRowDto } from "../../services/api";
import type { Role } from "./roles";
import { ROLES, canManageBids } from "./roles";
import { Empty, Field, Kpi, Modal, Panel, Pill, btnGhost, btnPrimary, fmtDate, input, statusLabel, statusTone, textarea, useMoney } from "./project-hub/shared";

type Data = Awaited<ReturnType<typeof api.getSubcontractors>>;

export default function Subcontractors({ role }: { role: Role }) {
  const { fmt, compact } = useMoney();
  const canPay = ROLES[role].financials && canManageBids(role);
  const canEditContacts = canManageBids(role) || ROLES[role].manageTeam;
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<"all" | "Subcontractor" | "Supplier">("all");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [adding, setAdding] = useState(false);
  const [paying, setPaying] = useState<{ row: SubcontractorRowDto } | null>(null);

  const load = async () => {
    setLoading(true);
    try { setData(await api.getSubcontractors()); }
    catch (e: any) { toast.error(e?.message || "Could not load subcontractors"); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const rows = useMemo(() => {
    if (!data) return [];
    const all = [...data.subcontractors, ...data.unlinked];
    const n = q.trim().toLowerCase();
    return all.filter((r) => {
      if (cat !== "all" && r.contact && r.contact.category !== cat) return false;
      if (cat === "Supplier" && !r.contact) return false;
      if (!n) return true;
      const hay = `${r.contact?.name || ""} ${r.contact?.company || ""} ${r.vendor || ""} ${r.contact?.role || ""} ${r.commitments.map((c) => `${c.scope} ${c.projectName}`).join(" ")}`.toLowerCase();
      return hay.includes(n);
    });
  }, [data, q, cat]);

  const totals = useMemo(() => {
    const all = data ? [...data.subcontractors, ...data.unlinked] : [];
    return all.reduce((t, r) => ({
      contacts: t.contacts + (r.contact ? 1 : 0),
      subs: t.subs + r.commitments.length,
      contractValue: t.contractValue + r.totals.contractValue,
      paidToDate: t.paidToDate + r.totals.paidToDate,
      balance: t.balance + r.totals.balanceRemaining,
      retention: t.retention + r.totals.retentionHeld,
    }), { contacts: 0, subs: 0, contractValue: 0, paidToDate: 0, balance: 0, retention: 0 });
  }, [data]);

  const keyOf = (r: SubcontractorRowDto) => r.contact?.id || `vendor:${r.vendor}`;

  return (
    <div className="px-4 sm:px-7 py-5 sm:py-6 space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Subcontractors & suppliers" value={String(totals.contacts)} sub={`${totals.subs} subcontract${totals.subs === 1 ? "" : "s"} / order${totals.subs === 1 ? "" : "s"}`} />
        {canPay && <Kpi label="Committed" value={compact(totals.contractValue)} sub="all subcontracts incl. approved variations" />}
        {canPay && <Kpi label="Paid to date" value={compact(totals.paidToDate)} tone="good" sub={`${compact(totals.retention)} retention held`} />}
        {canPay && <Kpi label="Balance to pay" value={compact(totals.balance)} tone={totals.balance > 0 ? "warn" : undefined} sub="committed less paid" />}
      </div>

      <Panel
        title="Subcontractor & supplier database"
        subtitle="Who they are, what they are engaged for on each project, and what they have been paid"
        action={<>
          <div className="flex rounded-md border border-[#222A35] overflow-hidden text-[11px]">
            {(["all", "Subcontractor", "Supplier"] as const).map((c) => <button key={c} onClick={() => setCat(c)} className={`px-2.5 h-8 ${cat === c ? "bg-[#FF6B1A] text-white" : "text-[#8A95A5] hover:text-white"}`}>{c === "all" ? "All" : `${c}s`}</button>)}
          </div>
          {canEditContacts && <button onClick={() => setAdding(true)} className={btnPrimary}><Plus className="w-3.5 h-3.5" /> Add</button>}
        </>}
      >
        <div className="flex items-center gap-2 px-4 py-2 border-b border-[#222A35]">
          <Search className="w-3.5 h-3.5 text-[#5B6675]" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, company, trade or project" className={`${input} border-0 bg-transparent h-8 px-0`} />
        </div>
        {loading ? (
          <div className="py-16 flex justify-center text-[#8A95A5]"><Loader2 className="w-4 h-4 animate-spin" /></div>
        ) : rows.length === 0 ? (
          <Empty icon={Users} title={q ? "Nothing matches" : "No subcontractors or suppliers yet"} hint="Add the companies you engage. Subcontracts awarded through Bidding or created in Commitments attach to them automatically by company name.">
            {canEditContacts && !q && <button onClick={() => setAdding(true)} className={btnPrimary}><Plus className="w-3.5 h-3.5" /> Add the first one</button>}
          </Empty>
        ) : (
          <div className="divide-y divide-[#222A35]">
            {rows.map((r) => {
              const k = keyOf(r);
              const expanded = !!open[k];
              const name = r.contact?.company || r.contact?.name || r.vendor || "—";
              const isSupplier = r.contact?.category === "Supplier";
              return (
                <div key={k}>
                  <div className="px-4 py-3 flex items-center gap-3">
                    <button onClick={() => setOpen((o) => ({ ...o, [k]: !o[k] }))} className="text-[#8A95A5] hover:text-white shrink-0">{expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}</button>
                    <div className="w-9 h-9 rounded-md bg-[#FF6B1A]/10 border border-[#FF6B1A]/20 flex items-center justify-center shrink-0">{isSupplier ? <Truck className="w-4 h-4 text-[#FF6B1A]" /> : <Building2 className="w-4 h-4 text-[#FF6B1A]" />}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <button onClick={() => setOpen((o) => ({ ...o, [k]: !o[k] }))} className="text-[12.5px] text-white hover:underline text-left truncate">{name}</button>
                        {r.contact ? <Pill tone={isSupplier ? "info" : "brand"}>{r.contact.category}</Pill> : <Pill tone="warn">Not in directory</Pill>}
                        {r.contact?.role && <span className="text-[11px] text-[#8A95A5]">{r.contact.role}</span>}
                      </div>
                      <div className="text-[10.5px] text-[#5B6675] mt-0.5 flex items-center gap-3 flex-wrap">
                        {r.contact?.name && r.contact.company && <span>{r.contact.name}</span>}
                        {r.contact?.phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{r.contact.phone}</span>}
                        {r.contact?.email && <span className="flex items-center gap-1"><Mail className="w-3 h-3" />{r.contact.email}</span>}
                        <span>{r.commitments.length} subcontract{r.commitments.length === 1 ? "" : "s"}{r.commitments.length ? ` · ${Array.from(new Set(r.commitments.map((c) => c.projectName))).join(", ")}` : ""}</span>
                      </div>
                    </div>
                    {canPay && (
                      <div className="hidden sm:grid grid-cols-3 gap-4 text-right shrink-0">
                        <div><div className="text-[10px] text-[#5B6675] uppercase">Committed</div><div className="text-[12px] text-white tabular-nums">{r.totals.contractValue ? compact(r.totals.contractValue) : "—"}</div></div>
                        <div><div className="text-[10px] text-[#5B6675] uppercase">Paid</div><div className="text-[12px] text-[#22C55E] tabular-nums">{r.totals.paidToDate ? compact(r.totals.paidToDate) : "—"}</div></div>
                        <div><div className="text-[10px] text-[#5B6675] uppercase">Balance</div><div className={`text-[12px] tabular-nums ${r.totals.balanceRemaining > 0 ? "text-[#F5A623]" : "text-[#8A95A5]"}`}>{r.totals.contractValue ? compact(r.totals.balanceRemaining) : "—"}</div></div>
                      </div>
                    )}
                    {canPay && r.commitments.length > 0 && <button onClick={() => setPaying({ row: r })} className={`${btnGhost} h-8 px-2.5`}><Banknote className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Record payment</span></button>}
                  </div>
                  {expanded && (
                    <div className="px-4 pb-4 pl-[4.5rem]">
                      {r.commitments.length === 0 ? (
                        <div className="rounded-lg border border-dashed border-[#222A35] px-3 py-3 text-[11.5px] text-[#5B6675]">No subcontracts or orders yet. Award a tender in Bidding, or add a commitment on a project, and it appears here.</div>
                      ) : (
                        <div className="space-y-2">
                          {r.commitments.map((c) => {
                            const value = (Number(c.contractValue) || 0) + (Number(c.approvedVariations) || 0);
                            const paid = Number(c.paidToDate) || 0;
                            const pct = value > 0 ? Math.min(100, Math.round((paid / value) * 100)) : 0;
                            return (
                              <div key={c.id} className="rounded-lg border border-[#222A35] bg-[#0A0E14] p-3">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-[12px] text-white">{c.scope}</span>
                                  <Pill tone={statusTone(c.status)}>{statusLabel(c.status)}</Pill>
                                  <span className="text-[11px] text-[#8A95A5]">· {c.projectName}</span>
                                  {c.due && <span className="text-[11px] text-[#5B6675]">· due {c.due}</span>}
                                </div>
                                {canPay && (
                                  <>
                                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2 text-[11px]">
                                      <div><span className="text-[#5B6675]">Value</span> <span className="text-white tabular-nums">{fmt(value)}</span></div>
                                      <div><span className="text-[#5B6675]">Paid</span> <span className="text-[#22C55E] tabular-nums">{fmt(paid)}</span></div>
                                      <div><span className="text-[#5B6675]">Retention</span> <span className="text-[#F5A623] tabular-nums">{fmt(c.retentionHeld || 0)}</span></div>
                                      <div><span className="text-[#5B6675]">Balance</span> <span className="text-white tabular-nums">{fmt(Number(c.balanceRemaining) || value - paid)}</span></div>
                                    </div>
                                    <div className="mt-2 h-1.5 rounded-full bg-[#222A35] overflow-hidden"><div className="h-full bg-[#22C55E]" style={{ width: `${pct}%` }} /></div>
                                    {c.payments.length > 0 && (
                                      <div className="mt-2 border-t border-[#222A35] pt-2">
                                        <div className="text-[10px] uppercase tracking-wider text-[#5B6675] mb-1">Payment history</div>
                                        <div className="space-y-1">
                                          {c.payments.map((p) => (
                                            <div key={p.id} className="flex items-center gap-2 text-[11px]">
                                              <span className="font-mono text-[#8A95A5] w-20 truncate">{p.number}</span>
                                              <span className="text-[#5B6675] flex-1 truncate">{p.period || fmtDate(p.createdAt)}{p.comments ? ` · ${p.comments}` : ""}</span>
                                              <Pill tone={statusTone(p.status)}>{statusLabel(p.status)}</Pill>
                                              <span className="text-white tabular-nums w-24 text-right">{fmt(p.netPayable ?? p.requestedAmount)}</span>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                  </>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      {adding && <ContactForm onClose={() => setAdding(false)} onDone={async () => { setAdding(false); await load(); }} />}
      {paying && <PaymentForm row={paying.row} onClose={() => setPaying(null)} onDone={async () => { setPaying(null); await load(); }} />}
    </div>
  );
}

function ContactForm({ onClose, onDone }: { onClose: () => void; onDone: () => Promise<void> }) {
  const [f, setF] = useState({ company: "", name: "", role: "", category: "Subcontractor", phone: "", email: "" });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = async () => {
    if (!f.company.trim() && !f.name.trim()) return toast.error("Enter the company or contact name");
    setBusy(true);
    try { await api.createDirectoryContact({ ...f, name: f.name.trim() || f.company.trim(), company: f.company.trim() || null, projects: [] }); toast.success("Added to the directory"); await onDone(); }
    catch (e: any) { toast.error(e?.message || "Could not save"); }
    finally { setBusy(false); }
  };
  return (
    <Modal title="Add a subcontractor or supplier" subtitle="Subcontracts whose vendor matches the company name attach automatically." onClose={onClose}>
      <div className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Company"><input autoFocus value={f.company} onChange={set("company")} placeholder="Mwangi Electricals Ltd" className={input} /></Field>
          <Field label="Type"><select value={f.category} onChange={set("category")} className={input}><option>Subcontractor</option><option>Supplier</option></select></Field>
          <Field label="Contact person"><input value={f.name} onChange={set("name")} className={input} /></Field>
          <Field label="Trade / what they supply"><input value={f.role} onChange={set("role")} placeholder="Electrical · Plumbing · Cement supplier" className={input} /></Field>
          <Field label="Phone"><input value={f.phone} onChange={set("phone")} className={input} /></Field>
          <Field label="Email"><input value={f.email} onChange={set("email")} className={input} /></Field>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className={btnGhost}>Cancel</button>
          <button onClick={save} disabled={busy} className={btnPrimary}>{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Add</button>
        </div>
      </div>
    </Modal>
  );
}

function PaymentForm({ row, onClose, onDone }: { row: SubcontractorRowDto; onClose: () => void; onDone: () => Promise<void> }) {
  const { fmt } = useMoney();
  const [f, setF] = useState({ commitmentId: row.commitments[0]?.id || "", amount: "", date: new Date().toISOString().slice(0, 10), reference: "", note: "" });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const chosen = row.commitments.find((c) => c.id === f.commitmentId);
  const balance = chosen ? (Number(chosen.contractValue) || 0) + (Number(chosen.approvedVariations) || 0) - (Number(chosen.paidToDate) || 0) : 0;
  const save = async () => {
    if (!f.commitmentId) return toast.error("Pick the subcontract");
    if (!(Number(f.amount) > 0)) return toast.error("Enter the amount paid");
    setBusy(true);
    try { await api.recordSubcontractorPayment({ commitmentId: f.commitmentId, amount: Number(f.amount), date: f.date, reference: f.reference || undefined, note: f.note || undefined }); toast.success("Payment recorded"); await onDone(); }
    catch (e: any) { toast.error(e?.message || "Could not record the payment"); }
    finally { setBusy(false); }
  };
  return (
    <Modal title={`Record a payment to ${row.contact?.company || row.contact?.name || row.vendor}`} subtitle="Money actually paid. Certified-but-unpaid claims belong in Commitments." onClose={onClose}>
      <div className="space-y-3">
        <Field label="Against subcontract / order">
          <select value={f.commitmentId} onChange={set("commitmentId")} className={input}>
            {row.commitments.map((c) => <option key={c.id} value={c.id}>{c.scope} · {c.projectName}</option>)}
          </select>
        </Field>
        {chosen && <div className="text-[11.5px] text-[#8A95A5] flex items-center gap-1.5"><Wallet className="w-3.5 h-3.5" /> Balance before this payment: <span className="text-white">{fmt(balance)}</span></div>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount paid (KES)"><input autoFocus type="number" min={0} value={f.amount} onChange={set("amount")} className={input} /></Field>
          <Field label="Date"><input type="date" value={f.date} onChange={set("date")} className={input} /></Field>
        </div>
        <Field label="Reference"><input value={f.reference} onChange={set("reference")} placeholder="Cheque no., M-Pesa code, transfer ref" className={input} /></Field>
        <Field label="Note"><textarea value={f.note} onChange={set("note")} placeholder="e.g. Part payment against Certificate 3" className={textarea} /></Field>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className={btnGhost}>Cancel</button>
          <button onClick={save} disabled={busy} className={btnPrimary}>{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Banknote className="w-3.5 h-3.5" />} Record payment</button>
        </div>
      </div>
    </Modal>
  );
}
