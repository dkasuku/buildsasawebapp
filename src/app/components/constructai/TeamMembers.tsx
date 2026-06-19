// ============================================================================
// Team Members — real multi-user management. The workspace owner invites
// teammates with an assigned role; they log in with that role. Backend-wired.
// ============================================================================

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { UserPlus, Trash2, Copy, X, ShieldCheck, Loader2, Mail } from "lucide-react";
import type { Role } from "./roles";
import { ROLES, ROLE_COLORS, ROLE_DESCRIPTIONS } from "./roles";

const ALL_ROLES = Object.keys(ROLES) as Role[];

export default function TeamMembers({ role }: { role: Role }) {
  const canManage = ROLES[role].manageTeam || ROLES[role].isWorkspaceOwner;
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [created, setCreated] = useState<{ email: string; tempPassword?: string; emailed?: boolean } | null>(null);

  const load = async () => {
    setLoading(true);
    try { const m = await import("../../services/api"); setUsers(await m.default.getUsers()); }
    catch { setUsers([]); }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const changeRole = async (id: string, newRole: string) => {
    setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, role: newRole } : u)));
    try { const m = await import("../../services/api"); await m.default.updateUserRole(id, newRole); toast.success("Role updated"); }
    catch { toast.error("Could not update role"); }
  };
  const remove = async (id: string) => {
    if (!confirm("Remove this teammate's access?")) return;
    setUsers((prev) => prev.filter((u) => u.id !== id));
    try { const m = await import("../../services/api"); await m.default.removeUser(id); toast.success("Member removed"); }
    catch { toast.error("Could not remove"); }
  };

  return (
    <div className="px-4 sm:px-7 py-6 max-w-4xl">
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-[14px] text-white font-display">Team members</div>
          <div className="text-[11px] text-[#8A95A5]">Invite teammates and assign their role. They log in with that role.</div>
        </div>
        {canManage && <button onClick={() => { setShowInvite(true); setCreated(null); }} className="h-9 px-4 bg-[#FF6B1A] text-white rounded-lg text-[12px] flex items-center gap-1.5 hover:bg-[#FF7E33]"><UserPlus className="w-3.5 h-3.5" /> Invite member</button>}
      </div>

      <div className="rounded-xl border border-[#222A35] bg-[#11161D] overflow-hidden">
        {loading ? <div className="p-8 text-center text-[#5B6675] text-[13px]"><Loader2 className="w-4 h-4 animate-spin inline" /> Loading…</div> : (
          <table className="w-full text-[12px]">
            <thead><tr className="text-[10px] text-[#5B6675] uppercase tracking-wider border-b border-[#222A35]">
              <th className="text-left px-4 py-2.5">Name</th><th className="text-left px-3 py-2.5">Email</th><th className="text-left px-3 py-2.5">Role</th><th className="px-3 py-2.5"></th>
            </tr></thead>
            <tbody>
              {users.length === 0 && <tr><td colSpan={4} className="text-center py-8 text-[#5B6675]">No members yet. Invite your team.</td></tr>}
              {users.map((u) => (
                <tr key={u.id} className="border-b border-[#222A35] last:border-0 hover:bg-[#161C24]">
                  <td className="px-4 py-2.5 text-white flex items-center gap-2"><span className="w-2 h-2 rounded-full" style={{ background: ROLE_COLORS[u.role as Role] || "#5B6675" }} />{u.name}</td>
                  <td className="px-3 py-2.5 text-[#8A95A5]">{u.email}</td>
                  <td className="px-3 py-2.5">
                    {canManage ? (
                      <select value={u.role} onChange={(e) => changeRole(u.id, e.target.value)} className="h-8 bg-[#0A0E14] border border-[#222A35] rounded px-2 text-[11px] text-white">
                        {ALL_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                    ) : <span className="text-[#C2CAD6]">{u.role}</span>}
                  </td>
                  <td className="px-3 py-2.5 text-right">{canManage && <button onClick={() => remove(u.id)} className="text-[#5B6675] hover:text-[#EF4444]"><Trash2 className="w-3.5 h-3.5" /></button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showInvite && <InviteModal onClose={() => setShowInvite(false)} onCreated={(c) => { setCreated(c); setShowInvite(false); load(); }} />}

      {created && (
        <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-4" onClick={() => setCreated(null)}>
          <div className="w-full max-w-md rounded-xl border border-[#222A35] bg-[#11161D] p-5" onClick={(e) => e.stopPropagation()}>
            <div className="text-[14px] text-white font-display flex items-center gap-2 mb-2"><ShieldCheck className="w-4 h-4 text-[#22C55E]" /> Member added</div>
            {created.emailed ? (
              <>
                <p className="text-[12px] text-[#8A95A5]">An invite email with sign-in instructions was sent to <span className="text-white">{created.email}</span>. They can set their own password from the link.</p>
                <div className="mt-3 p-3 rounded-lg bg-[#0A0E14] border border-[#222A35] text-[12px]">
                  <div className="text-[#8A95A5] flex items-center gap-1.5"><Mail className="w-3.5 h-3.5 text-[#22C55E]" /> Invite sent to <span className="text-white font-mono">{created.email}</span></div>
                </div>
              </>
            ) : (
              <>
                <p className="text-[12px] text-[#8A95A5]">Email isn't configured yet, so share these sign-in details with <span className="text-white">{created.email}</span> directly. They can change the password after first login.</p>
                <div className="mt-3 p-3 rounded-lg bg-[#0A0E14] border border-[#222A35] text-[12px]">
                  <div className="text-[#8A95A5]">Email: <span className="text-white font-mono">{created.email}</span></div>
                  <div className="text-[#8A95A5] mt-1 flex items-center gap-2">Temp password: <span className="text-white font-mono">{created.tempPassword}</span>
                    <button onClick={() => { if (created.tempPassword) { navigator.clipboard?.writeText(created.tempPassword); toast.success("Copied"); } }} className="text-[#FF6B1A]"><Copy className="w-3 h-3" /></button>
                  </div>
                </div>
              </>
            )}
            <button onClick={() => setCreated(null)} className="mt-4 w-full h-9 rounded-md bg-[#FF6B1A] text-white text-[12px]">Done</button>
          </div>
        </div>
      )}
    </div>
  );
}

function InviteModal({ onClose, onCreated }: { onClose: () => void; onCreated: (c: { email: string; tempPassword?: string; emailed?: boolean }) => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [memberRole, setMemberRole] = useState<Role>("Site Engineer");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const cls = "w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-[12px] text-white focus:outline-none focus:border-[#FF6B1A]";
  const submit = async () => {
    if (!name.trim() || !email.trim()) return toast.error("Name and email are required");
    setBusy(true);
    try {
      const m = await import("../../services/api");
      const r = await m.default.inviteUser({ name: name.trim(), email: email.trim(), role: memberRole, password: password || undefined });
      onCreated({ email: r.user.email, tempPassword: r.tempPassword, emailed: r.emailed });
    } catch (e: any) { toast.error(e.message || "Invite failed"); }
    setBusy(false);
  };
  return (
    <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-[#222A35] bg-[#11161D]" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-[#222A35] flex items-center justify-between">
          <div className="text-[14px] text-white font-display flex items-center gap-2"><Mail className="w-4 h-4 text-[#FF6B1A]" /> Invite member</div>
          <button onClick={onClose} className="text-[#8A95A5] hover:text-white"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-3">
          <div><div className="text-[10px] uppercase tracking-wider text-[#8A95A5] mb-1">Full name</div><input value={name} onChange={(e) => setName(e.target.value)} className={cls} placeholder="e.g. John Mwangi" /></div>
          <div><div className="text-[10px] uppercase tracking-wider text-[#8A95A5] mb-1">Work email</div><input value={email} onChange={(e) => setEmail(e.target.value)} className={cls} placeholder="name@company.co.ke" /></div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-[#8A95A5] mb-1">Role</div>
            <select value={memberRole} onChange={(e) => setMemberRole(e.target.value as Role)} className={cls}>{ALL_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}</select>
            <div className="text-[10px] text-[#5B6675] mt-1">{ROLE_DESCRIPTIONS[memberRole]}</div>
          </div>
          <div><div className="text-[10px] uppercase tracking-wider text-[#8A95A5] mb-1">Temp password (optional — auto-generated if blank)</div><input value={password} onChange={(e) => setPassword(e.target.value)} className={cls} placeholder="min 6 characters" /><div className="text-[10px] text-[#5B6675] mt-1">We'll email them an invite with sign-in details. If email isn't set up yet, you'll get the temporary password to share.</div></div>
        </div>
        <div className="px-5 py-4 border-t border-[#222A35] flex gap-2">
          <button onClick={onClose} className="flex-1 h-10 rounded-md border border-[#222A35] text-[12px] text-white">Cancel</button>
          <button disabled={busy} onClick={submit} className="flex-1 h-10 rounded-md bg-[#FF6B1A] text-white text-[12px] disabled:opacity-50">{busy ? "Inviting…" : "Send invite"}</button>
        </div>
      </div>
    </div>
  );
}
