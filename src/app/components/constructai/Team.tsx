import { useState } from "react";
import { toast } from "sonner";
import { Plus, Shield, Users, GitBranch, Workflow, Search, Check, X as XIcon, Mail, Phone, MapPin, Briefcase, Clock, FolderKanban, Activity } from "lucide-react";
import type { Role } from "./roles";
import { ROLES, ROLE_COLORS } from "./roles";

const members = [
  { n: "Marcus Rivera", e: "marcus@meridianbuild.com", role: "Contractor", trade: "General", proj: 12, status: "Active", last: "Now", c: "#FF6B1A", initials: "MR" },
  { n: "Jane Cho", e: "jane.cho@meridianbuild.com", role: "Executive", trade: "General", proj: 6, status: "Active", last: "12m", c: "#EF4444", initials: "JC" },
  { n: "Tomás Nguyen", e: "tnguyen@meridianbuild.com", role: "Project Manager", trade: "General", proj: 4, status: "Active", last: "2h", c: "#3B82F6", initials: "TN" },
  { n: "Sarah Patel", e: "spatel@meridianbuild.com", role: "Superintendent", trade: "General", proj: 2, status: "On site", last: "4m", c: "#F5A623", initials: "SP" },
  { n: "Adaora Eze", e: "adaora@brightelec.com", role: "Trade Lead", trade: "Electrical", proj: 3, status: "On site", last: "8m", c: "#F5A623", initials: "AE" },
  { n: "Carlos Mendez", e: "carlos@flowplumb.com", role: "Trade Lead", trade: "Plumbing", proj: 4, status: "On site", last: "20m", c: "#3B82F6", initials: "CM" },
  { n: "Yuki Tanaka", e: "yuki@coolair.com", role: "Trade Lead", trade: "HVAC", proj: 2, status: "On site", last: "1h", c: "#06B6D4", initials: "YT" },
  { n: "Jin Kowalski", e: "jin@framecraft.com", role: "Trade Lead", trade: "Carpentry", proj: 3, status: "On site", last: "30m", c: "#A16207", initials: "JK" },
  { n: "Liam Park", e: "lpark@truecolor.com", role: "Worker", trade: "Painting", proj: 1, status: "On site", last: "20m", c: "#8B5CF6", initials: "LP" },
  { n: "Daniel Owusu", e: "daniel@stoneworks.com", role: "Worker", trade: "Masonry", proj: 2, status: "On site", last: "45m", c: "#78716C", initials: "DO" },
  { n: "K. Ahmadi", e: "kamran@gulfdev.com", role: "Owner", trade: "—", proj: 1, status: "External", last: "1d", c: "#8B5CF6", initials: "KA" },
  { n: "Ava Lindqvist", e: "ava@aor-studio.com", role: "Viewer", trade: "Architect", proj: 4, status: "External", last: "6h", c: "#5B6675", initials: "AL" },
];

const roles = [
  { r: "Contractor", c: 1, p: "Workspace owner — full control, billing, can act as Owner", color: "#FF6B1A" },
  { r: "Owner / Client", c: 4, p: "Approves budget & change orders. Read-only on field ops", color: "#8B5CF6" },
  { r: "Executive / Assistant", c: 3, p: "Helps run the office. Can approve change orders within their limit.", color: "#EF4444" },
  { r: "Project Manager", c: 6, p: "Day-to-day project lead. Can approve change orders within their limit.", color: "#3B82F6" },
  { r: "Superintendent", c: 8, p: "Jobsite lead. Assigns tasks to crews & trades", color: "#F5A623" },
  { r: "Trade Lead", c: 14, p: "Electrician / Plumber / HVAC / Carpenter / etc.", color: "#06B6D4" },
  { r: "Worker", c: 32, p: "Tradesperson on the jobsite. Mobile-first.", color: "#22C55E" },
  { r: "Viewer", c: 9, p: "Read-only: architect, inspector, lender", color: "#5B6675" },
];

const PERMS_MATRIX: { key: keyof typeof ROLES.Contractor; label: string }[] = [
  { key: "financials", label: "View financials" },
  { key: "createCO", label: "Create change orders" },
  { key: "approveAny", label: "Approve COs" },
  { key: "manageTeam", label: "Manage team" },
  { key: "sharePlans", label: "Share drawings" },
  { key: "viewReports", label: "Reports access" },
  { key: "viewAuditTrail", label: "Audit trail" },
  { key: "viewKanban", label: "Pipeline kanban" },
  { key: "viewFieldApp", label: "Field mobile app" },
];

export function Team({ role = "Contractor" }: { role?: Role }) {
  const [q, setQ] = useState("");
  const [activeRole, setActiveRole] = useState<Role>(role);
  const [selectedMember, setSelectedMember] = useState<typeof members[0] | null>(null);
  const filtered = members.filter((m) => !q || m.n.toLowerCase().includes(q.toLowerCase()) || m.role.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="px-4 sm:px-7 py-5 sm:py-6 space-y-5">
      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {[
          { i: Users, l: "Total members", v: "70", s: "+5 this month" },
          { i: Shield, l: "Roles configured", v: "6", s: "Custom approval limits" },
          { i: Workflow, l: "Active workflows", v: "4", s: "Per project type" },
          { i: GitBranch, l: "External collaborators", v: "12", s: "Across 4 firms" },
        ].map((k) => (
          <div key={k.l} className="rounded-xl border border-[#222A35] bg-[#11161D] p-5">
            <div className="flex items-center justify-between">
              <div className="w-8 h-8 rounded-md bg-[#FF6B1A]/15 text-[#FF6B1A] flex items-center justify-center"><k.i className="w-4 h-4" /></div>
            </div>
            <div className="text-[26px] text-white mt-3 tracking-tight" style={{ fontWeight: 500 }}>{k.v}</div>
            <div className="text-[11px] text-[#8A95A5]">{k.l}</div>
            <div className="text-[10px] text-[#5B6675] mt-1.5 pt-2 border-t border-[#222A35]">{k.s}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Member table */}
        <div className="lg:col-span-2 rounded-xl border border-[#222A35] bg-[#11161D] overflow-hidden">
          <div className="px-5 py-4 border-b border-[#222A35] flex items-center justify-between">
            <div>
              <div className="text-[13px] text-white" style={{ fontWeight: 500 }}>Team members</div>
              <div className="text-[11px] text-[#8A95A5]">Manage roles, projects, and access</div>
            </div>
            <div className="flex gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#5B6675]" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search..." className="w-[160px] sm:w-[200px] h-8 bg-[#0A0E14] border border-[#222A35] rounded-md pl-8 pr-3 text-[12px] text-white focus:outline-none focus:border-[#FF6B1A]" />
              </div>
              <button onClick={() => toast.success("Invite link copied")} className="h-8 px-3 rounded-md bg-[#FF6B1A] text-white text-[12px] flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" /> Invite</button>
            </div>
          </div>
          <div className="overflow-x-auto">
          <table className="w-full min-w-[720px]">
            <thead>
              <tr className="text-[10px] text-[#5B6675] uppercase tracking-wider">
                <th className="text-left px-5 py-2.5">Name</th>
                <th className="text-left px-3 py-2.5">Role</th>
                <th className="text-left px-3 py-2.5">Trade</th>
                <th className="text-left px-3 py-2.5">Projects</th>
                <th className="text-left px-3 py-2.5">Status</th>
                <th className="text-right px-5 py-2.5">Last active</th>
              </tr>
            </thead>
            <tbody className="text-[12px]">
              {filtered.map((m) => {
                const isSelected = selectedMember?.e === m.e;
                return (
                <tr key={m.e} className={`border-t border-[#222A35] hover:bg-[#161C24] cursor-pointer ${isSelected ? "bg-[#161C24]" : ""}`}>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => setSelectedMember(isSelected ? null : m)}
                        className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-[11px] shrink-0 ring-2 ring-offset-2 ring-offset-[#11161D] transition ${isSelected ? "ring-[#FF6B1A]" : "ring-transparent"}`}
                        style={{ background: m.c }}
                        title="View profile"
                      >{m.initials}</button>
                      <div>
                        <div className="text-white">{m.n}</div>
                        <div className="text-[10px] text-[#5B6675]">{m.e}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-[#8A95A5]">{m.role}</td>
                  <td className="px-3 py-3"><span className="text-[10px] px-1.5 py-0.5 rounded bg-[#222A35] text-[#8A95A5]">{m.trade}</span></td>
                  <td className="px-3 py-3 text-white">{m.proj}</td>
                  <td className="px-3 py-3">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                      m.status === "Active" ? "bg-[#22C55E]/15 text-[#22C55E]" :
                      m.status === "On site" ? "bg-[#FF6B1A]/15 text-[#FF6B1A]" :
                      "bg-[#222A35] text-[#8A95A5]"
                    }`}>{m.status}</span>
                  </td>
                  <td className="px-5 py-3 text-right text-[#5B6675] text-[11px]">{m.last} ago</td>
                </tr>
              );
            })}
            </tbody>
          </table>
          </div>
        </div>

        {/* Profile panel */}
        <div className="space-y-5">
          {selectedMember && (
            <div className="rounded-xl border border-[#222A35] bg-[#11161D] overflow-hidden">
              <div className="relative h-20 bg-gradient-to-r from-[#FF6B1A]/20 to-[#FF8A4A]/10">
                <button
                  onClick={() => setSelectedMember(null)}
                  className="absolute top-2 right-2 w-6 h-6 rounded-md bg-[#0A0E14]/60 text-[#8A95A5] hover:text-white flex items-center justify-center"
                  title="Close"
                >
                  <XIcon className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="px-5 pb-5 -mt-8">
                <div
                  className="w-16 h-16 rounded-full border-4 border-[#11161D] flex items-center justify-center text-white text-[18px]"
                  style={{ background: selectedMember.c }}
                >{selectedMember.initials}</div>
                <div className="mt-3">
                  <div className="text-[15px] text-white" style={{ fontWeight: 500 }}>{selectedMember.n}</div>
                  <div className="text-[12px] text-[#8A95A5]">{selectedMember.role}</div>
                </div>
                <div className="mt-4 space-y-2.5">
                  <div className="flex items-center gap-2.5 text-[12px] text-[#8A95A5]">
                    <Mail className="w-3.5 h-3.5 text-[#5B6675]" />
                    <span>{selectedMember.e}</span>
                  </div>
                  <div className="flex items-center gap-2.5 text-[12px] text-[#8A95A5]">
                    <Phone className="w-3.5 h-3.5 text-[#5B6675]" />
                    <span>+254 722 000 000</span>
                  </div>
                  <div className="flex items-center gap-2.5 text-[12px] text-[#8A95A5]">
                    <MapPin className="w-3.5 h-3.5 text-[#5B6675]" />
                    <span>Nairobi, Kenya</span>
                  </div>
                  <div className="flex items-center gap-2.5 text-[12px] text-[#8A95A5]">
                    <Briefcase className="w-3.5 h-3.5 text-[#5B6675]" />
                    <span>{selectedMember.trade}</span>
                  </div>
                </div>
                <div className="mt-4 pt-4 border-t border-[#222A35] grid grid-cols-3 gap-2">
                  <div className="text-center">
                    <div className="text-[14px] text-white" style={{ fontWeight: 500 }}>{selectedMember.proj}</div>
                    <div className="text-[10px] text-[#5B6675]">Projects</div>
                  </div>
                  <div className="text-center">
                    <div className="text-[14px] text-white" style={{ fontWeight: 500 }}>{selectedMember.last}</div>
                    <div className="text-[10px] text-[#5B6675]">Last active</div>
                  </div>
                  <div className="text-center">
                    <div className={`text-[14px] ${selectedMember.status === "Active" ? "text-[#22C55E]" : selectedMember.status === "On site" ? "text-[#FF6B1A]" : "text-[#8A95A5]"}`} style={{ fontWeight: 500 }}>{selectedMember.status}</div>
                    <div className="text-[10px] text-[#5B6675]">Status</div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Roles */}
          <div className="rounded-xl border border-[#222A35] bg-[#11161D] p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="text-[13px] text-white" style={{ fontWeight: 500 }}>Roles & permissions</div>
              <button className="text-[11px] text-[#FF6B1A] hover:underline">Configure</button>
            </div>
            <div className="space-y-2">
              {roles.map((r) => (
                <div key={r.r} className="p-3 rounded-lg bg-[#0A0E14] border border-[#222A35]">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: r.color }} />
                      <span className="text-[12px] text-white">{r.r}</span>
                    </div>
                    <span className="text-[10px] text-[#5B6675]">{r.c} members</span>
                  </div>
                  <div className="text-[11px] text-[#8A95A5] mt-1">{r.p}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Workflow */}
          <div className="rounded-xl border border-[#222A35] bg-[#11161D] p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-[13px] text-white" style={{ fontWeight: 500 }}>Workflow · Commercial</div>
                <div className="text-[11px] text-[#8A95A5]">Default for high-value change orders</div>
              </div>
              <button className="text-[11px] text-[#FF6B1A] hover:underline">Edit</button>
            </div>
            <div className="space-y-2">
              {[
                { s: "Drafted", a: "Field Supervisor", c: "#F5A623" },
                { s: "PM Review", a: "Project Manager · 24h SLA", c: "#3B82F6" },
                { s: "Cost validation", a: "Cost Estimator · 12h SLA", c: "#8B5CF6" },
                { s: "Exec sign-off", a: "Project Executive · above limit", c: "#FF6B1A" },
                { s: "Owner approval", a: "Owner Rep · auto-escalate 48h", c: "#22C55E" },
              ].map((s, i, arr) => (
                <div key={s.s} className="flex items-start gap-3">
                  <div className="flex flex-col items-center">
                    <div className="w-6 h-6 rounded-full border-2" style={{ borderColor: s.c, background: `${s.c}20` }} />
                    {i < arr.length - 1 && <div className="w-px flex-1 bg-[#222A35] min-h-[20px]" />}
                  </div>
                  <div className="pb-1">
                    <div className="text-[12px] text-white">{s.s}</div>
                    <div className="text-[10px] text-[#8A95A5]">{s.a}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Permission Matrix — what each role sees */}
      <div className="rounded-xl border border-[#222A35] bg-[#11161D] overflow-hidden">
        <div className="px-5 py-4 border-b border-[#222A35] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <div className="text-[13px] text-white font-display">Panel Visibility Matrix</div>
            <div className="text-[11px] text-[#8A95A5]">What panels each SaaS / mobile role can see — green = visible, dimmed = hidden</div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(ROLES) as Role[]).map((r) => (
              <button
                key={r}
                onClick={() => setActiveRole(r)}
                className={`px-2.5 h-7 rounded-md text-[11px] flex items-center gap-1.5 border ${activeRole === r ? "bg-[#161C24] border-[#FF6B1A]/40 text-white" : "bg-[#0A0E14] border-[#222A35] text-[#8A95A5] hover:text-white"}`}
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: ROLE_COLORS[r] }} />
                {r}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-[12px]">
            <thead>
              <tr className="text-[10px] text-[#5B6675] uppercase tracking-wider">
                <th className="text-left px-5 py-2.5">Capability</th>
                {(Object.keys(ROLES) as Role[]).map((r) => (
                  <th key={r} className="px-3 py-2.5 text-center">
                    <div className="flex items-center justify-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: ROLE_COLORS[r] }} />
                      <span className="hidden md:inline">{r}</span>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PERMS_MATRIX.map((cap) => (
                <tr key={cap.key} className="border-t border-[#222A35]/60">
                  <td className="px-5 py-2.5 text-white">{cap.label}</td>
                  {(Object.keys(ROLES) as Role[]).map((r) => {
                    const on = !!ROLES[r][cap.key];
                    return (
                      <td key={r} className="px-3 py-2.5 text-center">
                        {on
                          ? <Check className="w-4 h-4 text-[#22C55E] inline" />
                          : <XIcon className="w-4 h-4 text-[#3A4350] inline" />}
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr className="border-t border-[#222A35]/60 bg-[#0A0E14]/40">
                <td className="px-5 py-2.5 text-white">Approval limit</td>
                {(Object.keys(ROLES) as Role[]).map((r) => (
                  <td key={r} className="px-3 py-2.5 text-center text-[#FF6B1A] text-[11px]">
                    {ROLES[r].approveLimit === Infinity ? "∞" : ROLES[r].approveLimit === 0 ? "—" : `$${(ROLES[r].approveLimit/1000).toFixed(0)}k`}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>

        {/* Spotlight on selected role */}
        <div className="px-5 py-4 border-t border-[#222A35] bg-[#0A0E14]/60">
          <div className="flex items-center gap-2 mb-3">
            <span className="w-2 h-2 rounded-full" style={{ background: ROLE_COLORS[activeRole] }} />
            <div className="text-[12px] text-white"><span className="font-display">{activeRole}</span> sees these sections:</div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(["dashboard","projects","change-order","plans","tasks","reports","team","mobile-create","field-view"] as const).map((v) => {
              const visible = ROLES[activeRole].views.includes(v as any);
              return (
                <span key={v} className={`px-2 py-1 rounded-md text-[11px] border ${visible ? "bg-[#22C55E]/10 border-[#22C55E]/30 text-[#22C55E]" : "bg-[#11161D] border-[#222A35] text-[#3A4350] line-through"}`}>
                  {v}
                </span>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
