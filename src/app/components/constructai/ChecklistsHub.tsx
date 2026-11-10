// Checklists and the trade-assignment view of them, behind one sidebar entry.
// "Tasks & Trades" was always a second view over the same checklist records
// (who has which checklist, progress by trade), so it is a tab here now.
import { useState } from "react";
import type { Role } from "./roles";
import { ROLES } from "./roles";
import type { ChecklistTemplateDto } from "../../services/api";
import Checklists from "./Checklists";
import { Tasks } from "./Tasks";
import { SectionTabs } from "./SectionTabs";
import Inspections from "./Inspections";
import SafetyIncidents from "./SafetyIncidents";

// Inspections and Safety are part of Checklists (idea.md R7), not pages of their own.
type Tab = "checklists" | "assignments" | "inspections" | "safety";

export function ChecklistsHub({ role, initialTab = "checklists", aiDraft, onConsumeAiDraft }: {
  role: Role;
  initialTab?: Tab;
  aiDraft?: ChecklistTemplateDto | null;
  onConsumeAiDraft?: () => void;
}) {
  const canSeeAssignments = (ROLES[role]?.views || []).includes("tasks");
  const [tab, setTab] = useState<Tab>(canSeeAssignments || initialTab !== "assignments" ? initialTab : "checklists");
  return (
    <div>
      <SectionTabs<Tab>
        title="Checklists"
        subtitle="Quality checks, inspections and safety, filled on site."
        tabs={[{ key: "checklists", label: "Checklists" }, { key: "inspections", label: "Inspections" }, { key: "safety", label: "Safety" }, ...(canSeeAssignments ? [{ key: "assignments" as Tab, label: "By trade" }] : [])]}
        value={tab}
        onChange={setTab}
      />
      {tab === "checklists" ? <Checklists role={role} aiDraft={aiDraft} onConsumeAiDraft={onConsumeAiDraft} />
        : tab === "inspections" ? <Inspections role={role} />
        : tab === "safety" ? <SafetyIncidents role={role} />
        : <Tasks role={role} />}
    </div>
  );
}
