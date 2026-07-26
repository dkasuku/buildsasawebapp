// A project <select> that lists the workspace's real projects.
//
// Drop-in replacement for the hardcoded dropdowns that used to offer demo names.
// It reports BOTH the id and the name on change, because the modules behind it
// store the display name for presentation and the id for the durable link.
import { useProjects } from "./useProjects";

export function ProjectSelect({
  value,
  onChange,
  className,
  allowNone = false,
  noneLabel = "No project",
  disabled,
  id,
}: {
  /** The selected project id, or a legacy stored project NAME. */
  value?: string | null;
  onChange: (selection: { id: string; name: string } | null) => void;
  className?: string;
  allowNone?: boolean;
  noneLabel?: string;
  disabled?: boolean;
  id?: string;
}) {
  const { projects, loading, resolve } = useProjects();
  const selected = resolve(value);
  const base = className ?? "w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-lg px-2 text-[13px] text-white focus:outline-none focus:border-[#FF6B1A]";

  // No projects yet: say so plainly instead of showing an empty box the user
  // will read as a broken control.
  if (!loading && projects.length === 0) {
    return (
      <select id={id} className={base} disabled title="Create a project first — it will then be selectable here">
        <option>No projects yet — create one first</option>
      </select>
    );
  }

  return (
    <select
      id={id}
      className={base}
      disabled={disabled || loading}
      // A stored name that no longer matches any project must not silently show
      // the first option as if it were the saved value.
      value={selected?.id ?? ""}
      onChange={(e) => {
        const hit = projects.find((p) => p.id === e.target.value);
        onChange(hit ? { id: hit.id, name: hit.name } : null);
      }}
    >
      {loading && <option value="">Loading projects…</option>}
      {!loading && (allowNone || !selected) && (
        <option value="">{allowNone ? noneLabel : "Select a project…"}</option>
      )}
      {projects.map((p) => (
        <option key={p.id} value={p.id}>{p.code ? `${p.code} · ${p.name}` : p.name}</option>
      ))}
    </select>
  );
}

export default ProjectSelect;
