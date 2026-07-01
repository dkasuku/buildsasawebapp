// ============================================================================
// First-run guided setup
// ----------------------------------------------------------------------------
// Shown once to workspace owners / managers. Walks them through the three
// things that make the app useful on day one: create a project, invite a
// teammate, and open the AI checklist tool. Everything here is optional —
// each step can be skipped, and the whole flow can be dismissed.
// ============================================================================

import { useState } from "react";
import { toast } from "sonner";
import { FolderKanban, UserPlus, ClipboardList, Check, ArrowRight, X, Sparkles, Mail } from "lucide-react";
import type { Role } from "./roles";
import { ROLES, ROLE_DESCRIPTIONS } from "./roles";
import type { View } from "./Sidebar";
import api from "../../services/api";

const ALL_ROLES = Object.keys(ROLES) as Role[];

type Props = {
  role: Role;
  onNavigate: (v: View) => void;
  onClose: () => void;
};

export function Onboarding({ role, onNavigate, onClose }: Props) {
  const [step, setStep] = useState(0);
  const [projectDone, setProjectDone] = useState(false);
  const [inviteDone, setInviteDone] = useState(false);

  // Step 1 — project
  const [pName, setPName] = useState("");
  const [pCity, setPCity] = useState("");
  const [pValue, setPValue] = useState("");
  const [savingProject, setSavingProject] = useState(false);

  // Step 2 — invite
  const [iName, setIName] = useState("");
  const [iEmail, setIEmail] = useState("");
  const [iRole, setIRole] = useState<Role>("Site Engineer");
  const [savingInvite, setSavingInvite] = useState(false);
  const [inviteNote, setInviteNote] = useState<string>("");
  const [inviteEmailed, setInviteEmailed] = useState(false);

  const canManageTeam = ROLES[role].manageTeam || ROLES[role].isWorkspaceOwner;

  const createProject = async () => {
    if (!pName.trim()) return toast.error("Give your project a name");
    setSavingProject(true);
    try {
      const code = "P-" + Math.random().toString(36).slice(2, 6).toUpperCase();
      await api.createProject({
        code,
        name: pName.trim(),
        city: pCity.trim() || "Nairobi",
        value: pValue.trim() || "0",
        status: "Active",
        progress: 0,
        exposure: "0",
      });
      setProjectDone(true);
      toast.success("Project created");
      setStep(2);
    } catch (e: any) {
      toast.error(e?.message || "Could not create the project");
    } finally {
      setSavingProject(false);
    }
  };

  const sendInvite = async () => {
    if (!iName.trim() || !iEmail.trim()) return toast.error("Name and email are required");
    setSavingInvite(true);
    try {
      const r: any = await api.inviteUser({ name: iName.trim(), email: iEmail.trim(), role: iRole });
      setInviteDone(true);
      setInviteEmailed(!!r?.emailed);
      if (r?.emailed) {
        setInviteNote(`We emailed an invite with sign-in instructions to ${r.user.email}.`);
        toast.success("Invite sent");
      } else if (r?.tempPassword) {
        setInviteNote(`Share these details with ${r.user.email} — email: ${r.user.email}, temporary password: ${r.tempPassword}`);
        toast.success("Member added");
      } else {
        setInviteNote(`Invite created for ${r.user.email}.`);
        toast.success("Member added");
      }
      setStep(3);
    } catch (e: any) {
      toast.error(e?.message || "Invite failed");
    } finally {
      setSavingInvite(false);
    }
  };

  const finish = (go?: View) => {
    onClose();
    if (go) onNavigate(go);
  };

  const input = "w-full h-10 bg-[#0A0E14] border border-[#222A35] rounded-md px-3 text-[13px] text-white focus:outline-none focus:border-[#FF6B1A]";
  const label = "text-[11px] text-[#8A95A5] uppercase tracking-wider";

  const totalSteps = canManageTeam ? 3 : 2;
  const shownStep = Math.min(step, totalSteps);

  return (
    <div className="fixed inset-0 z-[70] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-lg rounded-2xl border border-[#222A35] bg-[#11161D] overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-[#222A35] flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl overflow-hidden flex items-center justify-center">
              <img src="/Buildsasa.png" alt="Buildsasa" className="w-full h-full object-cover" />
            </div>
            <div>
              <div className="text-[15px] text-white font-display">Welcome to Buildsasa</div>
              <div className="text-[11px] text-[#8A95A5]">Let's get your workspace ready in a minute.</div>
            </div>
          </div>
          <button onClick={() => finish()} className="text-[#5B6675] hover:text-white" title="Skip setup"><X className="w-4 h-4" /></button>
        </div>

        {/* Progress dots */}
        {step > 0 && (
          <div className="px-6 pt-4 flex items-center gap-2">
            {Array.from({ length: totalSteps }).map((_, i) => (
              <div key={i} className={`h-1 flex-1 rounded-full ${i < shownStep ? "bg-[#FF6B1A]" : "bg-[#222A35]"}`} />
            ))}
          </div>
        )}

        <div className="p-6">
          {/* Step 0 — welcome */}
          {step === 0 && (
            <div>
              <p className="text-[13px] text-[#C2CAD6] leading-relaxed">
                Buildsasa keeps your sites, checklists, and AI assistant in one place. We'll walk through three quick steps — you can skip any of them and come back later.
              </p>
              <div className="mt-5 space-y-2.5">
                <Row icon={FolderKanban} title="Create your first project" sub="The site you're managing." />
                {canManageTeam && <Row icon={UserPlus} title="Invite a teammate" sub="They log in with the role you assign." />}
                <Row icon={ClipboardList} title="Open the AI checklist tool" sub="Turn any form into a digital checklist." />
              </div>
              <div className="mt-6 flex gap-2">
                <button onClick={() => finish()} className="flex-1 h-11 rounded-md border border-[#222A35] text-[13px] text-[#8A95A5] hover:text-white">Skip for now</button>
                <button onClick={() => setStep(1)} className="flex-1 h-11 rounded-md bg-[#FF6B1A] hover:bg-[#FF7E33] text-white text-[13px] flex items-center justify-center gap-2">Get started <ArrowRight className="w-4 h-4" /></button>
              </div>
            </div>
          )}

          {/* Step 1 — create project */}
          {step === 1 && (
            <div>
              <div className="text-[13px] text-white font-display mb-1">Create your first project</div>
              <p className="text-[12px] text-[#8A95A5] mb-4">A project is a single site or job. You can add more anytime.</p>
              <div className="space-y-3">
                <div><div className={label}>Project name</div><input value={pName} onChange={(e) => setPName(e.target.value)} className={input} placeholder="e.g. Westlands Apartments" /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><div className={label}>City / location</div><input value={pCity} onChange={(e) => setPCity(e.target.value)} className={input} placeholder="Nairobi" /></div>
                  <div><div className={label}>Contract value (optional)</div><input value={pValue} onChange={(e) => setPValue(e.target.value)} className={input} placeholder="e.g. 12,000,000" /></div>
                </div>
              </div>
              <div className="mt-6 flex gap-2">
                <button onClick={() => setStep(canManageTeam ? 2 : 3)} className="h-11 px-4 rounded-md border border-[#222A35] text-[13px] text-[#8A95A5] hover:text-white">Skip</button>
                <button disabled={savingProject} onClick={createProject} className="flex-1 h-11 rounded-md bg-[#FF6B1A] hover:bg-[#FF7E33] text-white text-[13px] flex items-center justify-center gap-2 disabled:opacity-60">
                  {savingProject ? "Creating…" : "Create project"} <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* Step 2 — invite teammate */}
          {step === 2 && canManageTeam && (
            <div>
              <div className="text-[13px] text-white font-display mb-1">Invite a teammate</div>
              <p className="text-[12px] text-[#8A95A5] mb-4">They'll get a sign-in link by email. You can do this later from the Team page.</p>
              <div className="space-y-3">
                <div><div className={label}>Full name</div><input value={iName} onChange={(e) => setIName(e.target.value)} className={input} placeholder="e.g. John Mwangi" /></div>
                <div><div className={label}>Work email</div><input value={iEmail} onChange={(e) => setIEmail(e.target.value)} className={input} placeholder="name@company.co.ke" /></div>
                <div>
                  <div className={label}>Role</div>
                  <select value={iRole} onChange={(e) => setIRole(e.target.value as Role)} className={input}>
                    {ALL_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                  <div className="text-[10px] text-[#5B6675] mt-1">{ROLE_DESCRIPTIONS[iRole]}</div>
                </div>
              </div>
              <div className="mt-6 flex gap-2">
                <button onClick={() => setStep(3)} className="h-11 px-4 rounded-md border border-[#222A35] text-[13px] text-[#8A95A5] hover:text-white">Skip</button>
                <button disabled={savingInvite} onClick={sendInvite} className="flex-1 h-11 rounded-md bg-[#FF6B1A] hover:bg-[#FF7E33] text-white text-[13px] flex items-center justify-center gap-2 disabled:opacity-60">
                  {savingInvite ? "Sending…" : "Send invite"} <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* Step 3 — done */}
          {step >= 3 && (
            <div className="text-center">
              <div className="w-12 h-12 rounded-full bg-[#22C55E]/15 border border-[#22C55E]/30 flex items-center justify-center mx-auto">
                <Check className="w-6 h-6 text-[#22C55E]" />
              </div>
              <div className="text-[15px] text-white font-display mt-3">You're all set</div>
              <div className="mt-2 text-[12px] text-[#8A95A5] space-y-1">
                {projectDone && <div className="flex items-center justify-center gap-1.5"><Check className="w-3.5 h-3.5 text-[#22C55E]" /> First project created</div>}
                {inviteDone && <div className="flex items-center justify-center gap-1.5"><Check className="w-3.5 h-3.5 text-[#22C55E]" /> Teammate invited</div>}
              </div>
              {inviteNote && (
                <div className={`mt-3 p-3 rounded-lg border text-[11px] text-left flex items-start gap-2 ${inviteEmailed ? "bg-[#22C55E]/10 border-[#22C55E]/30 text-[#C2CAD6]" : "bg-[#0A0E14] border-[#222A35] text-[#C2CAD6]"}`}>
                  <Mail className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${inviteEmailed ? "text-[#22C55E]" : "text-[#8A95A5]"}`} />
                  <span>{inviteNote}</span>
                </div>
              )}
              <p className="mt-4 text-[12px] text-[#8A95A5]">Next: turn a paper form into a smart checklist with AI.</p>
              <div className="mt-5 flex gap-2">
                <button onClick={() => finish()} className="flex-1 h-11 rounded-md border border-[#222A35] text-[13px] text-[#8A95A5] hover:text-white">Go to dashboard</button>
                <button onClick={() => finish("checklists")} className="flex-1 h-11 rounded-md bg-[#FF6B1A] hover:bg-[#FF7E33] text-white text-[13px] flex items-center justify-center gap-2">
                  <Sparkles className="w-4 h-4" /> Open checklists
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ icon: Icon, title, sub }: { icon: any; title: string; sub: string }) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg bg-[#0A0E14] border border-[#222A35]">
      <div className="w-8 h-8 rounded-lg bg-[#161C24] border border-[#222A35] flex items-center justify-center shrink-0">
        <Icon className="w-4 h-4 text-[#FF6B1A]" />
      </div>
      <div className="min-w-0">
        <div className="text-[12.5px] text-white">{title}</div>
        <div className="text-[11px] text-[#5B6675]">{sub}</div>
      </div>
    </div>
  );
}
