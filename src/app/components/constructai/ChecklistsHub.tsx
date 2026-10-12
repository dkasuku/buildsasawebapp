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

type Tab = "checklists" | "assignments";

export function ChecklistsHub({ role, initialTab = "checklists", aiDraft, onConsumeAiDraft }: {
  role: Role;
  initialTab?: Tab;
  aiDraft?: ChecklistTemplateDto | null;
  onConsumeAiDraft?: () => void;
}) {
  const canSeeAssignments = (ROLES[role]?.views || []).includes("tasks");
  const [tab, setTab] = useState<Tab>(canSeeAssignments ? initialTab : "checklists");
  return (
    <div>
      {canSeeAssignments && (
        <SectionTabs<Tab>
          tabs={[{ key: "checklists", label: "Checklists" }, { key: "assignments", label: "Assignments by trade" }]}
          value={tab}
          onChange={setTab}
        />
      )}
      {tab === "checklists"
        ? <Checklists role={role} aiDraft={aiDraft} onConsumeAiDraft={onConsumeAiDraft} />
        : <Tasks role={role} />}
    </div>
  );
}
