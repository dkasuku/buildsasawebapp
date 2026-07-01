// ============================================================================
// Inventory — broader stock module replacing the old Equipment page.
// Two tabs: Materials (new, with a stock-movement ledger) and Equipment
// (reuses the existing Equipment component unmodified).
// ============================================================================

import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Plus, X, Trash2, Boxes, Package, ArrowDownToLine, ArrowUpFromLine, Pencil } from "lucide-react";
import type { Role } from "./roles";
import { ROLES } from "./roles";
import api, { type InventoryItemDto, type InventoryMovementDto, type ProjectDto } from "../../services/api";
import { EmptyState } from "./EmptyState";
import { formatCurrency } from "./currency";
import { useCurrency } from "./CurrencyContext";
import Equipment from "./Equipment";

const COMPANY_WIDE = "__company__";
const ALL = "__all__";

const MOVEMENT_TYPES: { value: string; label: string }[] = [
  { value: "in", label: "Received (in)" },
  { value: "out", label: "Issued (out)" },
  { value: "adjust", label: "Adjust" },
];

const UNITS = ["bags", "tonnes", "m", "m2", "m3", "kg", "pcs", "rolls", "litres", "boxes"];

export default function Inventory({ role = "Contractor" }: { role?: Role }) {
  const perms = ROLES[role];
  // Gate manage actions behind the same flag used for assigning tasks / managing site.
  const canManage = perms.assignTasks;
  const [tab, setTab] = useState<"materials" | "equipment">("materials");

  return (
    <div className="px-4 sm:px-7 py-5 sm:py-6 space-y-5">
      {/* Tab bar */}
      <div className="flex flex-nowrap items-center gap-1 border-b border-[#222A35] overflow-x-auto whitespace-nowrap">
        <TabButton active={tab === "materials"} onClick={() => setTab("materials")} icon={Boxes} label="Materials" />
        <TabButton active={tab === "equipment"} onClick={() => setTab("equipment")} icon={Package} label="Equipment" />
      </div>

      {tab === "materials" ? (
        <Materials canManage={canManage} role={role} />
      ) : (
        // Reuse the existing Equipment component, unmodified.
        <div className="-mx-4 sm:-mx-7 -my-5 sm:-my-6">
          <Equipment role={role} />
        </div>
      )}
    </div>
  );
}

function TabButton({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: any; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3.5 h-9 text-[13px] border-b-2 -mb-px transition-colors ${
        active ? "border-[#FF6B1A] text-white" : "border-transparent text-[#8A95A5] hover:text-white"
      }`}
    >
      <Icon className="w-4 h-4" /> {label}
    </button>
  );
}

// ----------------------------------------------------------------------------
// Materials tab
// ----------------------------------------------------------------------------

function Materials({ canManage, role }: { canManage: boolean; role: Role }) {
  const { currency } = useCurrency();
  const fmt = (v: number) => formatCurrency(v, currency);

  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [projectFilter, setProjectFilter] = useState<string>(ALL);
  const [items, setItems] = useState<InventoryItemDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [editItem, setEditItem] = useState<InventoryItemDto | null>(null);

  const projectName = (id?: string | null) => (id ? projects.find((p) => p.id === id)?.name ?? "Project" : "Company-wide");

  useEffect(() => {
    api.getProjects().then(setProjects).catch(() => {});
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const params = projectFilter !== ALL && projectFilter !== COMPANY_WIDE ? { projectId: projectFilter } : undefined;
      let rows = await api.getInventory(params);
      if (projectFilter === COMPANY_WIDE) rows = rows.filter((r) => !r.projectId);
      setItems(rows);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectFilter]);

  const stockValue = (it: InventoryItemDto) => (it.unitCostKES != null ? it.currentStock * Number(it.unitCostKES) : null);

  return (
    <div className="space-y-5">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[13px] text-white font-display">
            <Boxes className="w-4 h-4 text-[#FF6B1A]" /> Materials
          </div>
          <div className="text-[11px] text-[#8A95A5] mt-0.5">Track cement, steel, aggregates and other site materials with a stock-movement ledger</div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
            className="h-9 bg-[#11161D] border border-[#222A35] rounded-md px-2 text-white text-[12px]"
          >
            <option value={ALL}>All</option>
            <option value={COMPANY_WIDE}>Company-wide (unassigned)</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          {canManage && (
            <button onClick={() => setShowNew(true)} className="h-9 px-3 rounded-md text-[12px] flex items-center gap-1.5 bg-[#FF6B1A] hover:bg-[#FF7E33] text-white">
              <Plus className="w-3.5 h-3.5" /> Add item
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="rounded-xl border border-[#222A35] bg-[#11161D] p-8 text-center text-[12px] text-[#8A95A5]">Loading…</div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-[#222A35] bg-[#11161D]">
          <EmptyState
            icon={Boxes}
            title="No materials yet"
            description="Add cement, steel, aggregates and other site materials to track stock."
            actionLabel={canManage ? "Add item" : undefined}
            onAction={canManage ? () => setShowNew(true) : undefined}
          />
        </div>
      ) : (
        <>
          {/* Table — tablet/desktop */}
          <div className="hidden sm:block rounded-xl border border-[#222A35] bg-[#11161D] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[800px] text-[12px]">
                <thead>
                  <tr className="text-[10px] text-[#5B6675] uppercase tracking-wider">
                    <th className="text-left px-4 py-2.5">Item</th>
                    <th className="text-left px-3 py-2.5">Category</th>
                    <th className="text-left px-3 py-2.5">Project</th>
                    <th className="text-left px-3 py-2.5">Unit</th>
                    <th className="text-right px-3 py-2.5">In stock</th>
                    <th className="text-right px-3 py-2.5">Reorder level</th>
                    <th className="text-right px-3 py-2.5">Stock value</th>
                    <th className="text-left px-4 py-2.5">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => {
                    const sv = stockValue(it);
                    return (
                    <tr key={it.id} onClick={() => setActiveId(it.id)} className="border-t border-[#222A35] hover:bg-[#161C24] cursor-pointer">
                      <td className="px-4 py-2.5 text-white font-medium">
                        {it.name}
                        {it.sku && <span className="ml-1.5 text-[10px] text-[#5B6675]">{it.sku}</span>}
                      </td>
                      <td className="px-3 py-2.5">
                        {it.category ? <span className="px-1.5 py-0.5 rounded text-[10px] bg-[#222A35] text-[#8A95A5]">{it.category}</span> : <span className="text-[#5B6675]">—</span>}
                      </td>
                      <td className="px-3 py-2.5 text-[#8A95A5]">{projectName(it.projectId)}</td>
                      <td className="px-3 py-2.5 text-[#8A95A5]">{it.unit}</td>
                      <td className="px-3 py-2.5 text-right text-white">{it.currentStock}</td>
                      <td className="px-3 py-2.5 text-right text-[#8A95A5]">{it.reorderLevel ?? "—"}</td>
                      <td className="px-3 py-2.5 text-right text-[#8A95A5]">{sv != null ? fmt(sv) : "—"}</td>
                      <td className="px-4 py-2.5"><StockBadge item={it} /></td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Cards — phones */}
          <div className="sm:hidden space-y-2">
            {items.map((it) => {
              const sv = stockValue(it);
              return (
              <div key={it.id} onClick={() => setActiveId(it.id)} className="rounded-xl border border-[#222A35] bg-[#11161D] p-3 cursor-pointer">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] text-white font-medium truncate">
                    {it.name}
                    {it.sku && <span className="ml-1.5 text-[10px] text-[#5B6675]">{it.sku}</span>}
                  </span>
                  <StockBadge item={it} />
                </div>
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  {it.category && <span className="px-1.5 py-0.5 rounded text-[10px] bg-[#222A35] text-[#8A95A5]">{it.category}</span>}
                  <span className="text-[11px] text-[#8A95A5]">{projectName(it.projectId)}</span>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-[11px] text-[#8A95A5]">
                  <span>In stock: <span className="text-white">{it.currentStock}</span> {it.unit}</span>
                  <span>Reorder: {it.reorderLevel ?? "—"}</span>
                  {sv != null && <span>Value: {fmt(sv)}</span>}
                </div>
              </div>
              );
            })}
          </div>
        </>
      )}

      {showNew && (
        <ItemModal
          projects={projects}
          onClose={() => setShowNew(false)}
          onSaved={() => { setShowNew(false); load(); }}
        />
      )}

      {editItem && (
        <ItemModal
          projects={projects}
          item={editItem}
          onClose={() => setEditItem(null)}
          onSaved={() => { setEditItem(null); load(); }}
        />
      )}

      {activeId && (
        <ItemDrawer
          itemId={activeId}
          canManage={canManage}
          role={role}
          fmt={fmt}
          projectName={projectName}
          onClose={() => setActiveId(null)}
          onEdit={(it) => { setActiveId(null); setEditItem(it); }}
          onChanged={load}
          onDeleted={() => { setActiveId(null); load(); }}
        />
      )}
    </div>
  );
}

// Stock health for an item. Critical (min) takes precedence over Low (reorder);
// Overstocked is informational only and shown when not critical/low.
function stockStatus(it: InventoryItemDto): "critical" | "low" | "over" | "ok" {
  const min = it.minLevel ?? 0;
  const reorder = it.reorderLevel ?? 0;
  const max = it.maxLevel ?? 0;
  if (min > 0 && it.currentStock <= min) return "critical";
  if (reorder > 0 && it.currentStock <= reorder) return "low";
  if (max > 0 && it.currentStock >= max) return "over";
  return "ok";
}

function StockBadge({ item }: { item: InventoryItemDto }) {
  const s = stockStatus(item);
  if (s === "critical") return <span className="px-2 py-0.5 rounded-full text-[10px]" style={{ background: "#EF444420", color: "#EF4444" }}>Critical</span>;
  if (s === "low") return <span className="px-2 py-0.5 rounded-full text-[10px]" style={{ background: "#F5A62320", color: "#F5A623" }}>Low stock</span>;
  if (s === "over") return <span className="px-2 py-0.5 rounded-full text-[10px]" style={{ background: "#222A35", color: "#8A95A5" }}>Overstocked</span>;
  return <span className="px-2 py-0.5 rounded-full text-[10px]" style={{ background: "#22C55E20", color: "#22C55E" }}>In stock</span>;
}

// ----------------------------------------------------------------------------
// Add item modal
// ----------------------------------------------------------------------------

function ItemModal({ projects, item, onClose, onSaved }: { projects: ProjectDto[]; item?: InventoryItemDto | null; onClose: () => void; onSaved: () => void }) {
  const editing = !!item;
  const [form, setForm] = useState({
    name: item?.name ?? "",
    sku: item?.sku ?? "",
    category: item?.category ?? "",
    unit: item?.unit ?? "bags",
    projectId: item?.projectId ?? COMPANY_WIDE,
    location: item?.location ?? "",
    currentStock: item ? String(item.currentStock) : "",
    minLevel: item?.minLevel != null ? String(item.minLevel) : "",
    reorderLevel: item?.reorderLevel != null ? String(item.reorderLevel) : "",
    maxLevel: item?.maxLevel != null ? String(item.maxLevel) : "",
    reorderQty: item?.reorderQty != null ? String(item.reorderQty) : "",
    supplier: item?.supplier ?? "",
    supplierContact: item?.supplierContact ?? "",
    leadTimeDays: item?.leadTimeDays != null ? String(item.leadTimeDays) : "",
    unitCostKES: item?.unitCostKES != null ? String(item.unitCostKES) : "",
    notes: item?.notes ?? "",
  });
  const [saving, setSaving] = useState(false);

  // Empty -> undefined so we never send "" for a numeric field.
  const num = (v: string) => (v.trim() === "" ? undefined : Number(v));

  const save = async () => {
    if (!form.name.trim()) return toast.error("Item name required");
    if (!form.unit.trim()) return toast.error("Unit required");
    setSaving(true);
    try {
      const base = {
        name: form.name.trim(),
        sku: form.sku.trim() || undefined,
        category: form.category.trim() || undefined,
        unit: form.unit.trim(),
        projectId: form.projectId === COMPANY_WIDE ? undefined : form.projectId,
        location: form.location.trim() || undefined,
        minLevel: num(form.minLevel),
        reorderLevel: num(form.reorderLevel),
        maxLevel: num(form.maxLevel),
        reorderQty: num(form.reorderQty),
        supplier: form.supplier.trim() || undefined,
        supplierContact: form.supplierContact.trim() || undefined,
        leadTimeDays: num(form.leadTimeDays),
        unitCostKES: num(form.unitCostKES),
        notes: form.notes.trim() || undefined,
      };
      if (editing && item) {
        // currentStock omitted on update — it only changes via movements.
        await api.updateInventoryItem(item.id, base);
        toast.success("Item updated");
      } else {
        await api.createInventoryItem({ ...base, currentStock: num(form.currentStock) ?? 0 });
        toast.success("Item added");
      }
      onSaved();
    } catch {
      toast.error(editing ? "Couldn't update item" : "Couldn't add item");
    } finally {
      setSaving(false);
    }
  };

  const inputCls = "w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-3 text-white placeholder:text-[#5B6675] focus:outline-none focus:border-[#FF6B1A]";

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-[#11161D] border border-[#222A35] rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div className="text-[14px] text-white font-display">{editing ? "Edit material" : "Add material"}</div>
          <button onClick={onClose} className="text-[#8A95A5] hover:text-white"><X className="w-4 h-4" /></button>
        </div>
        <div className="space-y-5 text-[12px]">
          {/* Item */}
          <Section title="Item">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Labeled label="Name">
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} />
              </Labeled>
              <Labeled label="SKU / code">
                <input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} placeholder="e.g. CEM-42.5" className={inputCls} />
              </Labeled>
              <Labeled label="Category">
                <input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="e.g. Cement" className={inputCls} />
              </Labeled>
              <Labeled label="Unit">
                <select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-white">
                  {UNITS.map((u) => <option key={u}>{u}</option>)}
                </select>
              </Labeled>
              <Labeled label="Project">
                <select value={form.projectId} onChange={(e) => setForm({ ...form, projectId: e.target.value })} className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-white">
                  <option value={COMPANY_WIDE}>Company-wide</option>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </Labeled>
              <Labeled label="Location">
                <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="e.g. Site store A" className={inputCls} />
              </Labeled>
            </div>
          </Section>

          {/* Stock levels */}
          <Section title="Stock levels">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {!editing && (
                <Labeled label="Opening stock">
                  <input type="number" value={form.currentStock} onChange={(e) => setForm({ ...form, currentStock: e.target.value })} className={inputCls} />
                </Labeled>
              )}
              <Labeled label="Min level (critical)">
                <input type="number" value={form.minLevel} onChange={(e) => setForm({ ...form, minLevel: e.target.value })} className={inputCls} />
              </Labeled>
              <Labeled label="Reorder level">
                <input type="number" value={form.reorderLevel} onChange={(e) => setForm({ ...form, reorderLevel: e.target.value })} className={inputCls} />
              </Labeled>
              <Labeled label="Max level">
                <input type="number" value={form.maxLevel} onChange={(e) => setForm({ ...form, maxLevel: e.target.value })} className={inputCls} />
              </Labeled>
              <Labeled label="Reorder qty">
                <input type="number" value={form.reorderQty} onChange={(e) => setForm({ ...form, reorderQty: e.target.value })} className={inputCls} />
              </Labeled>
            </div>
          </Section>

          {/* Supplier */}
          <Section title="Supplier">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Labeled label="Supplier">
                <input value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} className={inputCls} />
              </Labeled>
              <Labeled label="Supplier contact">
                <input value={form.supplierContact} onChange={(e) => setForm({ ...form, supplierContact: e.target.value })} placeholder="phone / email" className={inputCls} />
              </Labeled>
              <Labeled label="Lead time (days)">
                <input type="number" value={form.leadTimeDays} onChange={(e) => setForm({ ...form, leadTimeDays: e.target.value })} className={inputCls} />
              </Labeled>
            </div>
          </Section>

          {/* Cost */}
          <Section title="Cost">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Labeled label="Unit cost (KES)">
                <input type="number" value={form.unitCostKES} onChange={(e) => setForm({ ...form, unitCostKES: e.target.value })} className={inputCls} />
              </Labeled>
            </div>
          </Section>

          {/* Notes */}
          <Section title="Notes">
            <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} placeholder="Optional notes" className="w-full bg-[#0A0E14] border border-[#222A35] rounded-md px-3 py-2 text-white placeholder:text-[#5B6675] focus:outline-none focus:border-[#FF6B1A]" />
          </Section>
        </div>
        <div className="flex items-center justify-end gap-2 mt-5 pt-4 border-t border-[#222A35]">
          <button onClick={onClose} className="h-9 px-3 rounded-md border border-[#222A35] text-[12px] text-[#8A95A5] hover:text-white">Cancel</button>
          <button disabled={saving} onClick={save} className="h-9 px-4 rounded-md bg-[#FF6B1A] hover:bg-[#FF7E33] text-white text-[12px] flex items-center gap-1.5 disabled:opacity-60"><Plus className="w-3.5 h-3.5" />{editing ? "Save" : "Add"}</button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-[11px] text-white font-display mb-2">{title}</div>
      {children}
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-[10px] text-[#8A95A5] uppercase tracking-wider mb-1">{label}</div>
      {children}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Item detail drawer — summary, record-movement form, movement ledger.
// ----------------------------------------------------------------------------

function ItemDrawer({
  itemId,
  canManage,
  fmt,
  projectName,
  onClose,
  onEdit,
  onChanged,
  onDeleted,
}: {
  itemId: string;
  canManage: boolean;
  role: Role;
  fmt: (v: number) => string;
  projectName: (id?: string | null) => string;
  onClose: () => void;
  onEdit: (item: InventoryItemDto) => void;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [item, setItem] = useState<InventoryItemDto | null>(null);
  const [movements, setMovements] = useState<InventoryMovementDto[]>([]);
  const [mvType, setMvType] = useState("in");
  const [mvQty, setMvQty] = useState("");
  const [mvRef, setMvRef] = useState("");
  const [mvNotes, setMvNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const it = await api.getInventoryItem(itemId);
      setItem(it);
      try {
        const mv = it.movements ?? (await api.getInventoryMovements(itemId));
        setMovements([...mv].sort((a, b) => (a.date < b.date ? 1 : -1)));
      } catch {
        setMovements([]);
      }
    } catch {
      setItem(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId]);

  const recordMovement = async () => {
    const qty = Number(mvQty);
    if (!qty || qty <= 0) return toast.error("Enter a quantity greater than 0");
    setSaving(true);
    try {
      await api.addInventoryMovement(itemId, { type: mvType, quantity: qty, reference: mvRef.trim() || undefined, notes: mvNotes.trim() || undefined });
      setMvQty(""); setMvRef(""); setMvNotes("");
      toast.success("Movement recorded");
      await load();
      onChanged();
    } catch {
      toast.error("Couldn't record movement");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    try {
      await api.deleteInventoryItem(itemId);
      toast.success("Item deleted");
      onDeleted();
    } catch {
      toast.error("Couldn't delete item");
    }
  };

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="absolute right-0 top-0 h-full w-full max-w-md bg-[#11161D] border-l border-[#222A35] overflow-y-auto">
        <div className="sticky top-0 bg-[#11161D] px-5 py-4 border-b border-[#222A35] flex items-center justify-between z-10">
          <div>
            <div className="text-[13px] text-white font-display">{item?.name || "Material"}</div>
            <div className="text-[11px] text-[#8A95A5]">{item ? projectName(item.projectId) : "Material detail"}</div>
          </div>
          <button onClick={onClose} className="text-[#8A95A5] hover:text-white"><X className="w-4 h-4" /></button>
        </div>

        {loading ? (
          <div className="p-5 text-[12px] text-[#8A95A5]">Loading…</div>
        ) : !item ? (
          <div className="p-5 text-[12px] text-[#8A95A5]">Couldn't load this item.</div>
        ) : (
          <div className="p-5 space-y-5">
            {/* Summary */}
            <div className="grid grid-cols-2 gap-3 text-[12px]">
              <Field label="In stock" value={`${item.currentStock} ${item.unit}`} />
              <Field label="SKU / code" value={item.sku || "—"} />
              <Field label="Min level" value={item.minLevel != null ? String(item.minLevel) : "—"} />
              <Field label="Reorder level" value={item.reorderLevel != null ? String(item.reorderLevel) : "—"} />
              <Field label="Max level" value={item.maxLevel != null ? String(item.maxLevel) : "—"} />
              <Field label="Reorder qty" value={item.reorderQty != null ? String(item.reorderQty) : "—"} />
              <Field label="Unit cost" value={item.unitCostKES != null ? fmt(Number(item.unitCostKES)) : "—"} />
              <Field label="Stock value" value={item.unitCostKES != null ? fmt(item.currentStock * Number(item.unitCostKES)) : "—"} />
              <Field label="Supplier" value={item.supplier || "—"} />
              <Field label="Supplier contact" value={item.supplierContact || "—"} />
              <Field label="Lead time" value={item.leadTimeDays != null ? `${item.leadTimeDays} days` : "—"} />
              <Field label="Location" value={item.location || "—"} />
              <Field label="Category" value={item.category || "—"} />
              <Field label="Status" value={item.status || "active"} />
            </div>

            {/* Record movement */}
            {canManage && (
              <div className="rounded-lg border border-[#222A35] bg-[#0A0E14] p-3 space-y-3">
                <div className="text-[12px] text-white font-display">Record movement</div>
                <div className="grid grid-cols-2 gap-3 text-[12px]">
                  <Labeled label="Type">
                    <select value={mvType} onChange={(e) => setMvType(e.target.value)} className="w-full h-9 bg-[#11161D] border border-[#222A35] rounded-md px-2 text-white">
                      {MOVEMENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </Labeled>
                  <Labeled label="Quantity">
                    <input type="number" value={mvQty} onChange={(e) => setMvQty(e.target.value)} className="w-full h-9 bg-[#11161D] border border-[#222A35] rounded-md px-3 text-white focus:outline-none focus:border-[#FF6B1A]" />
                  </Labeled>
                </div>
                <Labeled label="Reference">
                  <input value={mvRef} onChange={(e) => setMvRef(e.target.value)} placeholder="e.g. GRN-104 / Delivery note" className="w-full h-9 bg-[#11161D] border border-[#222A35] rounded-md px-3 text-white placeholder:text-[#5B6675] focus:outline-none focus:border-[#FF6B1A]" />
                </Labeled>
                <Labeled label="Notes">
                  <textarea value={mvNotes} onChange={(e) => setMvNotes(e.target.value)} rows={2} className="w-full bg-[#11161D] border border-[#222A35] rounded-md px-3 py-2 text-white focus:outline-none focus:border-[#FF6B1A]" />
                </Labeled>
                <button disabled={saving} onClick={recordMovement} className="h-9 px-4 rounded-md bg-[#FF6B1A] hover:bg-[#FF7E33] text-white text-[12px] flex items-center gap-1.5 disabled:opacity-60">
                  <Plus className="w-3.5 h-3.5" /> Record
                </button>
              </div>
            )}

            {/* Movement ledger */}
            <div>
              <div className="text-[12px] text-white font-display mb-2">Movement ledger</div>
              {movements.length === 0 ? (
                <div className="text-[12px] text-[#5B6675] py-1">No movements recorded.</div>
              ) : (
                <div className="space-y-1.5">
                  {movements.map((m) => {
                    const sign = m.type === "out" ? "−" : m.type === "in" ? "+" : "±";
                    const color = m.type === "out" ? "#EF4444" : m.type === "in" ? "#22C55E" : "#F5A623";
                    const MvIcon = m.type === "out" ? ArrowUpFromLine : ArrowDownToLine;
                    return (
                      <div key={m.id} className="border border-[#222A35] rounded-md px-3 py-2 text-[12px] text-[#C2CAD6]">
                        <div className="flex items-center justify-between">
                          <span className="flex items-center gap-1.5" style={{ color }}>
                            <MvIcon className="w-3.5 h-3.5" />
                            {sign}{m.quantity} {item.unit}
                          </span>
                          <span className="text-[10px] text-[#8A95A5]">{new Date(m.date).toLocaleDateString()}</span>
                        </div>
                        <div className="flex items-center justify-between text-[11px] text-[#8A95A5] mt-0.5">
                          <span>
                            {m.reference ? `Ref: ${m.reference}` : "—"}
                            {m.actorName ? ` · ${m.actorName}` : ""}
                          </span>
                          {m.balanceAfter != null && <span>Bal: {m.balanceAfter} {item.unit}</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {canManage && (
              <div className="pt-2 border-t border-[#222A35] flex items-center gap-2">
                <button onClick={() => onEdit(item)} className="h-9 px-3 rounded-md border border-[#222A35] text-[#C2CAD6] text-[12px] flex items-center gap-1.5 hover:bg-[#161C24]">
                  <Pencil className="w-3.5 h-3.5" /> Edit item
                </button>
                <button onClick={remove} className="h-9 px-3 rounded-md border border-[#EF4444]/40 text-[#EF4444] text-[12px] flex items-center gap-1.5 hover:bg-[#EF4444]/10">
                  <Trash2 className="w-3.5 h-3.5" /> Delete item
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[#222A35] bg-[#0A0E14] px-3 py-2">
      <div className="text-[10px] text-[#5B6675] uppercase tracking-wider">{label}</div>
      <div className="text-[12px] text-white mt-0.5">{value}</div>
    </div>
  );
}
