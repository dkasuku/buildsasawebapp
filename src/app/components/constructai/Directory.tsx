import { useState, useMemo, useEffect } from "react";
import { toast } from "sonner";
import { Plus, Search, X, Users, Phone, Mail, Building2, Copy, Trash2 } from "lucide-react";
import type { Role } from "./roles";
import api from "../../services/api";

type Contact = {
  id: string;
  name: string;
  company: string;
  role: string;
  category: "Client" | "Consultant" | "Subcontractor" | "Supplier" | "Authority";
  phone: string;
  email: string;
  projects: string[];
};

const SEED: Contact[] = [
  { id: "c1", name: "Lena Hassan", company: "Hassan & Partners Architects", role: "Lead Architect", category: "Consultant", phone: "+254 712 345 678", email: "lena@hassanpartners.co.ke", projects: ["Westside Tower"] },
  { id: "c2", name: "David Kim", company: "StructEng Consulting", role: "Structural Engineer", category: "Consultant", phone: "+254 723 456 789", email: "dkim@structeng.co.ke", projects: ["Westside Tower", "Riverside Mall"] },
  { id: "c3", name: "Sarah Wairimu", company: "Westside Developments Ltd", role: "Development Manager", category: "Client", phone: "+254 734 567 890", email: "s.wairimu@westside.co.ke", projects: ["Westside Tower"] },
  { id: "c4", name: "Patrick Odhiambo", company: "PowerVolt Electrical Ltd", role: "Director", category: "Subcontractor", phone: "+254 745 678 901", email: "patrick@powervolt.co.ke", projects: ["Westside Tower", "Riverside Mall"] },
  { id: "c5", name: "Janet Muthoni", company: "Bamburi Cement", role: "Account Manager", category: "Supplier", phone: "+254 756 789 012", email: "j.muthoni@bamburi.co.ke", projects: ["Riverside Mall"] },
  { id: "c6", name: "Eng. Joseph Karanja", company: "Nairobi County — Building Dept", role: "Inspection Officer", category: "Authority", phone: "+254 767 890 123", email: "jkaranja@nairobi.go.ke", projects: ["Westside Tower"] },
];

const CAT_CLS: Record<Contact["category"], string> = {
  Client: "bg-[#3B82F6]/15 text-[#3B82F6]",
  Consultant: "bg-[#A855F7]/15 text-[#A855F7]",
  Subcontractor: "bg-[#FF6B1A]/15 text-[#FF6B1A]",
  Supplier: "bg-[#22C55E]/15 text-[#22C55E]",
  Authority: "bg-[#EF4444]/15 text-[#EF4444]",
};

const mapContact = (r: any): Contact => ({
  id: r.id, name: r.name, company: r.company || "", role: r.role || "",
  category: r.category, phone: r.phone || "", email: r.email || "",
  projects: (() => { try { return JSON.parse(r.projects || "[]"); } catch { return []; } })(),
});

export default function Directory({ role }: { role: Role }) {
  const [contacts, setContacts] = useState<Contact[]>(SEED);
  const [q, setQ] = useState("");
  const [catFilter, setCatFilter] = useState<string>("all");
  const [showNew, setShowNew] = useState(false);

  // Load persisted contacts; keep SEED only if the backend is unreachable
  useEffect(() => {
    (async () => {
      try { setContacts((await api.getDirectoryContacts()).map(mapContact)); }
      catch { /* offline — keep SEED */ }
    })();
  }, []);

  const filtered = useMemo(() => contacts.filter((c) => {
    if (catFilter !== "all" && c.category !== catFilter) return false;
    if (q && !`${c.name} ${c.company} ${c.role} ${c.email}`.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  }), [contacts, q, catFilter]);

  const copy = (text: string, label: string) => {
    navigator.clipboard?.writeText(text).then(() => toast.success(`${label} copied`)).catch(() => toast.error("Copy failed"));
  };

  const remove = (id: string) => {
    setContacts((prev) => prev.filter((c) => c.id !== id));
    toast.success("Contact removed");
    api.deleteDirectoryContact(id).catch(() => { /* offline */ });
  };

  return (
    <div className="px-4 sm:px-7 py-6">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#5B6675]" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search contacts & companies…" className="w-full h-9 bg-[#11161D] border border-[#222A35] rounded-lg pl-9 pr-3 text-[13px] text-white focus:outline-none focus:border-[#FF6B1A]" />
        </div>
        <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)} className="h-9 bg-[#11161D] border border-[#222A35] rounded-lg px-2 text-[12px] text-white">
          <option value="all">All Categories</option>
          {Object.keys(CAT_CLS).map((c) => <option key={c}>{c}</option>)}
        </select>
        <button onClick={() => setShowNew(true)} className="h-9 px-4 bg-[#FF6B1A] text-black rounded-lg text-[12px] font-medium flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" /> Add Contact</button>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {filtered.length === 0 && <div className="col-span-full text-center text-[13px] text-[#5B6675] py-10">No contacts match your filters.</div>}
        {filtered.map((c) => (
          <div key={c.id} className="bg-[#11161D] border border-[#222A35] rounded-xl p-4 hover:border-[#2E3947] transition group">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#FF6B1A] to-[#F5A623] flex items-center justify-center text-white text-[12px] shrink-0">{c.name.split(" ").map((p) => p[0]).slice(0, 2).join("")}</div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] text-white truncate">{c.name}</div>
                <div className="text-[11px] text-[#8A95A5] truncate">{c.role}</div>
              </div>
              <button onClick={() => remove(c.id)} className="opacity-0 group-hover:opacity-100 text-[#5B6675] hover:text-[#EF4444] transition"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
            <div className="flex items-center gap-1.5 mt-3 text-[11px] text-[#8A95A5]">
              <Building2 className="w-3 h-3 shrink-0" /><span className="truncate">{c.company}</span>
            </div>
            <span className={`inline-block mt-2 text-[10px] px-2 py-0.5 rounded-full ${CAT_CLS[c.category]}`}>{c.category}</span>
            <div className="mt-3 space-y-1.5">
              <button onClick={() => copy(c.phone, "Phone")} className="w-full flex items-center gap-2 text-[11px] text-[#8A95A5] hover:text-white transition">
                <Phone className="w-3 h-3 text-[#22C55E]" /><span className="flex-1 text-left">{c.phone}</span><Copy className="w-3 h-3 opacity-0 group-hover:opacity-100" />
              </button>
              <button onClick={() => copy(c.email, "Email")} className="w-full flex items-center gap-2 text-[11px] text-[#8A95A5] hover:text-white transition">
                <Mail className="w-3 h-3 text-[#3B82F6]" /><span className="flex-1 text-left truncate">{c.email}</span><Copy className="w-3 h-3 opacity-0 group-hover:opacity-100" />
              </button>
            </div>
            {c.projects.length > 0 && (
              <div className="mt-3 pt-3 border-t border-[#222A35] flex flex-wrap gap-1">
                {c.projects.map((p) => <span key={p} className="text-[10px] px-2 py-0.5 rounded-full bg-[#222A35] text-[#8A95A5]">{p}</span>)}
              </div>
            )}
          </div>
        ))}
      </div>

      {showNew && <NewContactModal onClose={() => setShowNew(false)} onCreate={async (c) => {
        setContacts((prev) => [c, ...prev]);
        toast.success(`${c.name} added to directory`);
        try {
          const saved = await api.createDirectoryContact({ name: c.name, company: c.company, role: c.role, category: c.category, phone: c.phone, email: c.email, projects: c.projects });
          setContacts((prev) => prev.map((x) => x.id === c.id ? mapContact(saved) : x));
        } catch { /* offline — keep local */ }
      }} />}
    </div>
  );
}

function NewContactModal({ onClose, onCreate }: { onClose: () => void; onCreate: (c: Contact) => void }) {
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [roleTitle, setRoleTitle] = useState("");
  const [category, setCategory] = useState<Contact["category"]>("Subcontractor");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");

  const submit = () => {
    if (!name.trim()) { toast.error("Name is required"); return; }
    onCreate({
      id: `c${Date.now()}`,
      name: name.trim(), company: company.trim() || "—", role: roleTitle.trim() || "—",
      category, phone: phone.trim() || "—", email: email.trim() || "—", projects: [],
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-[#11161D] border border-[#222A35] rounded-xl w-full max-w-md p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[15px] font-semibold text-white flex items-center gap-2"><Users className="w-4 h-4 text-[#FF6B1A]" /> Add Contact</h3>
          <button onClick={onClose} className="text-[#8A95A5] hover:text-white"><X className="w-4 h-4" /></button>
        </div>
        <div className="space-y-3">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-lg px-3 text-[13px] text-white focus:outline-none focus:border-[#FF6B1A]" />
          <div className="grid grid-cols-2 gap-3">
            <input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Company" className="h-9 bg-[#0A0E14] border border-[#222A35] rounded-lg px-3 text-[13px] text-white focus:outline-none focus:border-[#FF6B1A]" />
            <input value={roleTitle} onChange={(e) => setRoleTitle(e.target.value)} placeholder="Role / title" className="h-9 bg-[#0A0E14] border border-[#222A35] rounded-lg px-3 text-[13px] text-white focus:outline-none focus:border-[#FF6B1A]" />
          </div>
          <select value={category} onChange={(e) => setCategory(e.target.value as Contact["category"])} className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-lg px-2 text-[13px] text-white">
            {Object.keys(CAT_CLS).map((c) => <option key={c}>{c}</option>)}
          </select>
          <div className="grid grid-cols-2 gap-3">
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" className="h-9 bg-[#0A0E14] border border-[#222A35] rounded-lg px-3 text-[13px] text-white focus:outline-none focus:border-[#FF6B1A]" />
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className="h-9 bg-[#0A0E14] border border-[#222A35] rounded-lg px-3 text-[13px] text-white focus:outline-none focus:border-[#FF6B1A]" />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="h-9 px-4 bg-[#222A35] rounded-lg text-[12px] text-white">Cancel</button>
          <button onClick={submit} className="h-9 px-4 bg-[#FF6B1A] text-black rounded-lg text-[12px] font-medium">Add Contact</button>
        </div>
      </div>
    </div>
  );
}
