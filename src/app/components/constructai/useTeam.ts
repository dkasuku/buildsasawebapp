// ============================================================================
// useTeam — single source of truth for "who can be assigned".
// Fetches the REAL invited users from the backend (api.getUsers) so assignment
// pickers show the actual team, not the static demo roster. A module-level
// cache lets name-resolution work anywhere (including legacy/seed ids, which
// fall back to the demo roster).
// ============================================================================

import { useState, useEffect } from "react";
import api from "../../services/api";

export type TeamMemberLite = { id: string; name: string; role: string; email?: string; phone?: string; initials?: string };

function initialsOf(name: string) {
  return (name || "")
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

let _cache: TeamMemberLite[] | null = null;
let _inflight: Promise<TeamMemberLite[]> | null = null;
const _subscribers = new Set<(m: TeamMemberLite[]) => void>();

async function fetchTeam(force = false): Promise<TeamMemberLite[]> {
  if (_cache && !force) return _cache;
  if (_inflight && !force) return _inflight;
  _inflight = api
    .getUsers()
    .then((users: any[]) => {
      const list: TeamMemberLite[] = (users || []).map((u) => ({
        id: u.id,
        name: u.name,
        role: u.role,
        email: u.email,
        phone: u.phone || undefined,
        initials: initialsOf(u.name),
      }));
      _cache = list;
      _subscribers.forEach((fn) => fn(list));
      return list;
    })
    .catch(() => {
      _cache = _cache || [];
      return _cache;
    })
    .finally(() => {
      _inflight = null;
    });
  return _inflight;
}

// React hook: returns the live team list (real users), refetched on mount.
export function useTeam(): TeamMemberLite[] {
  const [members, setMembers] = useState<TeamMemberLite[]>(_cache || []);
  useEffect(() => {
    let alive = true;
    const update = (m: TeamMemberLite[]) => { if (alive) setMembers(m); };
    _subscribers.add(update);
    fetchTeam().then(update);
    return () => { alive = false; _subscribers.delete(update); };
  }, []);
  return members;
}

// Force a refresh (e.g. after inviting/removing a teammate).
export function refreshTeam() { return fetchTeam(true); }

// Resolve an id → display name from the REAL invited users.
//
// This used to fall back to the static demo roster, so a record referencing a
// seed id like "u-pm" rendered as "Sarah Patel" — confidently naming someone who
// does not exist in the workspace. An unresolved id is now shown as such, which
// is less tidy but never misleading.
export function resolveName(id: string): string {
  if (!id) return "";
  const hit = (_cache || []).find((m) => m.id === id);
  if (hit) return hit.name;
  // Looks like a real user id we simply have not loaded yet.
  return _cache === null ? id : `Unknown (${id})`;
}

/** The live team cache, for helpers that cannot use a hook (see team-data.ts). */
export function teamCache(): TeamMemberLite[] { return _cache || []; }
