import { useState } from "react";
import { Shield, Eye, EyeOff, Users, DollarSign, FileText, CheckCircle, XCircle, Info, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import type { Role, Permissions } from "./roles";
import { ROLES, ROLE_COLORS, ROLE_DESCRIPTIONS } from "./roles";

type EditableRole = Role & string;

const PERMISSION_LABELS: Record<keyof Permissions, { label: string; icon: any; description: string }> = {
  views: { label: "Module Access", icon: Eye, description: "Which navigation modules this role can see" },
  financials: { label: "View Financials", icon: DollarSign, description: "Access to budgets, ledger, and cost reports" },
  approveAny: { label: "Approve Any CO", icon: CheckCircle, description: "Can approve change orders without limit" },
  approveLimit: { label: "Approval Limit", icon: DollarSign, description: "Max dollar value this role can approve" },
  createCO: { label: "Create COs", icon: FileText, description: "Can create new change orders" },
  manageTeam: { label: "Manage Team", icon: Users, description: "Can add/remove team members and assign roles" },
  sharePlans: { label: "Share Plans", icon: FileText, description: "Can publish and distribute drawings" },
  viewReports: { label: "View Reports", icon: Eye, description: "Access to analytics and operational reports" },
  viewAuditTrail: { label: "Audit Trail", icon: Eye, description: "Can view approval history and change logs" },
  viewKanban: { label: "Kanban Board", icon: Eye, description: "Access to task boards and workflow views" },
  viewFieldApp: { label: "Field App", icon: Eye, description: "Can use mobile field capture and uploads" },
  assignTasks: { label: "Assign Tasks", icon: Users, description: "Can create and assign tasks to crews" },
  completeTasks: { label: "Complete Tasks", icon: CheckCircle, description: "Can mark tasks as done and upload proof" },
  isWorkspaceOwner: { label: "Workspace Owner", icon: Shield, description: "Full admin control over workspace settings" },
};

export function RoleManager({ role = "Contractor" }: { role?: Role }) {
  const isContractor = role === "Contractor";
  const [selectedRole, setSelectedRole] = useState<Role>("Contractor");
  const [roleData, setRoleData] = useState<Record<Role, Permissions>>({ ...ROLES });
  const [hasChanges, setHasChanges] = useState(false);

  const current = roleData[selectedRole];

  const toggleBool = (key: keyof Permissions, val: boolean | number | string[] | undefined) => {
    if (!isContractor) return toast.error("Only the Contractor can edit permissions");
    if (key === "views" || key === "approveLimit") return;
    setRoleData((prev) => ({
      ...prev,
      [selectedRole]: { ...prev[selectedRole], [key]: !prev[selectedRole][key as keyof Permissions] },
    }));
    setHasChanges(true);
  };

  const save = () => {
    toast.success(`Permissions updated for ${selectedRole}`);
    setHasChanges(false);
  };

  const reset = () => {
    setRoleData({ ...ROLES });
    setHasChanges(false);
    toast("Permissions reset to defaults");
  };

  return (
    <div className="px-4 sm:px-7 py-5 sm:py-6 max-w-[1100px]">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
        <div>
          <div className="text-[15px] text-white font-display">Role & Permission Manager</div>
          <div className="text-[11px] text-[#8A95A5]">
            {isContractor
              ? "Define what each team role can see and do. Changes apply immediately."
              : "View-only. Only the Contractor can edit role permissions."}
          </div>
        </div>
        {isContractor && hasChanges && (
          <div className="flex gap-2">
            <button onClick={reset} className="h-8 px-3 rounded-md border border-[#222A35] text-[12px] text-[#8A95A5] hover:text-white">
              Reset
            </button>
            <button onClick={save} className="h-8 px-3 rounded-md bg-[#FF6B1A] text-white text-[12px] flex items-center gap-1.5">
              <CheckCircle className="w-3.5 h-3.5" /> Save Changes
            </button>
          </div>
        )}
      </div>

      {/* Role hierarchy explainer */}
      <div className="rounded-xl border border-[#222A35] bg-[#11161D] p-4 mb-5">
        <div className="text-[12px] text-white font-display mb-2 flex items-center gap-2">
          <Info className="w-4 h-4 text-[#3B82F6]" /> Role Hierarchy & Responsibilities
        </div>
        <div className="text-[11px] text-[#8A95A5] space-y-1 leading-relaxed">
          <p><strong className="text-white">Contractor</strong> — Workspace owner. Full control over projects, finances, team, and permissions.</p>
          <p><strong className="text-white">Executive / Assistant</strong> — Helps the Contractor with change order approvals and team oversight within their configured limit.</p>
          <p><strong className="text-white">Project Manager</strong> — Runs day-to-day project operations. Can approve change orders within their configured limit. Does NOT manage workspace permissions.</p>
          <p><strong className="text-white">Architect</strong> — Design lead. Reviews plans, drawings, and field clarifications. No financial approval authority.</p>
          <p><strong className="text-white">Quantity Surveyor (QS)</strong> — Cost control specialist. Tracks BOQs, validates quantities, monitors budget variance. <strong className="text-[#FF6B1A]">NOT a Trade Lead</strong> — QS is office/cost-based, Trade Lead is field-based.</p>
          <p><strong className="text-white">Superintendent</strong> — Jobsite lead. Assigns daily tasks to Trade Leads and Workers. Uses mobile for field uploads.</p>
          <p><strong className="text-white">Trade Lead</strong> — Head of a sub-crew (Electrical, Plumbing, HVAC, etc.). Accepts tasks, manages their crew, uploads progress. <strong className="text-[#FF6B1A]">Different from QS</strong> — Trade Lead manages people on-site; QS manages numbers in the office.</p>
          <p><strong className="text-white">Worker</strong> — Tradesperson on-site. Mobile-first: views tasks, marks done, uploads photos.</p>
          <p><strong className="text-white">Owner</strong> — Client paying for the project. Views dashboard, approves major COs, reads reports. Read-only on most operational items.</p>
          <p><strong className="text-white">Viewer</strong> — External stakeholder (inspector, lender, consultant). Read-only access.</p>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-4">
        {/* Role selector */}
        <div className="w-full lg:w-[280px] shrink-0 rounded-xl border border-[#222A35] bg-[#11161D] overflow-hidden">
          <div className="px-4 py-3 border-b border-[#222A35]">
            <div className="text-[12px] text-white font-display">Select Role</div>
            <div className="text-[10px] text-[#5B6675]">{(Object.keys(ROLES) as Role[]).length} roles defined</div>
          </div>
          <div className="overflow-y-auto max-h-[480px]">
            {(Object.keys(ROLES) as Role[]).map((r) => (
              <button
                key={r}
                onClick={() => setSelectedRole(r)}
                className={`w-full text-left px-4 py-3 border-b border-[#222A35] hover:bg-[#161C24] transition flex items-center gap-3 ${selectedRole === r ? "bg-[#161C24]" : ""}`}
              >
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: ROLE_COLORS[r] }} />
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] text-white">{r}</div>
                  <div className="text-[10px] text-[#5B6675] truncate">{ROLE_DESCRIPTIONS[r]}</div>
                </div>
                {selectedRole === r && <CheckCircle className="w-4 h-4 text-[#FF6B1A] shrink-0" />}
              </button>
            ))}
          </div>
        </div>

        {/* Permission editor */}
        <div className="flex-1 rounded-xl border border-[#222A35] bg-[#11161D] overflow-hidden">
          <div className="px-5 py-4 border-b border-[#222A35] flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-[11px] font-medium" style={{ background: ROLE_COLORS[selectedRole] }}>
                {selectedRole.charAt(0)}
              </div>
              <div>
                <div className="text-[14px] text-white font-display">{selectedRole}</div>
                <div className="text-[11px] text-[#8A95A5]">{ROLE_DESCRIPTIONS[selectedRole]}</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-[10px] px-2 py-0.5 rounded border ${current.isWorkspaceOwner ? "bg-[#FF6B1A]/10 border-[#FF6B1A]/30 text-[#FF6B1A]" : "bg-[#222A35] text-[#8A95A5]"}`}>
                {current.isWorkspaceOwner ? "Workspace Owner" : "Team Member"}
              </span>
            </div>
          </div>

          <div className="p-5 space-y-4">
            {/* Module Access */}
            <div>
              <div className="text-[11px] text-[#5B6675] uppercase tracking-wider mb-2">Module Access ({current.views.length} modules)</div>
              <div className="flex flex-wrap gap-1.5">
                {current.views.map((v) => (
                  <span key={v} className="text-[10px] px-2 py-1 rounded bg-[#0A0E14] border border-[#222A35] text-[#8A95A5] capitalize">
                    {v.replace(/-/g, " ")}
                  </span>
                ))}
              </div>
            </div>

            {/* Permission toggles */}
            <div className="space-y-2">
              <div className="text-[11px] text-[#5B6675] uppercase tracking-wider">Permissions</div>
              {(Object.keys(PERMISSION_LABELS) as (keyof Permissions)[]).filter((k) => k !== "views" && k !== "approveLimit").map((key) => {
                const meta = PERMISSION_LABELS[key];
                const Icon = meta.icon;
                const val = current[key] as boolean;
                return (
                  <div key={key} className="flex items-center justify-between p-3 rounded-lg bg-[#0A0E14] border border-[#222A35]">
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-md flex items-center justify-center ${val ? "bg-[#FF6B1A]/10 text-[#FF6B1A]" : "bg-[#222A35] text-[#5B6675]"}`}>
                        <Icon className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="text-[12px] text-white">{meta.label}</div>
                        <div className="text-[10px] text-[#5B6675]">{meta.description}</div>
                      </div>
                    </div>
                    <button
                      onClick={() => toggleBool(key, val)}
                      className={`w-10 h-5 rounded-full transition relative ${val ? "bg-[#FF6B1A]" : "bg-[#222A35]"} ${!isContractor ? "opacity-50 cursor-not-allowed" : ""}`}
                      title={isContractor ? "Toggle permission" : "Read-only"}
                    >
                      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition ${val ? "left-5" : "left-0.5"}`} />
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Approval limit (special case) */}
            <div className="p-3 rounded-lg bg-[#0A0E14] border border-[#222A35]">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-md bg-[#222A35] flex items-center justify-center text-[#5B6675]">
                    <DollarSign className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-[12px] text-white">Approval Limit</div>
                    <div className="text-[10px] text-[#5B6675]">Max change order value this role can approve</div>
                  </div>
                </div>
                <div className="text-[14px] text-white font-medium">
                  {current.approveLimit === Infinity ? "∞ Unlimited" : `$${(current.approveLimit / 1000).toFixed(0)}k`}
                </div>
              </div>
            </div>

            {/* Warning if not contractor */}
            {!isContractor && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-[#EF4444]/10 border border-[#EF4444]/30">
                <AlertTriangle className="w-4 h-4 text-[#EF4444] shrink-0 mt-0.5" />
                <div className="text-[11px] text-[#EF4444]">You are viewing as <strong>{role}</strong>. Permission changes require Contractor access. Switch to Contractor role to edit.</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
