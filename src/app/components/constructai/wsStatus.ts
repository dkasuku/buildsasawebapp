// Project status → pill tone and dot colour for the workspace shell. Status is
// always shown with its label too, never by colour alone.
export type WsTone = "blue" | "green" | "amber" | "red" | "grey";

export function projectTone(status?: string | null): WsTone {
  const s = String(status || "").toLowerCase().replace(/[_-]/g, " ");
  if (s.includes("plan") || s.includes("tender") || s.includes("design")) return "blue";
  if (s.includes("progress") || s.includes("active") || s.includes("done") || s.includes("complete")) return "green";
  if (s.includes("await") || s.includes("hold") || s.includes("pending") || s.includes("review")) return "amber";
  if (s.includes("block") || s.includes("cancel") || s.includes("risk")) return "red";
  return "grey";
}

export const TONE_DOT: Record<WsTone, string> = {
  blue: "#1E4E8C", green: "#1E6B3A", amber: "#B07A00", red: "#B42318", grey: "#8A867D",
};

export const statusText = (s?: string | null) =>
  String(s || "—").replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
