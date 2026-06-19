// ============================================================================
// Drawing Viewer — domain types
// Original implementation. Mirrors construction-drawing workflows (revisions,
// markups, sharing, QR) without copying any third-party code or wording.
// ============================================================================

export type ViewerRole = "viewer" | "commenter" | "editor";

export type MarkupTool = "pin" | "text" | "note";
export type MarkupStatus = "open" | "resolved";
export type RevisionStatus = "draft" | "published";
export type ShareAccess = "view" | "comment";

export interface Drawing {
  id: string;
  sheetNumber: string;       // e.g. "A-101"
  title: string;             // e.g. "Floor Plan — Level 14"
  projectName: string;
  discipline: string;        // Architectural | Structural | MEP | Civil ...
  currentRevisionId: string; // points at the latest revision
  recipients: number;        // how many people it's shared with
  updatedAt: string;         // ISO timestamp of last change
}

export interface DrawingRevision {
  id: string;
  drawingId: string;
  rev: number;               // 1, 2, 3 ...
  status: RevisionStatus;    // draft | published
  fileUrl: string;           // image or pdf URL
  fileType: "image" | "pdf";
  fileSize: string;          // "4.2 MB"
  uploadedBy: string;
  uploadedAt: string;        // ISO
  changeNote?: string;
  isLatest: boolean;
}

export interface Markup {
  id: string;
  revisionId: string;        // markups belong to a specific revision
  tool: MarkupTool;          // pin | text | note
  x: number;                 // 0..100 (% of canvas width)
  y: number;                 // 0..100 (% of canvas height)
  w?: number;                // note box width  (% of canvas)
  h?: number;                // note box height (% of canvas)
  text: string;
  color: string;
  author: string;
  createdAt: string;         // ISO
  status: MarkupStatus;      // open | resolved
  attachment?: string | null;
}

export interface ShareLink {
  id: string;
  drawingId: string;
  revisionId: string;
  access: ShareAccess;       // view-only | view + comment
  url: string;
  expiresAt?: string | null; // ISO or null = never
  createdAt: string;
}

// Lightweight "seed" the host screen can pass so the viewer shows the drawing
// the user clicked, even before a real backend exists.
export interface DrawingSeed {
  id: string;
  sheetNumber: string;
  title: string;
  projectName: string;
  discipline: string;
  fileUrl: string;
  fileType?: "image" | "pdf";
  fileSize?: string;
  status?: RevisionStatus;
  rev?: number;
  recipients?: number;
}

// ---- Role → capability matrix --------------------------------------------
export interface ViewerCapabilities {
  canMarkup: boolean;     // place pins / text / notes
  canResolve: boolean;    // resolve / reopen markups
  canManageVersions: boolean;
  canShare: boolean;
  canDownload: boolean;
}

export function capabilitiesFor(role: ViewerRole): ViewerCapabilities {
  switch (role) {
    case "editor":
      return { canMarkup: true, canResolve: true, canManageVersions: true, canShare: true, canDownload: true };
    case "commenter":
      return { canMarkup: true, canResolve: false, canManageVersions: false, canShare: true, canDownload: true };
    case "viewer":
    default:
      return { canMarkup: false, canResolve: false, canManageVersions: false, canShare: false, canDownload: true };
  }
}
