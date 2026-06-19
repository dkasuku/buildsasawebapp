// ============================================================================
// Settings — a tabbed modal for the signed-in user.
//   • Profile: name, phone, trade, emergency contact + a profile photo
//     (uploaded, downscaled to a small data URL). Saves via PUT /api/me.
//   • Account & Security: change password (verifies the current one).
// Role and email are read-only here. Broadcasts "buildflex:profile-updated" so
// the sidebar avatar refreshes after a profile save.
// ============================================================================

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { X, Camera, Trash2, Loader2, Check, ShieldAlert, UserRound, Lock } from "lucide-react";
import { TRADES } from "./roles";
import api, { type UserProfile } from "../../services/api";

const lbl = "text-[10px] uppercase tracking-[0.08em] text-[#5B6675] mb-1 block";
const input = "w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-2.5 text-[12.5px] text-white placeholder:text-[#3A4350] focus:outline-none focus:border-[#FF6B1A] transition-colors";

// Read a File into a downscaled (max 256px) JPEG data URL so avatars stay small.
function fileToAvatar(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read that image"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("That file isn't a valid image"));
      img.onload = () => {
        const max = 256;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("Image processing not supported"));
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export function ProfileSettings({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<"profile" | "account">("profile");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [me, setMe] = useState<UserProfile | null>(null);
  const [f, setF] = useState({
    name: "", phone: "", age: "", gender: "", trade: "", qualifications: "", emergencyContact: "", emergencyPhone: "", avatar: "",
  });
  const [pwd, setPwd] = useState({ current: "", next: "", confirm: "" });
  const [savingPwd, setSavingPwd] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const set = (k: string, v: any) => setF((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    api.me().then((u) => {
      setMe(u);
      setF({
        name: u.name || "", phone: u.phone || "", age: u.age != null ? String(u.age) : "", gender: u.gender || "",
        trade: u.trade || "", qualifications: u.qualifications || "", emergencyContact: u.emergencyContact || "",
        emergencyPhone: u.emergencyPhone || "", avatar: u.avatar || "",
      });
    }).catch(() => toast.error("Couldn't load your profile")).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const pickPhoto = async (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) return toast.error("Please choose an image file");
    try { set("avatar", await fileToAvatar(file)); } catch (e: any) { toast.error(e?.message || "Couldn't process that image"); }
  };

  const saveProfile = async () => {
    if (!f.name.trim()) return toast.error("Name is required");
    setSaving(true);
    try {
      await api.updateMe({
        name: f.name.trim(), phone: f.phone.trim(), age: f.age === "" ? null : Number(f.age), gender: f.gender || null,
        trade: f.trade || null, qualifications: f.qualifications.trim(), emergencyContact: f.emergencyContact.trim(),
        emergencyPhone: f.emergencyPhone.trim(), avatar: f.avatar || null,
      });
      try { window.dispatchEvent(new Event("buildflex:profile-updated")); } catch { /* noop */ }
      toast.success("Profile updated");
      onClose();
    } catch (e: any) { toast.error(e?.message || "Could not save profile"); }
    setSaving(false);
  };

  const changePwd = async () => {
    if (pwd.next.length < 6) return toast.error("New password must be at least 6 characters");
    if (pwd.next !== pwd.confirm) return toast.error("New passwords don't match");
    setSavingPwd(true);
    try {
      await api.changePassword(pwd.current, pwd.next);
      toast.success("Password changed");
      setPwd({ current: "", next: "", confirm: "" });
    } catch (e: any) { toast.error(e?.message || "Could not change password"); }
    setSavingPwd(false);
  };

  const initials = (f.name || me?.name || "U").trim().split(/\s+/).map((s) => s[0]).slice(0, 2).join("").toUpperCase() || "U";
  const TabBtn = ({ id, icon: Icon, label }: { id: "profile" | "account"; icon: any; label: string }) => (
    <button onClick={() => setTab(id)} className={`flex items-center gap-2 px-3 h-9 text-[12.5px] rounded-md ${tab === id ? "bg-[#222A35] text-white" : "text-[#8A95A5] hover:text-white"}`}><Icon className="w-3.5 h-3.5" /> {label}</button>
  );

  return (
    <div className="fixed inset-0 z-[80] bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl border border-[#222A35] bg-[#11161D]" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-[#222A35] sticky top-0 bg-[#11161D] z-10">
          <div className="flex items-center justify-between">
            <div className="text-[15px] text-white font-display">Settings</div>
            <button onClick={onClose} className="text-[#8A95A5] hover:text-white"><X className="w-4 h-4" /></button>
          </div>
          <div className="flex gap-1 mt-3 bg-[#0A0E14] border border-[#222A35] rounded-lg p-0.5 w-fit">
            <TabBtn id="profile" icon={UserRound} label="Profile" />
            <TabBtn id="account" icon={Lock} label="Account & Security" />
          </div>
        </div>

        {/* PROFILE */}
        {tab === "profile" && (loading ? (
          <div className="py-16 text-center text-[#5B6675] text-[13px]"><Loader2 className="w-4 h-4 animate-spin inline mr-1.5" /> Loading…</div>
        ) : (
          <div className="p-5 space-y-4">
            <div className="flex items-center gap-4">
              <div className="relative">
                {f.avatar
                  ? <img src={f.avatar} alt="" className="w-16 h-16 rounded-full object-cover border border-[#222A35]" />
                  : <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[#FF6B1A] to-[#F5A623] flex items-center justify-center text-white text-[20px]">{initials}</div>}
                <button onClick={() => fileRef.current?.click()} title="Change photo" className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-[#FF6B1A] text-white flex items-center justify-center border-2 border-[#11161D] hover:bg-[#FF7E33]"><Camera className="w-3.5 h-3.5" /></button>
              </div>
              <div className="space-y-1.5">
                <button onClick={() => fileRef.current?.click()} className="h-8 px-3 rounded-md border border-[#222A35] text-[12px] text-white hover:border-[#FF6B1A] flex items-center gap-1.5"><Camera className="w-3.5 h-3.5" /> Upload photo</button>
                {f.avatar && <button onClick={() => set("avatar", "")} className="h-8 px-3 rounded-md text-[11px] text-[#EF4444] hover:bg-[#EF4444]/10 flex items-center gap-1.5"><Trash2 className="w-3.5 h-3.5" /> Remove</button>}
              </div>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { pickPhoto(e.target.files?.[0]); e.target.value = ""; }} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div><span className={lbl}>Email</span><div className="h-9 flex items-center px-2.5 rounded-md bg-[#0A0E14] border border-[#222A35] text-[12.5px] text-[#8A95A5] truncate">{me?.email || "—"}</div></div>
              <div><span className={lbl}>Role</span><div className="h-9 flex items-center px-2.5 rounded-md bg-[#0A0E14] border border-[#222A35] text-[12.5px] text-[#8A95A5]">{me?.role || "—"}</div></div>
            </div>
            <div className="text-[10.5px] text-[#5B6675] -mt-2 flex items-center gap-1.5"><ShieldAlert className="w-3 h-3" /> Email and role are managed by your workspace owner.</div>

            <div><span className={lbl}>Full name *</span><input value={f.name} onChange={(e) => set("name", e.target.value)} className={input} placeholder="Your name" /></div>

            <div className="grid grid-cols-2 gap-3">
              <div><span className={lbl}>Phone</span><input value={f.phone} onChange={(e) => set("phone", e.target.value)} className={input} placeholder="+254…" /></div>
              <div><span className={lbl}>Trade</span><select value={f.trade} onChange={(e) => set("trade", e.target.value)} className={input}><option value="">—</option>{TRADES.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}</select></div>
              <div><span className={lbl}>Age</span><input type="number" min={0} max={120} value={f.age} onChange={(e) => set("age", e.target.value)} className={input} placeholder="—" /></div>
              <div><span className={lbl}>Gender</span><select value={f.gender} onChange={(e) => set("gender", e.target.value)} className={input}><option value="">—</option><option value="male">Male</option><option value="female">Female</option><option value="other">Other</option><option value="prefer-not-to-say">Prefer not to say</option></select></div>
            </div>

            <div><span className={lbl}>Qualifications</span><input value={f.qualifications} onChange={(e) => set("qualifications", e.target.value)} className={input} placeholder="e.g. NCA registered, OSHA 30" /></div>

            <div className="grid grid-cols-2 gap-3">
              <div><span className={lbl}>Emergency contact</span><input value={f.emergencyContact} onChange={(e) => set("emergencyContact", e.target.value)} className={input} placeholder="Name" /></div>
              <div><span className={lbl}>Emergency phone</span><input value={f.emergencyPhone} onChange={(e) => set("emergencyPhone", e.target.value)} className={input} placeholder="+254…" /></div>
            </div>

            <div className="flex gap-2 pt-1">
              <button onClick={onClose} className="flex-1 h-10 rounded-md border border-[#222A35] text-[12px] text-white">Cancel</button>
              <button disabled={saving} onClick={saveProfile} className="flex-1 h-10 rounded-md bg-[#FF6B1A] hover:bg-[#FF7E33] text-white text-[12px] disabled:opacity-50 flex items-center justify-center gap-1.5">{saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Save changes</button>
            </div>
          </div>
        ))}

        {/* ACCOUNT & SECURITY */}
        {tab === "account" && (
          <div className="p-5 space-y-4">
            <div className="text-[12.5px] text-white font-medium">Change password</div>
            <div><span className={lbl}>Current password</span><input type="password" autoComplete="current-password" value={pwd.current} onChange={(e) => setPwd((p) => ({ ...p, current: e.target.value }))} className={input} placeholder="••••••••" /></div>
            <div><span className={lbl}>New password</span><input type="password" autoComplete="new-password" value={pwd.next} onChange={(e) => setPwd((p) => ({ ...p, next: e.target.value }))} className={input} placeholder="At least 6 characters" /></div>
            <div><span className={lbl}>Confirm new password</span><input type="password" autoComplete="new-password" value={pwd.confirm} onChange={(e) => setPwd((p) => ({ ...p, confirm: e.target.value }))} className={input} placeholder="Re-enter new password" /></div>
            {pwd.confirm && pwd.next !== pwd.confirm && <div className="text-[10.5px] text-[#EF4444]">Passwords don't match.</div>}
            <div className="flex gap-2 pt-1">
              <button onClick={onClose} className="flex-1 h-10 rounded-md border border-[#222A35] text-[12px] text-white">Cancel</button>
              <button disabled={savingPwd || pwd.next.length < 6 || pwd.next !== pwd.confirm} onClick={changePwd} className="flex-1 h-10 rounded-md bg-[#FF6B1A] hover:bg-[#FF7E33] text-white text-[12px] disabled:opacity-50 flex items-center justify-center gap-1.5">{savingPwd ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Lock className="w-3.5 h-3.5" />} Update password</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default ProfileSettings;
