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

export function getMember(id: string) {
  return TEAM_MEMBERS.find((m) => m.id === id);
}

export function getMemberColor(id: string) {
  const m = getMember(id);
  return m ? ROLE_COLORS[m.role] : "#5B6675";
}

export function getMemberInitials(id: string) {
  const m = getMember(id);
  return m?.initials ?? "?";
}
