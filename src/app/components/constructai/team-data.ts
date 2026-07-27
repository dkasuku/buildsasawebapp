import type { Role } from "./roles";
import { ROLE_COLORS } from "./roles";

export type TeamMember = {
  id: string;
  name: string;
  role: Role;
  initials: string;
  phone?: string;
  online?: boolean;
  lastSeen?: string;
};

export const TEAM_MEMBERS: TeamMember[] = [
  { id: "u-contractor", name: "Marcus Rivera", role: "Contractor", initials: "MR", phone: "+254 722 001 001", online: true },
  { id: "u-pm", name: "Sarah Patel", role: "Project Manager", initials: "SP", phone: "+254 722 002 002", online: true },
  { id: "u-architect", name: "James Chen", role: "Architect", initials: "JC", phone: "+254 722 003 003", online: false, lastSeen: "10m ago" },
  { id: "u-qs", name: "Amina Osei", role: "Quantity Surveyor", initials: "AO", phone: "+254 722 004 004", online: true },
  { id: "u-exec", name: "Jane Cho", role: "Executive", initials: "JC", phone: "+254 722 005 005", online: false, lastSeen: "2h ago" },
  { id: "u-super", name: "David Kimani", role: "Superintendent", initials: "DK", phone: "+254 722 006 006", online: true },
  { id: "u-trade-e", name: "Mike Torres", role: "Trade Lead", initials: "MT", phone: "+254 722 007 007", online: false, lastSeen: "1h ago" },
  { id: "u-trade-p", name: "Grace Wanjiku", role: "Trade Lead", initials: "GW", phone: "+254 722 008 008", online: true },
  { id: "u-worker-1", name: "John Mwangi", role: "Worker", initials: "JM", phone: "+254 722 009 009", online: false, lastSeen: "3h ago" },
  { id: "u-worker-2", name: "Fatima Ali", role: "Worker", initials: "FA", phone: "+254 722 010 010", online: true },
  { id: "u-owner", name: "Robert Ochieng", role: "Owner", initials: "RO", phone: "+254 722 011 011", online: false, lastSeen: "Yesterday" },
];

// These three resolve a user id for display (avatar colour + initials).
//
// They used to look the id up in the TEAM_MEMBERS demo roster only. Real user ids
// never match it, so every avatar rendered grey with "?" initials once the demo
// data stopped being used. They now consult the live invited team first, and fall
// back to deriving a stable colour and initials from the id itself rather than
// giving up.
import { teamCache } from "./useTeam";

const AVATAR_FALLBACK = ["#FF6B1A", "#3B82F6", "#22C55E", "#8B5CF6", "#F5A623", "#06B6D4", "#EF4444"];

export function getMember(id: string) {
  return teamCache().find((m) => m.id === id) ?? TEAM_MEMBERS.find((m) => m.id === id);
}

export function getMemberColor(id: string) {
  const m = getMember(id);
  if (m && (ROLE_COLORS as Record<string, string>)[m.role]) return (ROLE_COLORS as Record<string, string>)[m.role];
  if (!id) return "#5B6675";
  // Stable per-id colour, so the same person is always the same colour.
  const n = Array.from(id).reduce((a, c) => a + c.charCodeAt(0), 0);
  return AVATAR_FALLBACK[n % AVATAR_FALLBACK.length];
}

export function getMemberInitials(id: string) {
  const m = getMember(id);
  if (m?.initials) return m.initials;
  if (m?.name) {
    return m.name.split(" ").filter(Boolean).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  }
  return "?";
}
