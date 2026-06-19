import { useState, useEffect } from "react";
import { toast } from "sonner";
import {
  Clock, MapPin, LogIn, LogOut, Coffee, Calendar, UserCheck,
  UserX, Briefcase, ArrowLeft, ChevronRight, Sun, Moon
} from "lucide-react";
import type { Role } from "./roles";
import { ROLES } from "./roles";
import api, { type AttendanceDto } from "../../services/api";

const STATUS_LABELS: Record<string, { label: string; color: string; bg: string; icon: typeof LogIn }> = {
  present: { label: "Present", color: "#22C55E", bg: "#22C55E20", icon: UserCheck },
  late: { label: "Late", color: "#F5A623", bg: "#F5A62320", icon: Clock },
  absent: { label: "Absent", color: "#EF4444", bg: "#EF444420", icon: UserX },
  leave: { label: "On Leave", color: "#3B82F6", bg: "#3B82F620", icon: Briefcase },
  "off-day": { label: "Off Day", color: "#8B5CF6", bg: "#8B5CF620", icon: Sun },
};

function todayStr() {
  return new Date().toISOString().split("T")[0];
}
function nowStr() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export default function Attendance({ role = "Worker" }: { role?: Role }) {
  const perms = ROLES[role];
  const [records, setRecords] = useState<AttendanceDto[]>([]);
  const [todayRecord, setTodayRecord] = useState<AttendanceDto | null>(null);
  const [view, setView] = useState<"today" | "history" | "report" | "access" | "team">("today");
  const [loading, setLoading] = useState(false);
  const [accessLogs, setAccessLogs] = useState<any[]>([]);
  const [teamToday, setTeamToday] = useState<AttendanceDto[]>([]);
  const canSeeAccess = perms.manageTeam || perms.viewReports || perms.isWorkspaceOwner;
  useEffect(() => { if (view === "access") { api.getAccessLogs().then(setAccessLogs).catch(() => setAccessLogs([])); } }, [view]);
  // Managers see team-wide manpower for today; everyone else sees their own.
  useEffect(() => { if (canSeeAccess) { api.getAttendance({ all: "1", date: todayStr() } as any).then(setTeamToday).catch(() => setTeamToday([])); } }, [canSeeAccess]);
  // Supervisor/manager: record attendance on behalf of any team member.
  const [members, setMembers] = useState<any[]>([]);
  const [showMark, setShowMark] = useState(false);
  const [markMember, setMarkMember] = useState("");
  const [markStatus, setMarkStatus] = useState("present");
  const [markDate, setMarkDate] = useState(todayStr());
  const [markTime, setMarkTime] = useState(nowStr());
  useEffect(() => { if (canSeeAccess) { api.getUsers().then(setMembers).catch(() => setMembers([])); } }, [canSeeAccess]);
  const refreshTeam = () => api.getAttendance({ all: "1", date: todayStr() } as any).then(setTeamToday).catch(() => {});
  // Team history (all dates) + per-member + date-range filters, for timesheets/payroll.
  const [teamHistory, setTeamHistory] = useState<any[]>([]);
  const [histMember, setHistMember] = useState("");
  const [histFrom, setHistFrom] = useState("");
  const [histTo, setHistTo] = useState("");
  useEffect(() => { if (view === "team") { api.getAttendance({ all: "1" } as any).then(setTeamHistory).catch(() => setTeamHistory([])); } }, [view]);
  const nameOfRec = (r: any) => r.user?.name || members.find((m) => m.id === r.userId)?.name || r.userId;
  const histRows = teamHistory.filter((r) => (!histMember || r.userId === histMember) && (!histFrom || r.date >= histFrom) && (!histTo || r.date <= histTo));
  // Hours worked from check-in/out (minus break). HH:mm strings.
  const parseHM = (s?: string) => { if (!s || !/^\d{1,2}:\d{2}$/.test(s)) return null; const [h, m] = s.split(":").map(Number); return h * 60 + m; };
  const recMinutes = (r: any) => { const a = parseHM(r.checkIn), b = parseHM(r.checkOut); if (a == null || b == null) return 0; return Math.max(0, b - a - (Number(r.breakDuration) || 0)); };
  const hrs = (min: number) => (min / 60).toFixed(1);
  const hoursSummary = (() => {
    const m: Record<string, { name: string; min: number; days: number }> = {};
    histRows.forEach((r: any) => {
      const k = r.userId; if (!m[k]) m[k] = { name: nameOfRec(r), min: 0, days: 0 };
      m[k].min += recMinutes(r);
      if (r.status === "present" || r.status === "late") m[k].days += 1;
    });
    return Object.values(m).sort((a, b) => b.min - a.min);
  })();
  const exportHist = () => {
    const cols = ["Member", "Date", "Status", "Check in", "Check out", "Break (min)", "Hours", "Location"];
    const rows = histRows.map((r) => [nameOfRec(r), r.date, r.status, r.checkIn || "", r.checkOut || "", r.breakDuration || "", hrs(recMinutes(r)), r.location || ""].map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","));
    const blob = new Blob([[cols.join(","), ...rows].join("\n")], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `attendance-${histFrom || "all"}_${histTo || "all"}.csv`; a.click();
    toast.success("Attendance exported as CSV");
  };
  const submitMark = async () => {
    if (!markMember) { toast.error("Select a team member"); return; }
    try {
      await api.createAttendance({ userId: markMember, date: markDate, status: markStatus, checkIn: (markStatus === "present" || markStatus === "late") ? markTime : null } as any);
      toast.success("Attendance recorded");
      setShowMark(false); setMarkMember("");
      refreshTeam();
    } catch (e: any) { toast.error(e.message || "Could not record attendance"); }
  };

  // Report leave / off-day form
  const [showReport, setShowReport] = useState(false);
  const [reportType, setReportType] = useState<"leave" | "off-day">("leave");
  const [reportDate, setReportDate] = useState(todayStr());
  const [reportNotes, setReportNotes] = useState("");

  useEffect(() => {
    fetchRecords();
  }, []);

  const fetchRecords = async () => {
    try {
      const rows = await api.getAttendance();
      setRecords(rows);
      const today = rows.find((r) => r.date === todayStr());
      setTodayRecord(today || null);
    } catch {
      // offline fallback — leave empty
    }
  };

  const ensureTodayRecord = async (): Promise<AttendanceDto> => {
    if (todayRecord) return todayRecord;
    const newRow = await api.createAttendance({
      date: todayStr(),
      status: "present",
      location: "",
    });
    setTodayRecord(newRow);
    setRecords((prev) => [newRow, ...prev]);
    return newRow;
  };

  const checkIn = async () => {
    setLoading(true);
    try {
      const row = await ensureTodayRecord();
      const updated = await api.updateAttendance(row.id, {
        checkIn: nowStr(),
        status: "present",
      });
      setTodayRecord(updated);
      toast.success("Checked in at " + nowStr());
    } catch {
      toast.error("Check-in failed");
    }
    setLoading(false);
  };

  const checkOut = async () => {
    if (!todayRecord) return toast.error("Check in first");
    setLoading(true);
    try {
      const updated = await api.updateAttendance(todayRecord.id, {
        checkOut: nowStr(),
      });
      setTodayRecord(updated);
      toast.success("Checked out at " + nowStr());
    } catch {
      toast.error("Check-out failed");
    }
    setLoading(false);
  };

  const startBreak = async () => {
    if (!todayRecord) return toast.error("Check in first");
    setLoading(true);
    try {
      const updated = await api.updateAttendance(todayRecord.id, {
        breakStart: nowStr(),
      });
      setTodayRecord(updated);
      toast.success("Break started");
    } catch {
      toast.error("Failed to start break");
    }
    setLoading(false);
  };

  const endBreak = async () => {
    if (!todayRecord || !todayRecord.breakStart) return toast.error("No break started");
    setLoading(true);
    try {
      const breakEnd = nowStr();
      const [sh, sm] = todayRecord.breakStart.split(":").map(Number);
      const [eh, em] = breakEnd.split(":").map(Number);
      const duration = (eh * 60 + em) - (sh * 60 + sm);
      const updated = await api.updateAttendance(todayRecord.id, {
        breakEnd,
        breakDuration: duration > 0 ? duration : 0,
      });
      setTodayRecord(updated);
      toast.success(`Break ended (${duration} min)`);
    } catch {
      toast.error("Failed to end break");
    }
    setLoading(false);
  };

  const submitReport = async () => {
    setLoading(true);
    try {
      const newRow = await api.createAttendance({
        date: reportDate,
        status: reportType,
        notes: reportNotes,
      });
      setRecords((prev) => [newRow, ...prev]);
      if (reportDate === todayStr()) setTodayRecord(newRow);
      setShowReport(false);
      setReportNotes("");
      toast.success(`${reportType === "leave" ? "Leave" : "Off-day"} reported`);
    } catch {
      toast.error("Report failed");
    }
    setLoading(false);
  };

  const statusInfo = todayRecord ? STATUS_LABELS[todayRecord.status] : null;

  return (
    <div className="px-4 sm:px-7 py-5 sm:py-6 space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[13px] text-white font-display">
            <Clock className="w-4 h-4 text-[#FF6B1A]" /> Attendance & Time Tracking
          </div>
          <div className="text-[11px] text-[#8A95A5] mt-0.5">
            {role === "Worker" || role === "Trade Lead"
              ? "Check in/out, breaks, and report leaves"
              : "View team attendance and time records"}
          </div>
        </div>
        <div className="flex gap-2">
          {[
            { key: "today" as const, label: "Today", icon: Clock },
            { key: "history" as const, label: "History", icon: Calendar },
            ...(canSeeAccess ? [{ key: "team" as const, label: "Team History", icon: Calendar }, { key: "access" as const, label: "Access Log", icon: MapPin }] : []),
          ].map((t) => (
            <button
              key={t.key}
              onClick={() => setView(t.key)}
              className={`h-8 px-3 rounded-md text-[11px] flex items-center gap-1.5 ${
                view === t.key
                  ? "bg-[#FF6B1A] text-white"
                  : "bg-[#11161D] border border-[#222A35] text-[#8A95A5]"
              }`}
            >
              <t.icon className="w-3.5 h-3.5" /> {t.label}
            </button>
          ))}
        </div>
      </div>

      {canSeeAccess && (
        <div className="flex justify-end mb-3">
          <button onClick={() => setShowMark(true)} className="h-9 px-4 bg-[#FF6B1A] text-white rounded-lg text-[12px] flex items-center gap-1.5 hover:bg-[#FF7E33]"><UserCheck className="w-3.5 h-3.5" /> Mark team attendance</button>
        </div>
      )}
      {showMark && (
        <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-4" onClick={() => setShowMark(false)}>
          <div className="w-full max-w-sm rounded-xl border border-[#222A35] bg-[#11161D]" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-[#222A35] flex items-center justify-between">
              <div className="text-[14px] text-white font-display">Mark attendance</div>
              <button onClick={() => setShowMark(false)} className="text-[#8A95A5] hover:text-white text-[16px] leading-none">✕</button>
            </div>
            <div className="p-5 space-y-3">
              <div><div className="text-[10px] uppercase tracking-wider text-[#8A95A5] mb-1">Team member</div>
                <select value={markMember} onChange={(e) => setMarkMember(e.target.value)} className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-[12px] text-white"><option value="">Select…</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name} · {m.role}</option>)}</select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><div className="text-[10px] uppercase tracking-wider text-[#8A95A5] mb-1">Date</div><input type="date" value={markDate} onChange={(e) => setMarkDate(e.target.value)} className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-[12px] text-white" /></div>
                <div><div className="text-[10px] uppercase tracking-wider text-[#8A95A5] mb-1">Status</div><select value={markStatus} onChange={(e) => setMarkStatus(e.target.value)} className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-[12px] text-white"><option value="present">Present</option><option value="late">Late</option><option value="absent">Absent</option><option value="leave">On leave</option><option value="off-day">Off day</option></select></div>
              </div>
              {(markStatus === "present" || markStatus === "late") && <div><div className="text-[10px] uppercase tracking-wider text-[#8A95A5] mb-1">Check-in time</div><input type="time" value={markTime} onChange={(e) => setMarkTime(e.target.value)} className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-[12px] text-white" /></div>}
            </div>
            <div className="px-5 py-4 border-t border-[#222A35] flex gap-2">
              <button onClick={() => setShowMark(false)} className="flex-1 h-10 rounded-md border border-[#222A35] text-[12px] text-white">Cancel</button>
              <button onClick={submitMark} className="flex-1 h-10 rounded-md bg-[#FF6B1A] text-white text-[12px]">Record</button>
            </div>
          </div>
        </div>
      )}

      {/* Manpower snapshot — at-a-glance people working today (from attendance check-ins) */}
      {(() => {
        const dayRecs = canSeeAccess ? teamToday : records.filter((r) => r.date === todayStr());
        const n = (f: (r: AttendanceDto) => any) => dayRecs.filter(f).length;
        const Card = ({ label, val, color }: { label: string; val: number; color: string }) => (
          <div className="rounded-xl border border-[#222A35] bg-[#11161D] p-4"><div className="text-[11px] text-[#8A95A5]">{label}</div><div className="text-[22px] font-display mt-1" style={{ color }}>{val}</div></div>
        );
        return (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <Card label={canSeeAccess ? "People working today" : "Working today"} val={n((r) => r.status === "present" || r.status === "late" || !!r.checkIn)} color="#22C55E" />
            <Card label="Currently on site" val={n((r) => !!r.checkIn && !r.checkOut)} color="#FF6B1A" />
            <Card label="Late today" val={n((r) => r.status === "late")} color="#F5A623" />
            <Card label="On leave" val={n((r) => r.status === "leave")} color="#3B82F6" />
          </div>
        );
      })()}

      {/* TEAM ATTENDANCE TODAY — names + status (managers) */}
      {canSeeAccess && view === "today" && (
        <div className="rounded-xl border border-[#222A35] bg-[#11161D] overflow-hidden mb-4">
          <div className="px-4 py-3 border-b border-[#222A35] text-[12px] text-[#8A95A5]">Team attendance · today ({teamToday.length} recorded)</div>
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full min-w-[640px] text-[12px]">
              <thead><tr className="text-[10px] text-[#5B6675] uppercase tracking-wider border-b border-[#222A35]">
                <th className="text-left px-4 py-2.5">Member</th><th className="text-left px-3 py-2.5">Status</th><th className="text-left px-3 py-2.5">Check in</th><th className="text-left px-3 py-2.5">Check out</th><th className="text-left px-3 py-2.5">Location</th>
              </tr></thead>
              <tbody>
                {teamToday.length === 0 && <tr><td colSpan={5} className="text-center py-6 text-[#5B6675]">No attendance recorded today yet.</td></tr>}
                {teamToday.map((r: any) => {
                  const meta = STATUS_LABELS[r.status] || STATUS_LABELS.present;
                  return (
                    <tr key={r.id} className="border-b border-[#222A35] last:border-0 hover:bg-[#161C24]">
                      <td className="px-4 py-2.5 text-white">{r.user?.name || members.find((m) => m.id === r.userId)?.name || r.userId}</td>
                      <td className="px-3 py-2.5"><span className="text-[10px] px-2 py-0.5 rounded-full" style={{ color: meta.color, background: meta.bg }}>{meta.label}</span></td>
                      <td className="px-3 py-2.5 text-[#8A95A5]">{r.checkIn || "—"}</td>
                      <td className="px-3 py-2.5 text-[#8A95A5]">{r.checkOut || "—"}</td>
                      <td className="px-3 py-2.5 text-[#8A95A5]">{r.location || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="sm:hidden divide-y divide-[#222A35]">
            {teamToday.length === 0 && <div className="text-center py-6 text-[#5B6675] text-[12px]">No attendance recorded today yet.</div>}
            {teamToday.map((r: any) => { const meta = STATUS_LABELS[r.status] || STATUS_LABELS.present; return (
              <div key={r.id} className="p-3">
                <div className="flex items-center justify-between gap-2"><span className="text-[13px] text-white truncate">{r.user?.name || members.find((m) => m.id === r.userId)?.name || r.userId}</span><span className="text-[10px] px-2 py-0.5 rounded-full shrink-0" style={{ color: meta.color, background: meta.bg }}>{meta.label}</span></div>
                <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5 text-[11px] text-[#8A95A5]"><span>In {r.checkIn || "—"}</span><span>Out {r.checkOut || "—"}</span><span>{r.location || "—"}</span></div>
              </div>
            ); })}
          </div>
        </div>
      )}

      {/* TEAM HISTORY — per member + date range, for timesheets/payroll */}
      {view === "team" && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <select value={histMember} onChange={(e) => setHistMember(e.target.value)} className="h-9 bg-[#11161D] border border-[#222A35] rounded-lg px-2 text-[12px] text-white"><option value="">All members</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
            <input type="date" value={histFrom} onChange={(e) => setHistFrom(e.target.value)} className="h-9 bg-[#11161D] border border-[#222A35] rounded-lg px-2 text-[12px] text-white" />
            <span className="text-[11px] text-[#5B6675]">to</span>
            <input type="date" value={histTo} onChange={(e) => setHistTo(e.target.value)} className="h-9 bg-[#11161D] border border-[#222A35] rounded-lg px-2 text-[12px] text-white" />
            <button onClick={() => { setHistMember(""); setHistFrom(""); setHistTo(""); }} className="h-9 px-3 rounded-md border border-[#222A35] text-[11px] text-[#8A95A5] hover:text-white">Clear</button>
            <button onClick={exportHist} className="h-9 px-3 rounded-md bg-[#FF6B1A] text-white text-[11px] ml-auto">Export CSV</button>
          </div>
          {hoursSummary.length > 0 && (
            <div className="rounded-xl border border-[#222A35] bg-[#11161D] p-3">
              <div className="text-[10px] uppercase tracking-wider text-[#5B6675] mb-2">Hours worked by member · {histFrom || "all time"} → {histTo || "now"}</div>
              <div className="flex flex-wrap gap-2">
                {hoursSummary.map((s) => (
                  <div key={s.name} className="px-3 py-2 rounded-lg bg-[#0A0E14] border border-[#222A35]">
                    <div className="text-[12px] text-white">{s.name}</div>
                    <div className="text-[11px] text-[#FF6B1A]">{hrs(s.min)}h <span className="text-[#5B6675]">· {s.days} day(s)</span></div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="rounded-xl border border-[#222A35] bg-[#11161D] overflow-hidden">
            <div className="px-4 py-2.5 border-b border-[#222A35] text-[11px] text-[#8A95A5]">{histRows.length} record(s)</div>
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full min-w-[720px] text-[12px]">
                <thead><tr className="text-[10px] text-[#5B6675] uppercase tracking-wider border-b border-[#222A35]">
                  <th className="text-left px-4 py-2.5">Member</th><th className="text-left px-3 py-2.5">Date</th><th className="text-left px-3 py-2.5">Status</th><th className="text-left px-3 py-2.5">In</th><th className="text-left px-3 py-2.5">Out</th><th className="text-left px-3 py-2.5">Break</th><th className="text-left px-3 py-2.5">Hours</th><th className="text-left px-3 py-2.5">Location</th>
                </tr></thead>
                <tbody>
                  {histRows.length === 0 && <tr><td colSpan={8} className="text-center py-6 text-[#5B6675]">No records for this filter.</td></tr>}
                  {histRows.map((r: any) => {
                    const meta = STATUS_LABELS[r.status] || STATUS_LABELS.present;
                    return (
                      <tr key={r.id} className="border-b border-[#222A35] last:border-0 hover:bg-[#161C24]">
                        <td className="px-4 py-2.5 text-white">{nameOfRec(r)}</td>
                        <td className="px-3 py-2.5 text-[#8A95A5]">{r.date}</td>
                        <td className="px-3 py-2.5"><span className="text-[10px] px-2 py-0.5 rounded-full" style={{ color: meta.color, background: meta.bg }}>{meta.label}</span></td>
                        <td className="px-3 py-2.5 text-[#8A95A5]">{r.checkIn || "—"}</td>
                        <td className="px-3 py-2.5 text-[#8A95A5]">{r.checkOut || "—"}</td>
                        <td className="px-3 py-2.5 text-[#8A95A5]">{r.breakDuration ? `${r.breakDuration}m` : "—"}</td>
                        <td className="px-3 py-2.5 text-white">{hrs(recMinutes(r))}h</td>
                        <td className="px-3 py-2.5 text-[#8A95A5]">{r.location || "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="sm:hidden divide-y divide-[#222A35]">
              {histRows.length === 0 && <div className="text-center py-6 text-[#5B6675] text-[12px]">No records for this filter.</div>}
              {histRows.map((r: any) => { const meta = STATUS_LABELS[r.status] || STATUS_LABELS.present; return (
                <div key={r.id} className="p-3">
                  <div className="flex items-center justify-between gap-2"><span className="text-[13px] text-white truncate">{nameOfRec(r)}</span><span className="text-[10px] px-2 py-0.5 rounded-full shrink-0" style={{ color: meta.color, background: meta.bg }}>{meta.label}</span></div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5 text-[11px] text-[#8A95A5]"><span className="text-[#C2CAD6]">{r.date}</span><span>In {r.checkIn || "—"}</span><span>Out {r.checkOut || "—"}</span><span>Break {r.breakDuration ? `${r.breakDuration}m` : "—"}</span><span className="text-[#FF6B1A]">{hrs(recMinutes(r))}h</span></div>
                  {r.location && <div className="text-[11px] text-[#8A95A5] mt-1 truncate">{r.location}</div>}
                </div>
              ); })}
            </div>
          </div>
        </div>
      )}

      {/* ACCESS LOG — who signed in, when, from which IP & location */}
      {view === "access" && (
        <div className="rounded-xl border border-[#222A35] bg-[#11161D] overflow-hidden">
          <div className="px-4 py-3 border-b border-[#222A35] text-[12px] text-[#8A95A5]">Sign-in activity · who logged in, when, and from where ({accessLogs.length})</div>
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full min-w-[680px] text-[12px]">
              <thead><tr className="text-[10px] text-[#5B6675] uppercase tracking-wider border-b border-[#222A35]">
                <th className="text-left px-4 py-2.5">User</th><th className="text-left px-3 py-2.5">Role</th><th className="text-left px-3 py-2.5">When</th><th className="text-left px-3 py-2.5">IP address</th><th className="text-left px-3 py-2.5">Location</th><th className="text-left px-3 py-2.5">Device</th>
              </tr></thead>
              <tbody>
                {accessLogs.length === 0 && <tr><td colSpan={6} className="text-center py-8 text-[#5B6675]">No sign-in activity yet.</td></tr>}
                {accessLogs.map((l) => (
                  <tr key={l.id} className="border-b border-[#222A35] last:border-0 hover:bg-[#161C24]">
                    <td className="px-4 py-2.5 text-white">{l.name || "—"}</td>
                    <td className="px-3 py-2.5 text-[#8A95A5]">{l.role || "—"}</td>
                    <td className="px-3 py-2.5 text-[#8A95A5]">{new Date(l.createdAt).toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-[#8A95A5] font-mono">{l.ip || "—"}</td>
                    <td className="px-3 py-2.5 text-[#8A95A5]">{[l.city, l.country].filter(Boolean).join(", ") || "—"}</td>
                    <td className="px-3 py-2.5 text-[#5B6675] truncate max-w-[180px]" title={l.userAgent || ""}>{(l.userAgent || "").split(")")[0].split("(")[1] || l.userAgent || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="sm:hidden divide-y divide-[#222A35]">
            {accessLogs.length === 0 && <div className="text-center py-8 text-[#5B6675] text-[12px]">No sign-in activity yet.</div>}
            {accessLogs.map((l) => (
              <div key={l.id} className="p-3">
                <div className="flex items-center justify-between gap-2"><span className="text-[13px] text-white truncate">{l.name || "—"}</span><span className="text-[11px] text-[#8A95A5] shrink-0">{l.role || "—"}</span></div>
                <div className="text-[11px] text-[#8A95A5] mt-1">{new Date(l.createdAt).toLocaleString()}</div>
                <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1 text-[11px] text-[#8A95A5]"><span className="font-mono">{l.ip || "—"}</span><span>{[l.city, l.country].filter(Boolean).join(", ") || "—"}</span></div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TODAY VIEW */}
      {view === "today" && (
        <div className="space-y-4 max-w-lg mx-auto sm:max-w-none">
          {/* Status Card */}
          <div className="rounded-2xl border border-[#222A35] bg-[#11161D] p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-[10px] text-[#8A95A5] uppercase tracking-wider">{todayStr()}</div>
                <div className="text-[18px] text-white font-display mt-0.5">
                  {statusInfo ? statusInfo.label : "Not checked in"}
                </div>
              </div>
              {statusInfo && (
                <div
                  className="w-12 h-12 rounded-full flex items-center justify-center"
                  style={{ background: statusInfo.bg }}
                >
                  <statusInfo.icon className="w-6 h-6" style={{ color: statusInfo.color }} />
                </div>
              )}
            </div>

            {/* Times */}
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="p-3 rounded-xl bg-[#0A0E14] border border-[#222A35] text-center">
                <div className="text-[10px] text-[#5B6675] uppercase tracking-wider">Check In</div>
                <div className="text-[16px] text-white font-display mt-1">{todayRecord?.checkIn || "—"}</div>
              </div>
              <div className="p-3 rounded-xl bg-[#0A0E14] border border-[#222A35] text-center">
                <div className="text-[10px] text-[#5B6675] uppercase tracking-wider">Check Out</div>
                <div className="text-[16px] text-white font-display mt-1">{todayRecord?.checkOut || "—"}</div>
              </div>
              <div className="p-3 rounded-xl bg-[#0A0E14] border border-[#222A35] text-center">
                <div className="text-[10px] text-[#5B6675] uppercase tracking-wider">Break</div>
                <div className="text-[16px] text-white font-display mt-1">
                  {todayRecord?.breakDuration ? `${todayRecord.breakDuration}m` : "—"}
                </div>
              </div>
            </div>

            {/* Location */}
            {todayRecord?.location && (
              <div className="flex items-center gap-1.5 text-[11px] text-[#8A95A5] mb-4">
                <MapPin className="w-3.5 h-3.5" /> {todayRecord.location}
              </div>
            )}

            {/* Action Buttons */}
            <div className="grid grid-cols-2 gap-3">
              {!todayRecord?.checkIn && (
                <button
                  onClick={checkIn}
                  disabled={loading}
                  className="h-14 rounded-2xl bg-[#22C55E] text-white text-[13px] font-medium flex items-center justify-center gap-2 hover:bg-[#2ECC5E] disabled:opacity-60"
                >
                  <LogIn className="w-5 h-5" /> Check In
                </button>
              )}
              {todayRecord?.checkIn && !todayRecord?.checkOut && (
                <>
                  {!todayRecord?.breakStart || todayRecord?.breakEnd ? (
                    <button
                      onClick={startBreak}
                      disabled={loading}
                      className="h-14 rounded-2xl bg-[#3B82F6] text-white text-[13px] font-medium flex items-center justify-center gap-2 hover:bg-[#4B92F6] disabled:opacity-60"
                    >
                      <Coffee className="w-5 h-5" /> Start Break
                    </button>
                  ) : (
                    <button
                      onClick={endBreak}
                      disabled={loading}
                      className="h-14 rounded-2xl bg-[#F5A623] text-white text-[13px] font-medium flex items-center justify-center gap-2 hover:bg-[#FFBD33] disabled:opacity-60"
                    >
                      <Coffee className="w-5 h-5" /> End Break
                    </button>
                  )}
                  <button
                    onClick={checkOut}
                    disabled={loading}
                    className="h-14 rounded-2xl bg-[#EF4444] text-white text-[13px] font-medium flex items-center justify-center gap-2 hover:bg-[#FF5555] disabled:opacity-60"
                  >
                    <LogOut className="w-5 h-5" /> Check Out
                  </button>
                </>
              )}
              {todayRecord?.checkOut && (
                <div className="col-span-2 p-4 rounded-xl bg-[#0A0E14] border border-[#222A35] text-center">
                  <div className="text-[12px] text-[#8A95A5]">
                    Shift complete. Checked out at {todayRecord.checkOut}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Report Leave / Off-day */}
          <button
            onClick={() => setShowReport(true)}
            className="w-full h-12 rounded-2xl border border-[#222A35] bg-[#11161D] text-[12px] text-[#8A95A5] flex items-center justify-center gap-2 hover:text-white hover:border-[#FF6B1A]/40"
          >
            <Briefcase className="w-4 h-4" /> Report Leave or Off-Day
          </button>

          {showReport && (
            <div className="rounded-2xl border border-[#222A35] bg-[#11161D] p-5 space-y-3">
              <div className="flex items-center gap-2 text-[13px] text-white font-display">
                <ArrowLeft className="w-4 h-4 text-[#8A95A5] cursor-pointer" onClick={() => setShowReport(false)} />
                Report Absence
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-[10px] text-[#8A95A5] uppercase tracking-wider mb-1">Type</div>
                  <select
                    value={reportType}
                    onChange={(e) => setReportType(e.target.value as "leave" | "off-day")}
                    className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-[12px] text-white"
                  >
                    <option value="leave">Leave / Sick Day</option>
                    <option value="off-day">Off Day</option>
                  </select>
                </div>
                <div>
                  <div className="text-[10px] text-[#8A95A5] uppercase tracking-wider mb-1">Date</div>
                  <input
                    type="date"
                    value={reportDate}
                    onChange={(e) => setReportDate(e.target.value)}
                    className="w-full h-9 bg-[#0A0E14] border border-[#222A35] rounded-md px-2 text-[12px] text-white"
                  />
                </div>
              </div>
              <div>
                <div className="text-[10px] text-[#8A95A5] uppercase tracking-wider mb-1">Notes</div>
                <textarea
                  value={reportNotes}
                  onChange={(e) => setReportNotes(e.target.value)}
                  rows={2}
                  placeholder="Reason for absence..."
                  className="w-full bg-[#0A0E14] border border-[#222A35] rounded-md px-3 py-2 text-[12px] text-white placeholder:text-[#5B6675]"
                />
              </div>
              <button
                onClick={submitReport}
                disabled={loading}
                className="w-full h-10 rounded-xl bg-[#FF6B1A] text-white text-[12px] font-medium hover:bg-[#FF7E33] disabled:opacity-60"
              >
                Submit Report
              </button>
            </div>
          )}
        </div>
      )}

      {/* HISTORY VIEW */}
      {view === "history" && (
        <div className="rounded-xl border border-[#222A35] bg-[#11161D] overflow-hidden">
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full min-w-[600px] text-[12px]">
              <thead>
                <tr className="text-[10px] text-[#5B6675] uppercase tracking-wider">
                  <th className="text-left px-4 py-2.5">Date</th>
                  <th className="text-left px-3 py-2.5">Status</th>
                  <th className="text-left px-3 py-2.5">In</th>
                  <th className="text-left px-3 py-2.5">Out</th>
                  <th className="text-left px-3 py-2.5">Break</th>
                  <th className="text-left px-3 py-2.5">Location</th>
                  <th className="text-left px-3 py-2.5">Notes</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => {
                  const info = STATUS_LABELS[r.status];
                  const Icon = info?.icon || Clock;
                  return (
                    <tr key={r.id} className="border-t border-[#222A35] hover:bg-[#161C24]">
                      <td className="px-4 py-2.5 text-white">{r.date}</td>
                      <td className="px-3 py-2.5">
                        <span
                          className="px-2 py-0.5 rounded-full text-[10px] flex items-center gap-1 w-fit"
                          style={{ background: info?.bg, color: info?.color }}
                        >
                          <Icon className="w-3 h-3" /> {info?.label || r.status}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-[#8A95A5]">{r.checkIn || "—"}</td>
                      <td className="px-3 py-2.5 text-[#8A95A5]">{r.checkOut || "—"}</td>
                      <td className="px-3 py-2.5 text-[#8A95A5]">
                        {r.breakDuration ? `${r.breakDuration}m` : "—"}
                      </td>
                      <td className="px-3 py-2.5 text-[#8A95A5] max-w-[120px] truncate">
                        {r.location || "—"}
                      </td>
                      <td className="px-3 py-2.5 text-[#8A95A5] max-w-[160px] truncate">
                        {r.notes || "—"}
                      </td>
                    </tr>
                  );
                })}
                {records.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-center py-8 text-[11px] text-[#5B6675]">
                      No attendance records yet
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="sm:hidden divide-y divide-[#222A35]">
            {records.length === 0 && <div className="text-center py-8 text-[11px] text-[#5B6675]">No attendance records yet</div>}
            {records.map((r) => { const info = STATUS_LABELS[r.status]; const Icon = info?.icon || Clock; return (
              <div key={r.id} className="p-3">
                <div className="flex items-center justify-between gap-2"><span className="text-[13px] text-white">{r.date}</span><span className="px-2 py-0.5 rounded-full text-[10px] flex items-center gap-1 shrink-0" style={{ background: info?.bg, color: info?.color }}><Icon className="w-3 h-3" /> {info?.label || r.status}</span></div>
                <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5 text-[11px] text-[#8A95A5]"><span>In {r.checkIn || "—"}</span><span>Out {r.checkOut || "—"}</span><span>Break {r.breakDuration ? `${r.breakDuration}m` : "—"}</span></div>
                {(r.location || r.notes) && <div className="text-[11px] text-[#8A95A5] mt-1 truncate">{[r.location, r.notes].filter(Boolean).join(" · ")}</div>}
              </div>
            ); })}
          </div>
        </div>
      )}
    </div>
  );
}
