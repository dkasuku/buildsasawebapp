// Shared by the client app and the contractor's "Client" tab. Stage keys match
// STAGES in backend/src/client-routes.js.
import { http } from "../../../services/api";

export const STAGES: { key: string; label: string; hint: string }[] = [
  { key: "land_purchase", label: "Land purchase & title", hint: "Search, sale agreement, transfer, title deed" },
  { key: "survey", label: "Survey & beaconing", hint: "Surveyor visit, beacons placed and checked" },
  { key: "clearing", label: "Land clearing & preparation", hint: "Bush clearing, levelling, site setup" },
  { key: "fencing", label: "Fencing", hint: "Posts, chain-link, wall or live fence" },
  { key: "gate", label: "Gate installation", hint: "Gate fabrication and fitting" },
  { key: "water", label: "Borehole & water", hint: "Drilling, pump, tanks, connection" },
  { key: "foundation", label: "Foundation", hint: "Excavation, footings, slab" },
  { key: "walling", label: "Walling", hint: "Walls, columns, beams, lintels" },
  { key: "roofing", label: "Roofing", hint: "Trusses, sheets or tiles, gutters" },
  { key: "services", label: "Plumbing & electrical", hint: "Pipes, wiring, fittings" },
  { key: "finishes", label: "Finishes & interiors", hint: "Plaster, tiles, paint, doors, kitchen" },
  { key: "solar", label: "Solar installation", hint: "Panels, inverter, batteries, solar water heater" },
  { key: "cctv", label: "CCTV & security", hint: "Cameras, alarm, electric fence" },
  { key: "landscaping", label: "Landscaping & gardening", hint: "Compound, lawn, paving, trees" },
  { key: "garbage", label: "Garbage & clean-up", hint: "Debris removal, garbage collection" },
  { key: "handover", label: "Handover", hint: "Final walk-through, keys, documents" },
  { key: "other", label: "Other", hint: "Anything else on the site" },
];
export const stageLabel = (k: string) => STAGES.find((s) => s.key === k)?.label || "Other";

// What companies on Buildsasa offer, and what a client can post a job for.
export const SERVICES = [
  "Land sales & agents", "Surveying & beaconing", "Land clearing", "Fencing", "Gates & metal works",
  "Borehole drilling & water", "Building construction", "Renovation & remodeling", "Roofing", "Plumbing",
  "Electrical", "Solar installation", "CCTV & security systems", "Landscaping & gardening", "Garbage collection",
  "Interiors & finishes", "Roads & civil works", "Architecture & design", "Quantity surveying", "Other",
];

export const UPDATE_KINDS: { key: string; label: string }[] = [
  { key: "progress", label: "Progress" },
  { key: "inspection", label: "Inspection" },
  { key: "milestone", label: "Milestone reached" },
  { key: "issue", label: "Issue or delay" },
];

export type Media = { url: string; type: "image" | "video" };
export type ClientUpdate = { id: string; stage: string; kind: string; title: string; body?: string | null; media: Media[]; authorName?: string | null; authorRole?: string | null; createdAt: string };
export type ClientMessage = { id: string; senderType: "client" | "team" | "buildsasa"; senderName: string; body?: string | null; media: Media[]; createdAt: string };
export type Trust = { score: number | null; parts: { logs: number | null; handover: number | null; rating: number | null }; basis: string[]; ratingAvg: number | null; ratingCount: number; handedOver: number; logDays30: number };
export type Company = { id: string; name: string; logoUrl?: string | null; phone?: string | null; email?: string | null; address?: string | null; services: string[]; about?: string | null; projects: number; trust: Trust; myRating: number | null };
export type Reporting = {
  id: string; siteName: string; location: string; projectId?: string | null; stages: string[]; notes?: string | null;
  projectCostKES: number; months: number; feePercent: number; monthlyFeeKES: number; status: string;
  inspectorName?: string | null; adminNote?: string | null; paidMonths: number; createdAt: string;
};
export type ClientHome = {
  user: { name: string; email: string; phone?: string | null; country?: string | null };
  projects: { id: string; name: string; city: string; status: string; progress: number; startDate?: string | null; targetEndDate?: string | null; cover?: string | null; company: { name: string; logoUrl?: string | null; phone?: string | null; email?: string | null } | null; lastUpdate: { title: string; stage: string; createdAt: string } | null }[];
  todo: { kind: string; projectId?: string; reportingId?: string; label: string }[];
  reporting: Reporting[];
  jobs: { id: string; title: string; category: string; location?: string | null; status: string; approval: string; bidCount: number; createdAt: string }[];
};
export type ClientSite = any; // portal payload + updates, dailyLogs, inspections (see /api/client/projects/:id)

export const toMedia = (urls: string[]): Media[] => urls.map((url) => ({ url, type: /\.(mp4|mov|webm|m4v|3gp)(\?|$)/i.test(url) ? "video" : "image" }));

const j = (body: unknown) => ({ method: "POST", body: JSON.stringify(body) });
export const clientApi = {
  home: () => http<ClientHome>("/api/client/home"),
  updateMe: (p: { name?: string; phone?: string; country?: string }) => http("/api/client/me", { method: "PUT", body: JSON.stringify(p) }),
  site: (id: string) => http<ClientSite>(`/api/client/projects/${id}`),
  siteMessages: (id: string) => http<ClientMessage[]>(`/api/client/projects/${id}/messages`),
  sendSiteMessage: (id: string, body: string, media: Media[]) => http<ClientMessage>(`/api/client/projects/${id}/messages`, j({ body, media })),
  companies: () => http<Company[]>("/api/client/companies"),
  postJob: (p: Record<string, unknown>) => http("/api/client/jobs", j(p)),
  jobBids: (id: string) => http<any[]>(`/api/client/jobs/${id}/bids`),
  awardBid: (jobId: string, bidId: string) => http(`/api/client/jobs/${jobId}/bids/${bidId}/award`, j({})),
  rateCompany: (id: string, stars: number, comment?: string) => http(`/api/client/companies/${id}/rating`, j({ stars, comment })),
  companyTrust: () => http<Trust & { reviews: { clientName: string; stars: number; comment?: string | null; updatedAt: string }[]; listed: boolean }>("/api/company/trust"),
  requestReporting: (p: Record<string, unknown>) => http<Reporting>("/api/client/reporting", j(p)),
  reporting: (id: string) => http<Reporting & { updates: ClientUpdate[]; payments: any[] }>(`/api/client/reporting/${id}`),
  reportingMessages: (id: string) => http<ClientMessage[]>(`/api/client/reporting/${id}/messages`),
  sendReportingMessage: (id: string, body: string, media: Media[]) => http<ClientMessage>(`/api/client/reporting/${id}/messages`, j({ body, media })),
  payReporting: (id: string, months: number) => http<{ authorizationUrl: string }>(`/api/client/reporting/${id}/pay`, j({ months })),
  verifyReporting: (reference: string) => http<{ ok: boolean }>("/api/client/reporting/verify", j({ reference })),

  // Contractor side
  projectClients: (pid: string) => http<{ id: string; email: string; name?: string | null; joined: boolean }[]>(`/api/projects/${pid}/clients`),
  inviteClient: (pid: string, email: string, name?: string) => http<{ id: string; email: string; name?: string | null; joined: boolean }>(`/api/projects/${pid}/clients`, j({ email, name })),
  removeClient: (pid: string, id: string) => http(`/api/projects/${pid}/clients/${id}`, { method: "DELETE" }),
  projectUpdates: (pid: string) => http<ClientUpdate[]>(`/api/projects/${pid}/client-updates`),
  postUpdate: (pid: string, p: { stage: string; kind: string; title: string; body?: string; media: Media[] }) => http<ClientUpdate>(`/api/projects/${pid}/client-updates`, j(p)),
  deleteUpdate: (pid: string, id: string) => http(`/api/projects/${pid}/client-updates/${id}`, { method: "DELETE" }),
  projectMessages: (pid: string) => http<ClientMessage[]>(`/api/projects/${pid}/client-messages`),
  sendProjectMessage: (pid: string, body: string, media: Media[]) => http<ClientMessage>(`/api/projects/${pid}/client-messages`, j({ body, media })),
  shareInspection: (id: string, visible: boolean) => http(`/api/inspections/${id}/client-visible`, j({ visible })),
};

export const kes = (n: number) => `KES ${Math.round(Number(n) || 0).toLocaleString("en-KE")}`;
export const when = (d: string) => new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
