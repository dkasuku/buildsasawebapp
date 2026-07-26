// One source of truth for "which projects can I link this to?".
//
// Every module that linked to a project had its own hardcoded <option> list —
// "Westside Tower", "Riverside Mall", "Hilltop Residences" — none of which were
// real. Whatever you picked was saved as a name that matched no project, so the
// link went nowhere. This hook loads the workspace's actual projects once and
// caches them, so all those dropdowns show what the user actually created.
import { useCallback, useEffect, useState } from "react";
import api, { type ProjectDto } from "../../services/api";

export type ProjectOption = { id: string; name: string; code: string; status: string };

// Module-level cache. Several modules mount at once (and remount on navigation);
// without this each one refetched the same list on every visit.
let cache: ProjectOption[] | null = null;
let inFlight: Promise<ProjectOption[]> | null = null;
const subscribers = new Set<(list: ProjectOption[]) => void>();

const toOption = (p: ProjectDto): ProjectOption => ({
  id: p.id,
  name: p.name,
  code: p.code,
  status: p.status,
});

async function load(force = false): Promise<ProjectOption[]> {
  if (!force && cache) return cache;
  if (!force && inFlight) return inFlight;
  inFlight = api.getProjects()
    .then((rows) => {
      cache = (rows ?? []).map(toOption);
      subscribers.forEach((fn) => fn(cache!));
      return cache;
    })
    .catch(() => {
      // Backend unreachable. Return an empty list rather than inventing demo
      // projects — a dropdown that offers projects which do not exist is worse
      // than one that says there are none yet.
      cache = cache ?? [];
      return cache;
    })
    .finally(() => { inFlight = null; });
  return inFlight;
}

/** Invalidate the cache after a project is created, renamed or deleted. */
export function refreshProjects() {
  return load(true);
}

export function useProjects() {
  const [projects, setProjects] = useState<ProjectOption[]>(cache ?? []);
  const [loading, setLoading] = useState(!cache);

  useEffect(() => {
    let alive = true;
    subscribers.add(setProjects);
    load().then((list) => { if (alive) { setProjects(list); setLoading(false); } });
    return () => { alive = false; subscribers.delete(setProjects); };
  }, []);

  const byId = useCallback((id?: string | null) => projects.find((p) => p.id === id) || null, [projects]);
  // Legacy rows stored only the display name; resolve those too so an existing
  // record still highlights the right option in the dropdown.
  const byName = useCallback((name?: string | null) => projects.find((p) => p.name === name) || null, [projects]);
  const resolve = useCallback(
    (idOrName?: string | null) => (idOrName ? byId(idOrName) || byName(idOrName) : null),
    [byId, byName],
  );

  return { projects, loading, byId, byName, resolve, refresh: refreshProjects };
}
