const API_URL = import.meta.env.VITE_API_URL || ":/http/localhost:5000";

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const token = localStorage.getItem("constructai-token");
  const isFormData = init?.body instanceof FormData;
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...(isFormData ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }
  return res.json() as Promise<T>;
}

export type ProjectDto = {
  id: string;
  code: string;
  name: string;
  city: string;
  lat?: number | null;
  lng?: number | null;
  value: string;
  status: string;
  progress: number;
  exposure: string;
  assignments?: { role: string; userId: string }[];
  changeOrderCount?: number;
};

export type ScheduleItemDto = {
  id: string;
  projectId: string;
  name: string;
  type: string; // task | milestone | phase
  startDate: string;
  endDate: string;
  percent: number;
  status: string; // not_started | in_progress | done | blocked
  assignees?: string | null;
  trade?: string | null;
  color?: string | null;
  notes?: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type ChangeOrderActivityDto = {
  id: string;
  changeOrderId: string;
  userId?: string | null;
  userName?: string | null;
  userRole?: string | null;
  type: string; // created | status | edited | comment
  fromStatus?: string | null;
  toStatus?: string | null;
  message?: string | null;
  createdAt: string;
};

export type MessageDto = {
  id: string;
  text: string;
  attachment?: string | null;
  createdAt: string;
  user?: { id: string; name: string; role: string };
};

export type LedgerEntryDto = {
  id: string;
  date: string;
  desc: string;
  type: "in" | "out";
  category: string;
  amountUSD: number;
};

export type ExpenseDto = {
  id: string;
  name: string;
  budgetUSD: number;
  actualUSD: number;
};

export type DailyLogDto = {
  id: string;
  date: string;
  crew: string;
  headcount: number;
  location: string;
  notes: string;
};

export type PunchDto = {
  id: string;
  code: string;
  area: string;
  desc: string;
  status: string;
  photos?: string | null;
  videos?: string | null;
  assignedTo?: string | null;
  location?: string | null;
  drawingRef?: string | null;
  linkedTaskId?: string | null;
};

export type CommitmentDto = {
  id: string;
  vendor: string;
  scope: string;
  amount: string;
  due: string;
};

export type DocumentDto = {
  id: string;
  name: string;
  url: string;
  size: string;
  updated: string;
  projectId?: string | null;
};

export type BidDto = {
  id: string;
  subcontractor: string;
  trade: string;
  amount: number;
  status: string;
  notes?: string | null;
  fileUrl?: string | null;
  submittedAt: string;
  projectId: string;
};

export type InvoiceDto = {
  id: string;
  invoiceNumber: string;
  clientName: string;
  amount: number;
  status: string;
  issueDate: string;
  dueDate: string;
  items?: string | null;
  notes?: string | null;
  paidDate?: string | null;
  paidAmount?: number | null;
  projectId: string;
};

export type InspectionDto = {
  id: string;
  type: string;
  inspector: string;
  date: string;
  status: string; // draft | pending_consultant | in_review | approved | rejected | rework_required | closed
  notes?: string | null;
  checklist?: string | null;
  photos?: string | null;
  videos?: string | null;
  readinessPhotos?: string | null;
  assignedTo?: string | null;
  createdBy?: string | null;
  checklistId?: string | null;
  templateId?: string | null;
  drawingRef?: string | null;
  projectId: string;
  approvals?: InspectionApprovalDto[];
  createdAt?: string;
};

export type InspectionApprovalDto = {
  id: string;
  status: string; // approved | rejected | rework_required
  comments?: string | null;
  approvedBy: string;
  inspectionId: string;
  createdAt: string;
};

export type SafetyIncidentDto = {
  id: string;
  date: string;
  incidentType: string;
  severity: string;
  description: string;
  reporter: string;
  witnesses?: string | null;
  correctiveAction?: string | null;
  status: string;
  projectId: string;
};

export type EquipmentDto = {
  id: string;
  name: string;
  category: string;
  serialNumber?: string | null;
  manufacturer?: string | null;
  purchaseDate?: string | null;
  status: string;
  lastService?: string | null;
  nextService?: string | null;
  location?: string | null;
  notes?: string | null;
  projectId?: string | null;
};

export type ChecklistItemDto = {
  id: string;
  title: string;
  description?: string;
  assignedTo?: string[];
  interval?: string;
  dueTime?: string;
  status?: string;
};

export type AttendanceDto = {
  id: string;
  userId: string;
  date: string;
  checkIn?: string | null;
  checkOut?: string | null;
  location?: string | null;
  breakStart?: string | null;
  breakEnd?: string | null;
  breakDuration?: number | null;
  status: string;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ChecklistTemplateDto = {
  id: string;
  title: string;
  trade: string;
  category?: string | null;
  items: string; // JSON string of checklist question items
  version?: number;
  isGlobal?: boolean;
  status?: string;
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ChecklistQuestionDto = {
  id: string;
  question: string;
  questionType: string;
  required: boolean;
  position: number;
  options?: string | null; // JSON array for dropdown/checkbox
  parentId?: string | null;
  checklistId: string;
  // Extra fields carried from the upload template.
  questionGroup?: string | null;
  defaultAnswer?: string | null;
  photoAvailable?: string | null;
  correctiveOption?: string | null;
  correctiveActions?: string | null; // JSON array
  policy?: string | null;
};

export type ChecklistResponseDto = {
  id: string;
  value: string;
  status?: string;
  reviewNote?: string | null;
  reviewerId?: string | null;
  checklistId: string;
  questionId: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
};

export type ChecklistDto = {
  id: string;
  title: string;
  description?: string | null;
  category?: string | null;
  trade?: string | null;
  reportedProgress?: number | null; // contractor self-reported field % (0-100)
  source: string;
  status: string; // draft | assigned | in_progress | submitted | approved | rejected
  assigned: boolean;
  assignee?: string | null;
  assignedTo?: string | null; // JSON array string
  createdBy?: string | null;
  submittedAt?: string | null;
  submittedBy?: string | null;
  templateId?: string | null;
  dueDate?: string | null;
  projectId?: string | null;
  createdAt: string;
  updatedAt: string;
  questions: ChecklistQuestionDto[];
  responses?: ChecklistResponseDto[];
};

export type ConversationMemberDto = {
  id: string;
  conversationId: string;
  userId: string;
  role: string;
  joinedAt: string;
};

export type ChatMessageDto = {
  id: string;
  text: string;
  attachment?: string | null;
  replyToId?: string | null;
  read: boolean;
  userId: string;
  conversationId: string;
  createdAt: string;
  taskId?: string | null;
  taskTitle?: string | null;
};

export type PlanMarkupDto = {
  id: string;
  drawingId: string;
  type: string;
  x: number;
  y: number;
  text?: string | null;
  color: string;
  createdBy: string;
  projectId: string;
  createdAt: string;
};

export type DrawingVersionDto = {
  id: string;
  drawingId: string;
  rev: number;
  url: string;
  uploadedBy?: string | null;
  projectId: string;
  createdAt: string;
};

export type ScheduledReportDto = {
  id: string;
  name: string;
  reportType: string;
  frequency: string;
  recipients: string;
  lastRunAt?: string | null;
  nextRunAt?: string | null;
  active: boolean;
  projectId?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type FormTemplateDto = {
  id: string;
  name: string;
  description?: string | null;
  category: string;
  source: string;
  fields: string;
  projectId?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ConversationDto = {
  id: string;
  name: string | null;
  type: string;
  profilePic?: string | null;
  creatorId?: string | null;
  createdAt: string;
  updatedAt: string;
  members: ConversationMemberDto[];
  messages: ChatMessageDto[];
};

export type UserProfile = {
  id: string;
  name: string;
  role: string;
  email: string;
  phone?: string | null;
  age?: number | null;
  gender?: string | null;
  qualifications?: string | null;
  emergencyContact?: string | null;
  emergencyPhone?: string | null;
  trade?: string | null;
  avatar?: string | null;
};

export type BillingInvoiceDto = {
  id: string;
  number: string;
  plan?: string | null;
  description?: string | null;
  amountUSD: number;
  amountKES: number;
  currency: string;
  status: string; // unpaid | paid | void
  issuedAt: string;
  dueDate: string;
  paidAt?: string | null;
  paystackRef?: string | null;
};

export const api = {
  login: (email: string, password: string) => http<{ token: string; user: any }>("/api/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  signup: (name: string, email: string, password: string, role?: string) => http<{ token: string; user: any }>("/api/signup", { method: "POST", body: JSON.stringify({ name, email, password, role }) }),
  me: () => http<UserProfile>("/api/me"),
  updateMe: (payload: Partial<Omit<UserProfile, "id" | "role" | "email">>) => http<UserProfile>("/api/me", { method: "PUT", body: JSON.stringify(payload) }),
  changePassword: (currentPassword: string, newPassword: string) => http<{ ok: boolean }>("/api/me/password", { method: "POST", body: JSON.stringify({ currentPassword, newPassword }) }),
  forgotPassword: (email: string) => http<{ ok: boolean; devLink?: string }>("/api/auth/forgot", { method: "POST", body: JSON.stringify({ email }) }),
  resetPassword: (token: string, password: string) => http<{ ok: boolean; email?: string }>("/api/auth/reset", { method: "POST", body: JSON.stringify({ token, password }) }),
  getUsers: () => http<any[]>("/api/users"),
  inviteUser: (payload: { name: string; email: string; role: string; trade?: string; password?: string }) => http<{ user: any; emailed?: boolean; tempPassword?: string }>("/api/users/invite", { method: "POST", body: JSON.stringify(payload) }),
  updateUserRole: (id: string, role: string) => http<any>(`/api/users/${id}/role`, { method: "PUT", body: JSON.stringify({ role }) }),
  removeUser: (id: string) => http(`/api/users/${id}`, { method: "DELETE" }),
  getAccessLogs: () => http<any[]>("/api/access-logs"),
  // Upload a file and get back a PERSISTENT url. Tries cloud (S3/R2) presigned
  // upload first, then falls back to the server's local-disk upload. Replaces
  // throwaway in-browser blob URLs so images survive reloads & other devices.
  uploadFile: async (file: File): Promise<string> => {
    try {
      const pres: any = await http("/api/upload/presign", { method: "POST", body: JSON.stringify({ filename: file.name, contentType: file.type || "application/octet-stream" }) });
      if (pres?.url && pres?.publicUrl) {
        const put = await fetch(pres.url, { method: "PUT", body: file, headers: { "Content-Type": file.type || "application/octet-stream" } });
        if (put.ok) return pres.publicUrl;
      }
    } catch { /* cloud not configured — fall back to local */ }
    const fd = new FormData();
    fd.append("file", file);
    const r: any = await http("/api/upload", { method: "POST", body: fd });
    const url: string = r?.url || "";
    return url.startsWith("http") ? url : `${API_URL}${url}`;
  },
  getProjects: () => http<ProjectDto[]>("/api/projects"),
  getProjectMessages: (projectId: string) => http<MessageDto[]>(`/api/projects/${projectId}/messages`),
  getProjectLedger: (projectId: string) => http<LedgerEntryDto[]>(`/api/projects/${projectId}/ledger`),
  getProjectExpenses: (projectId: string) => http<ExpenseDto[]>(`/api/projects/${projectId}/expenses`),
  createProject: (data: Partial<ProjectDto>) => http<ProjectDto>("/api/projects", { method: "POST", body: JSON.stringify(data) }),
  createAssignment: (projectId: string, role: string, userId: string) => http(`/api/projects/${projectId}/assignments`, { method: "POST", body: JSON.stringify({ role, userId }) }),
  createMessage: (projectId: string, text: string, attachment?: string) => http(`/api/projects/${projectId}/messages`, { method: "POST", body: JSON.stringify({ text, attachment }) }),
  createLedgerEntry: (projectId: string, payload: Omit<LedgerEntryDto, "id">) => http(`/api/projects/${projectId}/ledger`, { method: "POST", body: JSON.stringify(payload) }),
  createExpense: (projectId: string, payload: Omit<ExpenseDto, "id">) => http(`/api/projects/${projectId}/expenses`, { method: "POST", body: JSON.stringify(payload) }),
  updateProject: (projectId: string, data: Partial<ProjectDto>) => http<ProjectDto>(`/api/projects/${projectId}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteProject: (projectId: string) => http(`/api/projects/${projectId}`, { method: "DELETE" }),
  updateAssignment: (projectId: string, assignmentId: string, role: string, userId: string) => http(`/api/projects/${projectId}/assignments/${assignmentId}`, { method: "PUT", body: JSON.stringify({ role, userId }) }),
  deleteAssignment: (projectId: string, assignmentId: string) => http(`/api/projects/${projectId}/assignments/${assignmentId}`, { method: "DELETE" }),
  updateLedgerEntry: (projectId: string, entryId: string, payload: Partial<LedgerEntryDto>) => http(`/api/projects/${projectId}/ledger/${entryId}`, { method: "PUT", body: JSON.stringify(payload) }),
  deleteLedgerEntry: (projectId: string, entryId: string) => http(`/api/projects/${projectId}/ledger/${entryId}`, { method: "DELETE" }),
  updateExpense: (projectId: string, expenseId: string, payload: Partial<ExpenseDto>) => http(`/api/projects/${projectId}/expenses/${expenseId}`, { method: "PUT", body: JSON.stringify(payload) }),
  deleteExpense: (projectId: string, expenseId: string) => http(`/api/projects/${projectId}/expenses/${expenseId}`, { method: "DELETE" }),
  getDailyLog: (projectId: string) => http<DailyLogDto[]>(`/api/projects/${projectId}/daily-log`),
  createDailyLog: (projectId: string, payload: Partial<DailyLogDto>) => http<DailyLogDto>(`/api/projects/${projectId}/daily-log`, { method: "POST", body: JSON.stringify(payload) }),
  deleteDailyLog: (projectId: string, id: string) => http(`/api/projects/${projectId}/daily-log/${id}`, { method: "DELETE" }),
  getPunch: (projectId: string) => http<PunchDto[]>(`/api/projects/${projectId}/punch`),
  createPunch: (projectId: string, payload: Partial<PunchDto>) => http<PunchDto>(`/api/projects/${projectId}/punch`, { method: "POST", body: JSON.stringify(payload) }),
  updatePunch: (projectId: string, id: string, payload: Partial<PunchDto>) => http<PunchDto>(`/api/projects/${projectId}/punch/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  deletePunch: (projectId: string, id: string) => http(`/api/projects/${projectId}/punch/${id}`, { method: "DELETE" }),
  // Punch List (rich, item-centric)
  listPunch: (params?: { projectId?: string; status?: string; trade?: string; priority?: string; assignee?: string; q?: string }) => http<any[]>(`/api/punch?${new URLSearchParams((params || {}) as Record<string, string>).toString()}`),
  getPunchItem: (id: string) => http<any>(`/api/punch/${id}`),
  getDrawingPunch: (drawingId: string) => http<any[]>(`/api/drawings/${drawingId}/punch`),
  createPunchItem: (payload: any) => http<any>(`/api/punch`, { method: "POST", body: JSON.stringify(payload) }),
  updatePunchItem: (id: string, payload: any) => http<any>(`/api/punch/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  setPunchStatus: (id: string, status: string, role: string) => http<any>(`/api/punch/${id}/status`, { method: "POST", body: JSON.stringify({ status, role }) }),
  addPunchComment: (id: string, text: string) => http<any>(`/api/punch/${id}/comments`, { method: "POST", body: JSON.stringify({ text }) }),
  addPunchAttachment: (id: string, fileUrl: string, type?: string) => http<any>(`/api/punch/${id}/attachments`, { method: "POST", body: JSON.stringify({ fileUrl, type }) }),
  deletePunchItem: (id: string) => http(`/api/punch/${id}`, { method: "DELETE" }),
  // Change Orders
  listChangeOrders: (params?: { projectId?: string; status?: string }) => http<any[]>(`/api/change-orders?${new URLSearchParams((params || {}) as Record<string, string>).toString()}`),
  getProjectChangeOrders: (projectId: string) => http<any[]>(`/api/projects/${projectId}/change-orders`),
  getChangeOrder: (id: string) => http<any>(`/api/change-orders/${id}`),
  createChangeOrder: (payload: any) => http<any>(`/api/change-orders`, { method: "POST", body: JSON.stringify(payload) }),
  updateChangeOrder: (id: string, payload: any) => http<any>(`/api/change-orders/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  deleteChangeOrder: (id: string) => http(`/api/change-orders/${id}`, { method: "DELETE" }),
  getChangeOrderActivity: (id: string) => http<ChangeOrderActivityDto[]>(`/api/change-orders/${id}/activity`),
  addChangeOrderComment: (id: string, message: string) => http<{ ok: boolean }>(`/api/change-orders/${id}/activity`, { method: "POST", body: JSON.stringify({ message }) }),
  // Schedule (Gantt)
  getSchedule: (projectId: string) => http<ScheduleItemDto[]>(`/api/projects/${projectId}/schedule`),
  createScheduleItem: (projectId: string, payload: Partial<Omit<ScheduleItemDto, "assignees">> & { assignees?: string[] | string }) => http<ScheduleItemDto>(`/api/projects/${projectId}/schedule`, { method: "POST", body: JSON.stringify(payload) }),
  updateScheduleItem: (id: string, payload: Partial<Omit<ScheduleItemDto, "assignees">> & { assignees?: string[] | string }) => http<ScheduleItemDto>(`/api/schedule/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  deleteScheduleItem: (id: string) => http(`/api/schedule/${id}`, { method: "DELETE" }),
  generateSchedule: (projectId: string, payload: { prompt?: string; startDate?: string; durationWeeks?: number }, signal?: AbortSignal) => http<{ items: ScheduleItemDto[]; count: number }>(`/api/projects/${projectId}/schedule/generate`, { method: "POST", body: JSON.stringify(payload), signal }),
  // Billing / subscriptions (Paystack)
  getBillingPlans: () => http<{ plans: any[]; usdToKes: number; configured: boolean }>("/api/billing/plans"),
  getSubscription: () => http<any>("/api/billing/subscription"),
  billingCheckout: (planId: string, email?: string, currency?: string) => http<any>("/api/billing/checkout", { method: "POST", body: JSON.stringify({ planId, email, currency }) }),
  billingVerify: (reference: string) => http<any>("/api/billing/verify", { method: "POST", body: JSON.stringify({ reference }) }),
  getBillingInvoices: () => http<BillingInvoiceDto[]>("/api/billing/invoices"),
  payBillingInvoice: (id: string) => http<{ authorizationUrl?: string; reference?: string; demo?: boolean; message?: string; ok?: boolean; alreadyPaid?: boolean }>(`/api/billing/invoices/${id}/pay`, { method: "POST" }),
  markBillingInvoicePaid: (id: string) => http<{ ok: boolean }>(`/api/billing/invoices/${id}/mark-paid`, { method: "POST" }),
  getCommitments: (projectId: string) => http<CommitmentDto[]>(`/api/projects/${projectId}/commitments`),
  createCommitment: (projectId: string, payload: Partial<CommitmentDto>) => http<CommitmentDto>(`/api/projects/${projectId}/commitments`, { method: "POST", body: JSON.stringify(payload) }),
  updateCommitment: (projectId: string, id: string, payload: Partial<CommitmentDto>) => http<CommitmentDto>(`/api/projects/${projectId}/commitments/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  deleteCommitment: (projectId: string, id: string) => http(`/api/projects/${projectId}/commitments/${id}`, { method: "DELETE" }),
  getDocuments: () => http<DocumentDto[]>(`/api/documents`),
  createDocument: (payload: Partial<DocumentDto>) => http<DocumentDto>(`/api/documents`, { method: "POST", body: JSON.stringify(payload) }),
  deleteDocument: (id: string) => http(`/api/documents/${id}`, { method: "DELETE" }),
  presignUpload: (filename: string, contentType: string) => http<{ url: string; publicUrl: string }>("/api/upload/presign", { method: "POST", body: JSON.stringify({ filename, contentType }) }),
  // Bids
  getBids: (projectId: string) => http<BidDto[]>(`/api/projects/${projectId}/bids`),
  createBid: (projectId: string, payload: Partial<BidDto>) => http<BidDto>(`/api/projects/${projectId}/bids`, { method: "POST", body: JSON.stringify(payload) }),
  updateBid: (projectId: string, id: string, payload: Partial<BidDto>) => http<BidDto>(`/api/projects/${projectId}/bids/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  deleteBid: (projectId: string, id: string) => http(`/api/projects/${projectId}/bids/${id}`, { method: "DELETE" }),
  // Invoices
  getInvoices: (projectId: string) => http<InvoiceDto[]>(`/api/projects/${projectId}/invoices`),
  createInvoice: (projectId: string, payload: Partial<InvoiceDto>) => http<InvoiceDto>(`/api/projects/${projectId}/invoices`, { method: "POST", body: JSON.stringify(payload) }),
  updateInvoice: (projectId: string, id: string, payload: Partial<InvoiceDto>) => http<InvoiceDto>(`/api/projects/${projectId}/invoices/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  deleteInvoice: (projectId: string, id: string) => http(`/api/projects/${projectId}/invoices/${id}`, { method: "DELETE" }),
  // Inspections
  getInspections: (projectId: string) => http<InspectionDto[]>(`/api/projects/${projectId}/inspections`),
  getInspection: (id: string) => http<InspectionDto>(`/api/inspections/${id}`),
  createInspection: (projectId: string, payload: Partial<InspectionDto>) => http<InspectionDto>(`/api/projects/${projectId}/inspections`, { method: "POST", body: JSON.stringify(payload) }),
  updateInspection: (projectId: string, id: string, payload: Partial<InspectionDto>) => http<InspectionDto>(`/api/projects/${projectId}/inspections/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  deleteInspection: (projectId: string, id: string) => http(`/api/projects/${projectId}/inspections/${id}`, { method: "DELETE" }),
  getInspectionApprovals: (id: string) => http<InspectionApprovalDto[]>(`/api/inspections/${id}/approvals`),
  createApproval: (id: string, payload: { status: string; comments?: string }) => http<{ approval: InspectionApprovalDto; inspectionStatus: string }>(`/api/inspections/${id}/approvals`, { method: "POST", body: JSON.stringify(payload) }),
  // Safety Incidents
  getSafetyIncidents: (projectId: string) => http<SafetyIncidentDto[]>(`/api/projects/${projectId}/safety-incidents`),
  createSafetyIncident: (projectId: string, payload: Partial<SafetyIncidentDto>) => http<SafetyIncidentDto>(`/api/projects/${projectId}/safety-incidents`, { method: "POST", body: JSON.stringify(payload) }),
  updateSafetyIncident: (projectId: string, id: string, payload: Partial<SafetyIncidentDto>) => http<SafetyIncidentDto>(`/api/projects/${projectId}/safety-incidents/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  deleteSafetyIncident: (projectId: string, id: string) => http(`/api/projects/${projectId}/safety-incidents/${id}`, { method: "DELETE" }),
  // Equipment
  getEquipment: () => http<EquipmentDto[]>("/api/equipment"),
  createEquipment: (payload: Partial<EquipmentDto>) => http<EquipmentDto>("/api/equipment", { method: "POST", body: JSON.stringify(payload) }),
  updateEquipment: (id: string, payload: Partial<EquipmentDto>) => http<EquipmentDto>(`/api/equipment/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  deleteEquipment: (id: string) => http(`/api/equipment/${id}`, { method: "DELETE" }),
  // Attendance
  getAttendance: (params?: { date?: string; userId?: string }) => http<AttendanceDto[]>("/api/attendance" + (params ? "?" + new URLSearchParams(params as Record<string, string>).toString() : "")),
  createAttendance: (payload: Partial<AttendanceDto>) => http<AttendanceDto>("/api/attendance", { method: "POST", body: JSON.stringify(payload) }),
  updateAttendance: (id: string, payload: Partial<AttendanceDto>) => http<AttendanceDto>(`/api/attendance/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  deleteAttendance: (id: string) => http(`/api/attendance/${id}`, { method: "DELETE" }),
  // Checklist Templates
  getChecklistTemplates: (params?: { isGlobal?: boolean; status?: string }) => http<ChecklistTemplateDto[]>(`/api/checklist-templates?${new URLSearchParams(params as any).toString()}`),
  createChecklistTemplate: (payload: Partial<ChecklistTemplateDto>) => http<ChecklistTemplateDto>("/api/checklist-templates", { method: "POST", body: JSON.stringify(payload) }),
  updateChecklistTemplate: (id: string, payload: Partial<ChecklistTemplateDto>) => http<ChecklistTemplateDto>(`/api/checklist-templates/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  deleteChecklistTemplate: (id: string) => http(`/api/checklist-templates/${id}`, { method: "DELETE" }),
  // Shareable form links
  shareTemplate: (id: string, isPublic: boolean) => http<{ token: string; public: boolean; url: string }>(`/api/checklist-templates/${id}/share`, { method: "POST", body: JSON.stringify({ public: isPublic }) }),
  getPublicForm: (token: string) => http<{ id: string; title: string; trade: string; category?: string; items: string }>(`/api/public/forms/${token}`),
  submitPublicForm: (token: string, payload: { respondentName?: string; respondentEmail?: string; data: any }) => http<{ ok: boolean }>(`/api/public/forms/${token}/submit`, { method: "POST", body: JSON.stringify(payload) }),
  getTemplateSubmissions: (id: string) => http<any[]>(`/api/checklist-templates/${id}/submissions`),
  // Work tasks (Tasks & Trades assignment hub)
  listWorkTasks: () => http<any[]>("/api/work-tasks"),
  createWorkTask: (payload: any) => http<any>("/api/work-tasks", { method: "POST", body: JSON.stringify(payload) }),
  updateWorkTask: (id: string, payload: any) => http<any>(`/api/work-tasks/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  deleteWorkTask: (id: string) => http(`/api/work-tasks/${id}`, { method: "DELETE" }),
  // CSV / AI upload to template
  uploadChecklistCSV: (payload: { title: string; trade?: string; category?: string; csvText: string; source?: string }) => http<{ template: ChecklistTemplateDto; parsedItems: any[] }>("/api/checklist-templates/from-csv", { method: "POST", body: JSON.stringify(payload) }),
  // File upload preview (.csv / .xlsx)
  parseChecklistFile: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return http<{ headers: string[]; previewRows: string[][]; suggestedMappings: { question: number | null; type: number | null; required: number | null; options: number | null }; rowCount: number }>("/api/checklist-templates/parse-file", { method: "POST", body: form });
  },
  // Create template from confirmed parsed data
  createTemplateFromParsed: (payload: { title: string; trade?: string; category?: string; rows: string[][]; mappings: { question: number | null; type: number | null; required: number | null; options: number | null } }) => http<{ template: ChecklistTemplateDto; parsedItems: any[] }>("/api/checklist-templates/from-parsed", { method: "POST", body: JSON.stringify(payload) }),
  // Create checklist from template
  createChecklistFromTemplate: (templateId: string, payload: { title?: string; description?: string; category?: string; projectId?: string; dueDate?: string }) => http<ChecklistDto>(`/api/checklists/from-template/${templateId}`, { method: "POST", body: JSON.stringify(payload) }),
  // Checklists
  getChecklists: (params?: { projectId?: string; status?: string }) => http<ChecklistDto[]>(`/api/checklists?${new URLSearchParams(params as any).toString()}`),
  getChecklist: (id: string) => http<ChecklistDto>(`/api/checklists/${id}`),
  createChecklist: (payload: { title: string; description?: string; category?: string; trade?: string; source?: string; questions?: { question: string; questionType: string; required?: boolean; position?: number; options?: string | string[]; parentId?: string | null }[]; assignee?: string; assignedTo?: string[]; templateId?: string; dueDate?: string; projectId?: string }) => http<ChecklistDto>("/api/checklists", { method: "POST", body: JSON.stringify(payload) }),
  updateChecklist: (id: string, payload: Partial<Pick<ChecklistDto, "title" | "description" | "category" | "trade" | "status" | "assigned" | "assignee" | "assignedTo" | "templateId" | "dueDate" | "projectId">>) => http<ChecklistDto>(`/api/checklists/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  deleteChecklist: (id: string) => http(`/api/checklists/${id}`, { method: "DELETE" }),
  assignChecklist: (id: string, userIds: string[]) => http<ChecklistDto>(`/api/checklists/${id}/assign`, { method: "POST", body: JSON.stringify({ userIds }) }),
  setChecklistProgress: (id: string, progress: number) => http<ChecklistDto>(`/api/checklists/${id}/progress`, { method: "POST", body: JSON.stringify({ progress }) }),
  submitChecklist: (id: string, responses: { questionId: string; value: string }[]) => http<{ checklist: ChecklistDto; responses: ChecklistResponseDto[] }>(`/api/checklists/${id}/submit`, { method: "POST", body: JSON.stringify({ responses }) }),
  createChecklistQuestion: (checklistId: string, payload: { question: string; questionType: string; required?: boolean; position?: number; options?: string | string[]; parentId?: string | null }) => http<ChecklistQuestionDto>(`/api/checklists/${checklistId}/questions`, { method: "POST", body: JSON.stringify(payload) }),
  updateChecklistQuestion: (checklistId: string, questionId: string, payload: Partial<Omit<ChecklistQuestionDto, "id" | "checklistId">>) => http<ChecklistQuestionDto>(`/api/checklists/${checklistId}/questions/${questionId}`, { method: "PUT", body: JSON.stringify(payload) }),
  deleteChecklistQuestion: (checklistId: string, questionId: string) => http(`/api/checklists/${checklistId}/questions/${questionId}`, { method: "DELETE" }),
  getChecklistResponses: (checklistId: string) => http<ChecklistResponseDto[]>(`/api/checklists/${checklistId}/responses`),
  createChecklistResponse: (checklistId: string, payload: { questionId: string; value: string }) => http<ChecklistResponseDto>(`/api/checklists/${checklistId}/responses`, { method: "POST", body: JSON.stringify(payload) }),
  updateChecklistResponse: (checklistId: string, responseId: string, payload: { value?: string; status?: string; reviewNote?: string }) => http<ChecklistResponseDto>(`/api/checklists/${checklistId}/responses/${responseId}`, { method: "PUT", body: JSON.stringify(payload) }),
  deleteChecklistResponse: (checklistId: string, responseId: string) => http(`/api/checklists/${checklistId}/responses/${responseId}`, { method: "DELETE" }),
  // AI
  aiChat: (question: string) => http<{ answer: string }>("/api/ai/chat", { method: "POST", body: JSON.stringify({ question }) }),
  aiAssistant: (question: string, history?: { role: string; content: string }[], signal?: AbortSignal) => http<{ answer: string }>("/api/ai/assistant", { method: "POST", body: JSON.stringify({ question, history }), signal }),
  aiGenerateChecklist: (payload: { trade: string; projectType: string; scope?: string }) => http<{ title: string; items: any[] }>("/api/ai/generate-checklist", { method: "POST", body: JSON.stringify(payload) }),
  buildChecklistAI: (payload: { prompt: string; trade?: string; category?: string; current?: any[]; history?: { role: string; content: string }[] }, signal?: AbortSignal) => http<{ title: string; reply?: string; items: any[]; trade?: string; category?: string }>("/api/ai/build-checklist", { method: "POST", body: JSON.stringify(payload), signal }),
  aiExtractChecklistFromDocument: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return http<{ title: string; questions: { question: string; questionType: string; required: boolean; options?: string[]; subQuestions?: any[] }[] }>("/api/ai/extract-checklist-from-document", { method: "POST", body: form });
  },
  // Chat / Inbox
  getConversations: () => http<ConversationDto[]>("/api/conversations"),
  getConversationMessages: (id: string) => http<ChatMessageDto[]>(`/api/conversations/${id}/messages`),
  createConversation: (payload: { name?: string; type?: string; memberIds: string[] }) => http<ConversationDto>("/api/conversations", { method: "POST", body: JSON.stringify(payload) }),
  createChatMessage: (conversationId: string, payload: { text?: string; attachment?: string; replyToId?: string; taskId?: string; taskTitle?: string }) => http<ChatMessageDto>(`/api/conversations/${conversationId}/messages`, { method: "POST", body: JSON.stringify(payload) }),
  deleteConversation: (id: string) => http(`/api/conversations/${id}`, { method: "DELETE" }),
  renameConversation: (id: string, name: string) => http<ConversationDto>(`/api/conversations/${id}/name`, { method: "PUT", body: JSON.stringify({ name }) }),
  addConversationMember: (conversationId: string, userId: string) => http<ConversationMemberDto>(`/api/conversations/${conversationId}/members`, { method: "POST", body: JSON.stringify({ userId }) }),
  removeConversationMember: (conversationId: string, userId: string) => http(`/api/conversations/${conversationId}/members/${userId}`, { method: "DELETE" }),
  markConversationRead: (id: string) => http(`/api/conversations/${id}/read`, { method: "PUT" }),
  // Plan Markups
  getMarkups: (projectId: string) => http<PlanMarkupDto[]>(`/api/projects/${projectId}/markups`),
  createMarkup: (projectId: string, payload: Partial<PlanMarkupDto>) => http<PlanMarkupDto>(`/api/projects/${projectId}/markups`, { method: "POST", body: JSON.stringify(payload) }),
  updateMarkup: (projectId: string, id: string, payload: Partial<PlanMarkupDto>) => http<PlanMarkupDto>(`/api/projects/${projectId}/markups/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  deleteMarkup: (projectId: string, id: string) => http(`/api/projects/${projectId}/markups/${id}`, { method: "DELETE" }),
  // Drawing Versions
  getDrawingVersions: (projectId: string) => http<DrawingVersionDto[]>(`/api/projects/${projectId}/drawing-versions`),
  createDrawingVersion: (projectId: string, payload: Partial<DrawingVersionDto>) => http<DrawingVersionDto>(`/api/projects/${projectId}/drawing-versions`, { method: "POST", body: JSON.stringify(payload) }),
  // Scheduled Reports
  getScheduledReports: () => http<ScheduledReportDto[]>("/api/scheduled-reports"),
  createScheduledReport: (payload: Partial<ScheduledReportDto>) => http<ScheduledReportDto>("/api/scheduled-reports", { method: "POST", body: JSON.stringify(payload) }),
  updateScheduledReport: (id: string, payload: Partial<ScheduledReportDto>) => http<ScheduledReportDto>(`/api/scheduled-reports/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  deleteScheduledReport: (id: string) => http(`/api/scheduled-reports/${id}`, { method: "DELETE" }),
  // Form Templates
  getFormTemplates: () => http<FormTemplateDto[]>("/api/form-templates"),
  createFormTemplate: (payload: Partial<FormTemplateDto>) => http<FormTemplateDto>("/api/form-templates", { method: "POST", body: JSON.stringify(payload) }),
  updateFormTemplate: (id: string, payload: Partial<FormTemplateDto>) => http<FormTemplateDto>(`/api/form-templates/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  deleteFormTemplate: (id: string) => http(`/api/form-templates/${id}`, { method: "DELETE" }),
  // Task-linked messages
  createTaskMessage: (projectId: string, payload: { text: string; attachment?: string; taskType?: string; taskId?: string }) => http(`/api/projects/${projectId}/messages`, { method: "POST", body: JSON.stringify(payload) }),
  // Observations
  getObservations: () => http<any[]>("/api/observations"),
  createObservation: (payload: any) => http<any>("/api/observations", { method: "POST", body: JSON.stringify(payload) }),
  updateObservation: (id: string, payload: any) => http<any>(`/api/observations/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  deleteObservation: (id: string) => http(`/api/observations/${id}`, { method: "DELETE" }),
  // Coordination issues
  getCoordinationIssues: () => http<any[]>("/api/coordination-issues"),
  createCoordinationIssue: (payload: any) => http<any>("/api/coordination-issues", { method: "POST", body: JSON.stringify(payload) }),
  updateCoordinationIssue: (id: string, payload: any) => http<any>(`/api/coordination-issues/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  deleteCoordinationIssue: (id: string) => http(`/api/coordination-issues/${id}`, { method: "DELETE" }),
  // Action plans
  getActionPlans: () => http<any[]>("/api/action-plans"),
  createActionPlan: (payload: any) => http<any>("/api/action-plans", { method: "POST", body: JSON.stringify(payload) }),
  updateActionPlan: (id: string, payload: any) => http<any>(`/api/action-plans/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  deleteActionPlan: (id: string) => http(`/api/action-plans/${id}`, { method: "DELETE" }),
  // Correspondence
  getCorrespondence: () => http<any[]>("/api/correspondence"),
  createCorrespondence: (payload: any) => http<any>("/api/correspondence", { method: "POST", body: JSON.stringify(payload) }),
  updateCorrespondence: (id: string, payload: any) => http<any>(`/api/correspondence/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  deleteCorrespondence: (id: string) => http(`/api/correspondence/${id}`, { method: "DELETE" }),
  // Crews
  getCrews: () => http<any[]>("/api/crews"),
  createCrew: (payload: any) => http<any>("/api/crews", { method: "POST", body: JSON.stringify(payload) }),
  updateCrew: (id: string, payload: any) => http<any>(`/api/crews/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  deleteCrew: (id: string) => http(`/api/crews/${id}`, { method: "DELETE" }),
  // Directory contacts
  getDirectoryContacts: () => http<any[]>("/api/directory-contacts"),
  createDirectoryContact: (payload: any) => http<any>("/api/directory-contacts", { method: "POST", body: JSON.stringify(payload) }),
  updateDirectoryContact: (id: string, payload: any) => http<any>(`/api/directory-contacts/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  deleteDirectoryContact: (id: string) => http(`/api/directory-contacts/${id}`, { method: "DELETE" }),
  // Company documents
  getCompanyDocs: () => http<any[]>("/api/company-docs"),
  createCompanyDoc: (payload: any) => http<any>("/api/company-docs", { method: "POST", body: JSON.stringify(payload) }),
  updateCompanyDoc: (id: string, payload: any) => http<any>(`/api/company-docs/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  deleteCompanyDoc: (id: string) => http(`/api/company-docs/${id}`, { method: "DELETE" }),
  // Announcements
  getAnnouncements: () => http<any[]>("/api/announcements"),
  createAnnouncement: (payload: any) => http<any>("/api/announcements", { method: "POST", body: JSON.stringify(payload) }),
  updateAnnouncement: (id: string, payload: any) => http<any>(`/api/announcements/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  deleteAnnouncement: (id: string) => http(`/api/announcements/${id}`, { method: "DELETE" }),
};

export default api;
