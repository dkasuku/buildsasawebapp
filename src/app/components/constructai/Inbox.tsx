import { useState, useRef, useEffect } from "react";
import { Send, Paperclip, Search, Plus, Users, Phone, Hash, X, UserPlus, Check, Image as ImageIcon, Camera, FileText, Reply, CornerDownLeft, Download, Settings, Crown, UserMinus, Trash2, Link2, Bell, ListChecks } from "lucide-react";
import { toast } from "sonner";
import type { Role } from "./roles";
import { ROLE_COLORS } from "./roles";
import { TEAM_MEMBERS } from "./team-data";
import api from "../../services/api";

type Attachment = {
  id: string;
  name: string;
  size: string;
  type: "file" | "image" | "doc";
  url?: string;
};

type ChatMessage = {
  id: string;
  senderId: string;
  text: string;
  time: string;
  read: boolean;
  attachments?: Attachment[];
  replyToId?: string;
  taskId?: string;
  taskTitle?: string;
};

type Conversation = {
  id: string;
  type: "direct" | "group";
  name: string;
  members: string[];
  messages: ChatMessage[];
  lastActivity: string;
  pinned?: boolean;
  admins?: string[];
  creatorId?: string;
  profilePic?: string;
};

function parseMentions(text: string): { parts: { text: string; isMention: boolean }[] } {
  const regex = /@([^\s]+(?:\s[^\s]+)*?)(?=\s|$|[.,!?;:])/g;
  const parts: { text: string; isMention: boolean }[] = [];
  let lastIndex = 0;
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push({ text: text.slice(lastIndex, match.index), isMention: false });
    parts.push({ text: match[0], isMention: true });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) parts.push({ text: text.slice(lastIndex), isMention: false });
  if (parts.length === 0) parts.push({ text, isMention: false });
  return { parts };
}

const INITIAL_CONVERSATIONS: Conversation[] = [
  {
    id: "c-general",
    type: "group",
    name: "General · Harborfront Tower",
    members: ["u-contractor", "u-pm", "u-architect", "u-qs", "u-super", "u-trade-e", "u-trade-p"],
    lastActivity: "9:42 AM",
    pinned: true,
    creatorId: "u-contractor",
    admins: ["u-contractor"],
    messages: [
      { id: "m1", senderId: "u-super", text: "Concrete pour for Level 3 slab is confirmed for tomorrow 6 AM. Pump truck booked.", time: "9:42 AM", read: false },
      { id: "m2", senderId: "u-pm", text: "Great. @Amina Osei can you confirm the rebar quantities are within budget before pour?", time: "9:38 AM", read: true },
      { id: "m3", senderId: "u-qs", text: "Yes, rebar take-off is 4.2T vs budgeted 4.5T. Within 7% variance. Approved for pour.", time: "9:35 AM", read: true },
      { id: "m4", senderId: "u-trade-e", text: "Electrical conduits on east wing passed inspection. Photos uploaded via mobile.", time: "9:15 AM", read: true },
    ],
  },
  {
    id: "c-safety",
    type: "group",
    name: "Safety & Quality",
    members: ["u-contractor", "u-super", "u-trade-e", "u-trade-p", "u-worker-1", "u-worker-2"],
    lastActivity: "Yesterday",
    pinned: true,
    creatorId: "u-contractor",
    admins: ["u-contractor", "u-super"],
    messages: [
      { id: "m5", senderId: "u-contractor", text: "Mandatory safety stand-down June 2nd, 7 AM. All crews must attend.", time: "Yesterday", read: true },
      { id: "m6", senderId: "u-worker-1", text: "Understood. Will bring the new fall protection harnesses.", time: "Yesterday", read: true },
    ],
  },
  {
    id: "c-direct-pm",
    type: "direct",
    name: "Sarah Patel",
    members: ["u-contractor", "u-pm"],
    lastActivity: "8:30 AM",
    messages: [
      { id: "m7", senderId: "u-pm", text: "Owner approved the CO-1284 budget adjustment. We can proceed with curtain wall reinforcement.", time: "8:30 AM", read: false },
      { id: "m8", senderId: "u-contractor", text: "Excellent. Please update the schedule and notify the glazing sub.", time: "8:15 AM", read: true },
    ],
  },
  {
    id: "c-direct-arch",
    type: "direct",
    name: "James Chen",
    members: ["u-contractor", "u-architect"],
    lastActivity: "Yesterday",
    messages: [
      { id: "m9", senderId: "u-architect", text: "M-401 Rev 4 is published. Please distribute to all trades.", time: "Yesterday", read: true, attachments: [{ id: "a1", name: "M-401_Rev4.pdf", size: "4.2 MB", type: "doc" }] },
    ],
  },
  {
    id: "c-mobile",
    type: "group",
    name: "Field Uploads · Mobile",
    members: ["u-contractor", "u-super", "u-trade-e", "u-trade-p", "u-worker-1", "u-worker-2"],
    lastActivity: "8:15 AM",
    creatorId: "u-contractor",
    admins: ["u-contractor"],
    messages: [
      { id: "m10", senderId: "u-trade-e", text: "Daily log submitted — Riverside Plaza. 24 workers, weather clear.", time: "8:15 AM", read: false },
      { id: "m11", senderId: "u-worker-2", text: "Uploaded progress photos for Level 2 drywall. 12 images attached.", time: "Yesterday", read: true, attachments: [{ id: "a2", name: "drywall-l2.zip", size: "18.4 MB", type: "file" }] },
    ],
  },
];

export function Inbox({ role = "Contractor" }: { role?: Role }) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [showMembers, setShowMembers] = useState(false);
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [newGroup, setNewGroup] = useState({ name: "", memberIds: [] as string[] });
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [mentionQuery, setMentionQuery] = useState("");
  const [showMentions, setShowMentions] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const groupProfilePicInputRef = useRef<HTMLInputElement>(null);

  const [showGroupSettings, setShowGroupSettings] = useState(false);
  const [groupEditName, setGroupEditName] = useState("");
  const [groupProfilePic, setGroupProfilePic] = useState("");
  const [showAddMember, setShowAddMember] = useState(false);
  const [confirmDeleteGroup, setConfirmDeleteGroup] = useState(false);

  // Task linking
  const [linkTaskOpen, setLinkTaskOpen] = useState(false);
  const [linkedTaskId, setLinkedTaskId] = useState<string | null>(null);
  const [linkedTaskTitle, setLinkedTaskTitle] = useState<string>("");

  // Push notification simulation
  const [pushEnabled, setPushEnabled] = useState(() => { try { return localStorage.getItem("bf-push-enabled") === "true"; } catch { return true; } });
  const [showPushSettings, setShowPushSettings] = useState(false);

  // WebSocket
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set());

  const selected = conversations.find((c) => c.id === selectedId);

  // Fetch conversations from API
  useEffect(() => {
    api.getConversations().then((rows) => {
      const mapped: Conversation[] = rows.map((r) => ({
        id: r.id,
        type: r.type as "direct" | "group",
        name: r.name || (r.type === "direct" ? "Direct Chat" : "Group Chat"),
        members: r.members.map((m) => m.userId),
        messages: (r.messages || []).map((m) => ({
          id: m.id,
          senderId: m.userId,
          text: m.text,
          time: new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          read: m.read,
          attachments: m.attachment ? [{ id: `att-${m.id}`, name: "attachment", size: "", type: "file" as const, url: m.attachment }] : undefined,
          replyToId: m.replyToId || undefined,
        })),
        lastActivity: r.messages && r.messages[0] ? new Date(r.messages[0].createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "Just now",
        pinned: false,
        creatorId: r.creatorId || undefined,
        admins: r.members.filter((m) => m.role === "admin").map((m) => m.userId),
        profilePic: r.profilePic || undefined,
      }));
      setConversations(mapped);
      if (mapped.length > 0 && !selectedId) setSelectedId(mapped[0].id);
    }).catch(() => {
      // fallback to seed data if API fails
      setConversations(INITIAL_CONVERSATIONS);
      if (!selectedId) setSelectedId(INITIAL_CONVERSATIONS[0]?.id || null);
    });
  }, []);

  // Load full messages when selecting a conversation
  useEffect(() => {
    if (!selectedId) return;
    api.getConversationMessages(selectedId).then((rows) => {
      setConversations((prev) => prev.map((c) => c.id === selectedId ? {
        ...c,
        messages: rows.map((m) => ({
          id: m.id,
          senderId: m.userId,
          text: m.text,
          time: new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          read: m.read,
          attachments: m.attachment ? [{ id: `att-${m.id}`, name: "attachment", size: "", type: "file" as const, url: m.attachment }] : undefined,
          replyToId: m.replyToId || undefined,
        })),
      } : c));
    }).catch(() => { /* keep existing messages */ });
  }, [selectedId]);

  // WebSocket connection
  useEffect(() => {
    const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";
    const wsUrl = API_URL.replace(/^http/, "ws") + "/ws";
    const socket = new WebSocket(wsUrl);
    socket.onopen = () => {
      setConnected(true);
      socket.send(JSON.stringify({ type: "auth", userId: myId }));
    };
    socket.onclose = () => setConnected(false);
    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === "message" && payload.data) {
          const m = payload.data;
          setConversations((prev) => prev.map((c) => {
            if (c.id !== m.conversationId) return c;
            const exists = c.messages.some((msg) => msg.id === m.id);
            if (exists) return c;
            const newMsg: ChatMessage = {
              id: m.id,
              senderId: m.userId,
              text: m.text,
              time: new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
              read: m.read,
              attachments: m.attachment ? [{ id: `att-${m.id}`, name: "attachment", size: "", type: "file" as const, url: m.attachment }] : undefined,
              replyToId: m.replyToId || undefined,
            };
            return { ...c, messages: [...c.messages, newMsg], lastActivity: newMsg.time };
          }));
        }
        if (payload.type === "typing") {
          setTypingUsers((prev) => { const n = new Set(prev); n.add(payload.userId); setTimeout(() => setTypingUsers((p) => { const r = new Set(p); r.delete(payload.userId); return r; }), 3000); return n; });
        }
      } catch { /* noop */ }
    };
    setWs(socket);
    return () => { socket.close(); };
  }, []);
  const isContractor = role === "Contractor";

  const filteredConversations = conversations.filter((c) => {
    if (!query) return true;
    const hay = (c.name + " " + c.messages.map((m) => m.text).join(" ")).toLowerCase();
    return hay.includes(query.toLowerCase());
  });

  const sendMessage = async () => {
    if (!draft.trim() && attachments.length === 0) return;
    if (!selectedId) return;
    const text = draft.trim();
    const replyId = replyingTo?.id;
    const attachmentUrl = attachments.length > 0 ? attachments[0].url : undefined;
    const taskId = linkedTaskId || undefined;
    const taskTitle = linkedTaskTitle || undefined;

    // Send via WebSocket for real-time
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "message", conversationId: selectedId, text, attachment: attachmentUrl, replyToId: replyId, taskId, taskTitle }));
    }

    // Fallback / persistence via REST
    try {
      const row = await api.createChatMessage(selectedId, { text, attachment: attachmentUrl, replyToId: replyId, taskId, taskTitle });
      const newMsg: ChatMessage = {
        id: row.id,
        senderId: row.userId,
        text: row.text,
        time: new Date(row.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        read: row.read,
        attachments: row.attachment ? [{ id: `att-${row.id}`, name: "attachment", size: "", type: "file" as const, url: row.attachment }] : undefined,
        replyToId: row.replyToId || undefined,
        taskId: row.taskId || undefined,
        taskTitle: row.taskTitle || undefined,
      };
      setConversations((prev) => prev.map((c) => c.id === selectedId ? { ...c, messages: [...c.messages, newMsg], lastActivity: newMsg.time } : c));
      if (pushEnabled) toast.success("Push: New message sent", { description: `${selected?.name}: ${text.slice(0, 40)}${text.length > 40 ? "…" : ""}` });
    } catch {
      // offline: append locally
      const localMsg: ChatMessage = {
        id: `local-${Date.now()}`, senderId: myId, text: text || "", time: "Now", read: false,
        attachments: attachments.length > 0 ? [...attachments] : undefined, replyToId: replyId,
        taskId, taskTitle,
      };
      setConversations((prev) => prev.map((c) => c.id === selectedId ? { ...c, messages: [...c.messages, localMsg], lastActivity: "Now" } : c));
    }
    setDraft("");
    setAttachments([]);
    setReplyingTo(null);
    setLinkedTaskId(null);
    setLinkedTaskTitle("");
    setLinkTaskOpen(false);
  };

  const createGroup = async () => {
    if (!newGroup.name.trim() || newGroup.memberIds.length < 2) return toast.error("Group needs a name and at least 2 members");
    try {
      const row = await api.createConversation({ name: newGroup.name.trim(), type: "group", memberIds: newGroup.memberIds });
      const group: Conversation = {
        id: row.id, type: "group", name: row.name || "Group Chat",
        members: row.members.map((m) => m.userId), messages: [], lastActivity: "Just now",
        creatorId: row.creatorId || myId,
        admins: row.members.filter((m) => m.role === "admin").map((m) => m.userId),
      };
      setConversations((prev) => [group, ...prev]);
      setSelectedId(group.id);
    } catch {
      const localGroup: Conversation = {
        id: `local-${Date.now()}`, type: "group", name: newGroup.name.trim(),
        members: newGroup.memberIds, messages: [], lastActivity: "Just now",
        creatorId: myId, admins: [myId],
      };
      setConversations((prev) => [localGroup, ...prev]);
      setSelectedId(localGroup.id);
    }
    setShowNewGroup(false);
    setNewGroup({ name: "", memberIds: [] });
    toast.success("Group created");
  };

  const isGroupAdmin = (conv: Conversation) => conv.admins?.includes(myId) ?? false;
  const canDeleteGroup = (conv: Conversation) => conv.creatorId === myId || myId === "u-contractor";

  const deleteGroup = async () => {
    if (!selectedId) return;
    try { await api.deleteConversation(selectedId); } catch { /* noop */ }
    setConversations((prev) => prev.filter((c) => c.id !== selectedId));
    setSelectedId(null);
    setShowGroupSettings(false);
    setConfirmDeleteGroup(false);
    toast.success("Group deleted");
  };

  const updateGroupName = async () => {
    if (!selectedId || !groupEditName.trim()) return;
    try { await api.renameConversation(selectedId, groupEditName.trim()); } catch { /* noop */ }
    setConversations((prev) => prev.map((c) => c.id === selectedId ? { ...c, name: groupEditName.trim() } : c));
    toast.success("Group name updated");
  };

  const updateGroupProfilePic = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedId) return;
    const blobUrl = URL.createObjectURL(file);
    blobUrlsRef.current.push(blobUrl);
    setConversations((prev) => prev.map((c) => c.id === selectedId ? { ...c, profilePic: blobUrl } : c));
    setGroupProfilePic(blobUrl);
    toast.success("Group profile updated");
    e.target.value = "";
    // Persist in the background, then swap the blob URL for the stored one.
    api.uploadFile(file).then((u) => { setConversations((prev) => prev.map((c) => c.id === selectedId ? { ...c, profilePic: u } : c)); setGroupProfilePic(u); }).catch(() => {});
  };

  const addMemberToGroup = async (memberId: string) => {
    if (!selectedId) return;
    try { await api.addConversationMember(selectedId, memberId); } catch { /* noop */ }
    setConversations((prev) => prev.map((c) => {
      if (c.id !== selectedId || c.members.includes(memberId)) return c;
      return { ...c, members: [...c.members, memberId] };
    }));
    toast.success("Member added");
  };

  const removeMemberFromGroup = async (memberId: string) => {
    if (!selectedId) return;
    try { await api.removeConversationMember(selectedId, memberId); } catch { /* noop */ }
    setConversations((prev) => prev.map((c) => {
      if (c.id !== selectedId) return c;
      const newMembers = c.members.filter((id) => id !== memberId);
      const newAdmins = c.admins?.filter((id) => id !== memberId);
      return { ...c, members: newMembers, admins: newAdmins };
    }));
    toast.success("Member removed");
  };

  const toggleAdmin = (memberId: string) => {
    if (!selectedId) return;
    setConversations((prev) => prev.map((c) => {
      if (c.id !== selectedId) return c;
      const isAdmin = c.admins?.includes(memberId) ?? false;
      const newAdmins = isAdmin ? c.admins?.filter((id) => id !== memberId) : [...(c.admins ?? []), memberId];
      return { ...c, admins: newAdmins };
    }));
    toast.success("Admin status updated");
  };

  const toggleMember = (id: string) => {
    setNewGroup((prev) => ({
      ...prev,
      memberIds: prev.memberIds.includes(id) ? prev.memberIds.filter((m) => m !== id) : [...prev.memberIds, id],
    }));
  };

  const getMember = (id: string) => TEAM_MEMBERS.find((m) => m.id === id);
  const myId = "u-contractor";
  const getMessage = (id?: string) => selected?.messages.find((m) => m.id === id);

  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleDraftChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setDraft(val);
    if (ws && ws.readyState === WebSocket.OPEN && selectedId) {
      ws.send(JSON.stringify({ type: "typing", conversationId: selectedId }));
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => { typingTimeoutRef.current = null; }, 2000);
    }
    const lastAt = val.lastIndexOf("@");
    if (lastAt !== -1 && (lastAt === 0 || val[lastAt - 1] === " ")) {
      const q = val.slice(lastAt + 1);
      if (!q.includes(" ")) { setMentionQuery(q); setShowMentions(true); }
      else { setShowMentions(false); }
    } else {
      setShowMentions(false);
    }
  };

  const insertMention = (name: string) => {
    const lastAt = draft.lastIndexOf("@");
    const before = draft.slice(0, lastAt);
    setDraft(before + "@" + name + " ");
    setShowMentions(false);
    inputRef.current?.focus();
  };

  const mentionCandidates = selected
    ? TEAM_MEMBERS.filter((m) => selected.members.includes(m.id) && m.name.toLowerCase().includes(mentionQuery.toLowerCase()))
    : [];

  const blobUrlsRef = useRef<string[]>([]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>, type: "file" | "image") => {
    const file = e.target.files?.[0];
    if (!file) return;
    const size = file.size > 1024 * 1024 ? (file.size / (1024 * 1024)).toFixed(1) + " MB" : (file.size / 1024).toFixed(0) + " KB";
    const ext = file.name.split(".").pop()?.toLowerCase() || "";
    const fileType: Attachment["type"] = type === "image" ? "image" : (["pdf", "doc", "docx", "xls", "xlsx"].includes(ext) ? "doc" : "file");
    const blobUrl = URL.createObjectURL(file);
    blobUrlsRef.current.push(blobUrl);
    const att: Attachment = { id: "a-" + Date.now(), name: file.name, size, type: fileType, url: blobUrl };
    setAttachments((prev) => [...prev, att]);
    setShowAttachMenu(false);
    toast.success("Attached: " + file.name);
    // Persist to storage in the background, then swap the blob URL for the real one.
    api.uploadFile(file).then((u) => setAttachments((prev) => prev.map((a) => (a.id === att.id ? { ...a, url: u } : a)))).catch(() => {});
    e.target.value = "";
  };

  const openAttachment = (a: Attachment) => {
    if (a.url) {
      const link = document.createElement("a");
      link.href = a.url;
      link.download = a.name;
      link.target = "_blank";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } else {
      toast(`Opening ${a.name}...`);
    }
  };

  const removeAttachment = (id: string) => setAttachments((prev) => prev.filter((a) => a.id !== id));

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (showAttachMenu && !(e.target as HTMLElement).closest("[data-attach-menu]")) setShowAttachMenu(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showAttachMenu]);

  return (
    <div className="px-4 sm:px-7 py-5 sm:py-6 h-[calc(100vh-64px)] flex flex-col">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0 mb-4">
        <div>
          <div className="text-[15px] text-white font-display flex items-center gap-2">Team Inbox <span className={`w-2 h-2 rounded-full ${connected ? "bg-[#22C55E]" : "bg-[#EF4444]"}`} title={connected ? "Connected" : "Disconnected"} /></div>
          <div className="text-[11px] text-[#8A95A5]">{TEAM_MEMBERS.filter((m) => m.online).length} online · {conversations.length} conversations</div>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#5B6675]" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search conversations..."
              className="h-8 w-[200px] sm:w-[260px] pl-8 pr-3 rounded-md bg-[#11161D] border border-[#222A35] text-[12px] text-white placeholder:text-[#5B6675] focus:outline-none focus:border-[#FF6B1A]"
            />
          </div>
          {isContractor && (
            <button onClick={() => setShowNewGroup(true)} className="h-8 px-3 rounded-md bg-[#FF6B1A] text-white text-[12px] flex items-center gap-1.5">
              <Plus className="w-3.5 h-3.5" /> New Group
            </button>
          )}
          <button
            onClick={() => setShowMembers((s) => !s)}
            className={`h-8 px-3 rounded-md border text-[12px] flex items-center gap-1.5 ${showMembers ? "bg-[#161C24] border-[#FF6B1A] text-white" : "border-[#222A35] text-[#8A95A5] hover:text-white"}`}
          >
            <Users className="w-3.5 h-3.5" /> Team
          </button>
        </div>
      </div>

      <div className="flex-1 flex gap-4 min-h-0">
        {/* Conversations list */}
        <div className={`${selectedId && !showMembers ? "hidden lg:flex" : "flex"} ${showMembers ? "hidden lg:flex" : ""} flex-col w-full lg:w-[340px] shrink-0 rounded-xl border border-[#222A35] bg-[#11161D] overflow-hidden`}>
          <div className="overflow-y-auto flex-1">
            {filteredConversations.map((c) => {
              const last = c.messages[c.messages.length - 1];
              const sender = last ? getMember(last.senderId) : null;
              const unreadCount = c.messages.filter((m) => !m.read && m.senderId !== myId).length;
              return (
                <button
                  key={c.id}
                  onClick={() => { setSelectedId(c.id); setShowMembers(false); }}
                  className={`w-full text-left p-3 border-b border-[#222A35] hover:bg-[#161C24] transition flex gap-3 ${selectedId === c.id ? "bg-[#161C24]" : ""}`}
                >
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#FF6B1A] to-[#F5A623] flex items-center justify-center text-white text-[11px] font-medium shrink-0">
                    {c.type === "group" ? <Hash className="w-4 h-4" /> : getMember(c.members.find((id) => id !== myId) || "")?.initials || "?"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[12px] text-white truncate">{c.name}</span>
                      <span className="text-[10px] text-[#5B6675] shrink-0">{c.lastActivity}</span>
                    </div>
                    {last && (
                      <div className="text-[11px] text-[#8A95A5] truncate mt-0.5">
                        {sender?.name}: {last.text}
                      </div>
                    )}
                    {c.type === "group" && (
                      <div className="text-[10px] text-[#5B6675] mt-0.5">{c.members.length} members</div>
                    )}
                  </div>
                  {unreadCount > 0 && (
                    <span className="shrink-0 w-5 h-5 rounded-full bg-[#FF6B1A] text-white text-[10px] flex items-center justify-center">{unreadCount}</span>
                  )}
                </button>
              );
            })}
            {filteredConversations.length === 0 && (
              <div className="p-8 text-center text-[12px] text-[#5B6675]">No conversations found.</div>
            )}
          </div>
        </div>

        {/* Members panel (toggleable) */}
        {showMembers && selected && (
          <div className="flex-1 lg:flex-none lg:w-[300px] flex flex-col rounded-xl border border-[#222A35] bg-[#11161D] overflow-hidden">
            <div className="px-4 py-3 border-b border-[#222A35] flex items-center justify-between shrink-0">
              <div className="text-[13px] text-white font-display">{selected.type === "group" ? "Group Members" : "Chat Info"}</div>
              <button onClick={() => setShowMembers(false)} className="lg:hidden w-7 h-7 rounded-md text-[#8A95A5] hover:text-white flex items-center justify-center">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 p-3 space-y-2">
              {selected.type === "group" && isGroupAdmin(selected) && (
                <button onClick={() => { setShowGroupSettings(true); setGroupEditName(selected.name); setGroupProfilePic(selected.profilePic || ""); setShowAddMember(true); }} className="w-full flex items-center justify-center gap-2 p-2 rounded-lg border border-dashed border-[#222A35] text-[11px] text-[#8A95A5] hover:text-white hover:border-[#FF6B1A]/40 hover:bg-[#161C24] transition">
                  <UserPlus className="w-3.5 h-3.5" /> Add Member
                </button>
              )}

              {selected.type === "group" ? selected.members.map((memberId) => {
                const m = getMember(memberId);
                if (!m) return null;
                const isAdmin = selected.admins?.includes(memberId) ?? false;
                const isMe = memberId === myId;
                const amAdmin = isGroupAdmin(selected);
                return (
                  <div key={memberId} className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-[#161C24] transition">
                    <div className="relative">
                      <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-[10px] font-medium" style={{ background: ROLE_COLORS[m.role] }}>
                        {m.initials}
                      </div>
                      {m.online && (
                        <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-[#22C55E] border-2 border-[#11161D]" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] text-white truncate flex items-center gap-1">
                        {m.name}
                        {isAdmin && <Crown className="w-3 h-3 text-[#F5A623] shrink-0" />}
                        {isMe && <span className="text-[9px] text-[#5B6675]">You</span>}
                      </div>
                      <div className="text-[10px] text-[#8A95A5] flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: ROLE_COLORS[m.role] }} />
                        {m.role}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      {amAdmin && !isMe && (
                        <>
                          <button onClick={() => toggleAdmin(memberId)} className="h-6 px-1.5 rounded text-[9px] flex items-center gap-0.5 border" title={isAdmin ? "Remove admin" : "Make admin"}>
                            {isAdmin ? <><Crown className="w-2.5 h-2.5 text-[#F5A623]" /> <span className="text-[#F5A623]">Admin</span></> : <><Crown className="w-2.5 h-2.5 text-[#5B6675]" /> <span className="text-[#5B6675]">Admin</span></>}
                          </button>
                          <button onClick={() => removeMemberFromGroup(memberId)} className="w-6 h-6 rounded flex items-center justify-center text-[#5B6675] hover:text-[#EF4444] hover:bg-[#EF4444]/10" title="Remove">
                            <UserMinus className="w-3 h-3" />
                          </button>
                        </>
                      )}
                      {(!amAdmin || isMe) && m.phone && (
                        <button onClick={() => toast(`Calling ${m.phone}`)} className="w-7 h-7 rounded-md text-[#5B6675] hover:text-[#22C55E] hover:bg-[#161C24] flex items-center justify-center">
                          <Phone className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              }) : (
                /* Direct chat: show the other person */
                (() => {
                  const otherId = selected.members.find((id) => id !== myId);
                  const m = getMember(otherId || "");
                  if (!m) return null;
                  return (
                    <div className="flex items-center gap-3 p-2 rounded-lg">
                      <div className="relative">
                        <div className="w-10 h-10 rounded-full flex items-center justify-center text-white text-[11px] font-medium" style={{ background: ROLE_COLORS[m.role] }}>{m.initials}</div>
                        {m.online && <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-[#22C55E] border-2 border-[#11161D]" />}
                      </div>
                      <div>
                        <div className="text-[13px] text-white">{m.name}</div>
                        <div className="text-[10px] text-[#8A95A5] flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full" style={{ background: ROLE_COLORS[m.role] }} />{m.role}</div>
                        {m.phone && <div className="text-[10px] text-[#5B6675] mt-0.5">{m.phone}</div>}
                      </div>
                      {m.phone && (
                        <button onClick={() => toast(`Calling ${m.phone}`)} className="ml-auto w-8 h-8 rounded-md bg-[#22C55E]/10 text-[#22C55E] hover:bg-[#22C55E]/20 flex items-center justify-center">
                          <Phone className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  );
                })()
              )}
            </div>

            {/* Role legend */}
            <div className="px-4 py-3 border-t border-[#222A35] shrink-0">
              <div className="text-[10px] text-[#5B6675] uppercase tracking-wider mb-2">Role Key</div>
              <div className="flex flex-wrap gap-2">
                {(Object.keys(ROLE_COLORS) as Role[]).map((r) => (
                  <span key={r} className="text-[9px] px-1.5 py-0.5 rounded bg-[#0A0E14] text-[#8A95A5] flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: ROLE_COLORS[r] }} />
                    {r}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Chat area */}
        {selected && !showMembers ? (
          <div className="flex-1 flex flex-col rounded-xl border border-[#222A35] bg-[#11161D] overflow-hidden">
            {/* Chat header */}
            <div className="px-4 py-3 border-b border-[#222A35] flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#FF6B1A] to-[#F5A623] flex items-center justify-center text-white overflow-hidden">
                  {selected.profilePic ? <img src={selected.profilePic} alt="" className="w-full h-full object-cover" /> : selected.type === "group" ? <Hash className="w-4 h-4" /> : getMember(selected.members.find((id) => id !== myId) || "")?.initials || "?"}
                </div>
                <div>
                  <div className="text-[13px] text-white flex items-center gap-1.5">
                    {selected.name}
                    {selected.type === "group" && selected.admins?.includes(myId) && <Crown className="w-3 h-3 text-[#F5A623]" />}
                  </div>
                  <div className="text-[10px] text-[#8A95A5]">
                    {selected.type === "group"
                      ? `${selected.members.length} members · ${selected.members.filter((id) => getMember(id)?.online).length} online${selected.admins?.includes(myId) ? " · Admin" : ""}`
                      : getMember(selected.members.find((id) => id !== myId) || "")?.online
                        ? "Online"
                        : `Last seen ${getMember(selected.members.find((id) => id !== myId) || "")?.lastSeen || ""}`}
                    {Array.from(typingUsers).filter((id) => id !== myId && selected.members.includes(id)).length > 0 && (
                      <span className="ml-2 text-[#3B82F6]">typing...</span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {selected.type === "group" && isGroupAdmin(selected) && (
                  <button onClick={() => { setShowGroupSettings(true); setGroupEditName(selected.name); setGroupProfilePic(selected.profilePic || ""); }} className="h-8 px-2.5 rounded-md border border-[#222A35] text-[11px] text-[#8A95A5] hover:text-white flex items-center gap-1.5">
                    <Settings className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Manage</span>
                  </button>
                )}
                <button onClick={() => setLinkTaskOpen(true)} className={`h-8 px-2.5 rounded-md border text-[11px] flex items-center gap-1.5 ${linkedTaskId ? "border-[#3B82F6]/30 text-[#3B82F6] bg-[#3B82F6]/10" : "border-[#222A35] text-[#8A95A5] hover:text-white"}`}>
                  <Link2 className="w-3.5 h-3.5" /> <span className="hidden sm:inline">{linkedTaskId ? linkedTaskTitle.slice(0, 14) + (linkedTaskTitle.length > 14 ? "…" : "") : "Link Task"}</span>
                </button>
                <button onClick={() => setShowPushSettings(true)} className="h-8 w-8 rounded-md border border-[#222A35] text-[#8A95A5] hover:text-white flex items-center justify-center shrink-0" title="Push notifications">
                  <Bell className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
              {selected.messages.map((msg) => {
                const isMe = msg.senderId === myId;
                const sender = getMember(msg.senderId);
                const replyTo = msg.replyToId ? getMessage(msg.replyToId) : undefined;
                const replySender = replyTo ? getMember(replyTo.senderId) : undefined;
                const { parts } = parseMentions(msg.text);
                return (
                  <div key={msg.id} className={`flex gap-3 ${isMe ? "flex-row-reverse" : ""}`}>
                    <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-[9px] font-medium shrink-0" style={{ background: ROLE_COLORS[sender?.role || "Contractor"] }}>{sender?.initials || "?"}</div>
                    <div className={`max-w-[70%] ${isMe ? "items-end" : "items-start"} flex flex-col`}>
                      <div className={`text-[10px] text-[#5B6675] mb-0.5 ${isMe ? "text-right" : ""}`}>{sender?.name} · {msg.time}</div>
                      {replyTo && (
                        <div className="w-full mb-1 pl-2 border-l-2 border-[#FF6B1A] py-1">
                          <div className="text-[9px] text-[#8A95A5]">Reply to {replySender?.name}</div>
                          <div className="text-[10px] text-[#5B6675] truncate">{replyTo.text}</div>
                        </div>
                      )}
                      <div className={`px-3 py-2 rounded-xl text-[12px] leading-relaxed ${isMe ? "bg-[#FF6B1A]/15 text-white rounded-tr-none" : "bg-[#0A0E14] text-[#C2CAD6] rounded-tl-none border border-[#222A35]"}`}>
                        {parts.map((p, i) => p.isMention ? <span key={i} className="text-[#FF6B1A] font-medium bg-[#FF6B1A]/10 px-1 rounded">{p.text}</span> : <span key={i}>{p.text}</span>)}
                      </div>
                      {msg.taskId && msg.taskTitle && (
                        <button onClick={() => toast(`Opening task: ${msg.taskTitle}`)} className="mt-1.5 flex items-center gap-1.5 text-[10px] px-2 py-1 rounded-md bg-[#3B82F6]/10 text-[#3B82F6] border border-[#3B82F6]/30 self-start hover:bg-[#3B82F6]/20">
                          <ListChecks className="w-3 h-3" /> Linked: {msg.taskTitle}
                        </button>
                      )}
                      {msg.attachments && (
                        <div className="mt-1.5 space-y-1">
                          {msg.attachments.map((a) => (
                            <button
                              key={a.id}
                              onClick={() => openAttachment(a)}
                              className="w-full flex items-center gap-2 p-1.5 rounded-md bg-[#0A0E14] border border-[#222A35] text-[11px] text-[#8A95A5] hover:bg-[#161C24] hover:border-[#3B82F6]/30 transition cursor-pointer"
                            >
                              {a.type === "image" ? <ImageIcon className="w-3 h-3 text-[#3B82F6]" /> : a.type === "doc" ? <FileText className="w-3 h-3 text-[#F5A623]" /> : <Paperclip className="w-3 h-3" />}
                              <span className="text-white truncate">{a.name}</span>
                              <span className="ml-auto shrink-0">{a.size}</span>
                              <Download className="w-3 h-3 text-[#5B6675] hover:text-[#3B82F6] shrink-0" />
                            </button>
                          ))}
                        </div>
                      )}
                      <button onClick={() => setReplyingTo(msg)} className="mt-0.5 text-[9px] text-[#5B6675] hover:text-[#FF6B1A] flex items-center gap-0.5 self-start"><Reply className="w-3 h-3" /> Reply</button>
                    </div>
                  </div>
                );
              })}
              {selected.messages.length === 0 && <div className="flex-1 flex items-center justify-center text-[12px] text-[#5B6675]">No messages yet. Start the conversation.</div>}
            </div>

            {/* Input */}
            <div className="px-4 py-3 border-t border-[#222A35] shrink-0 space-y-2">
              {/* Reply preview */}
              {replyingTo && (
                <div className="flex items-center gap-2 p-2 rounded-md bg-[#0A0E14] border border-[#222A35]">
                  <CornerDownLeft className="w-3.5 h-3.5 text-[#FF6B1A] shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] text-[#8A95A5]">Replying to {getMember(replyingTo.senderId)?.name}</div>
                    <div className="text-[11px] text-[#5B6675] truncate">{replyingTo.text}</div>
                  </div>
                  <button onClick={() => setReplyingTo(null)} className="w-6 h-6 rounded-md text-[#5B6675] hover:text-white flex items-center justify-center"><X className="w-3 h-3" /></button>
                </div>
              )}
              {/* Attachment chips */}
              {attachments.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {attachments.map((a) => (
                    <span key={a.id} className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded bg-[#0A0E14] border border-[#222A35] text-[#8A95A5]">
                      {a.type === "image" ? <ImageIcon className="w-3 h-3 text-[#3B82F6]" /> : a.type === "doc" ? <FileText className="w-3 h-3 text-[#F5A623]" /> : <Paperclip className="w-3 h-3" />}
                      <span className="text-white">{a.name}</span>
                      <button onClick={() => removeAttachment(a.id)} className="text-[#5B6675] hover:text-[#EF4444]"><X className="w-3 h-3" /></button>
                    </span>
                  ))}
                </div>
              )}
              <div className="flex gap-2 relative">
                <div data-attach-menu className="relative">
                  <button onClick={() => setShowAttachMenu((s) => !s)} className="w-10 h-10 rounded-md bg-[#0A0E14] border border-[#222A35] flex items-center justify-center text-[#5B6675] hover:text-white"><Paperclip className="w-4 h-4" /></button>
                  {showAttachMenu && (
                    <div className="absolute bottom-full left-0 mb-2 w-44 rounded-lg border border-[#222A35] bg-[#11161D] shadow-lg overflow-hidden z-20">
                      <button onClick={() => { fileInputRef.current?.click(); }} className="w-full flex items-center gap-2.5 px-3 py-2.5 text-[12px] text-[#C2CAD6] hover:bg-[#161C24]"><FileText className="w-4 h-4 text-[#F5A623]" /> Attach Document</button>
                      <button onClick={() => { photoInputRef.current?.click(); }} className="w-full flex items-center gap-2.5 px-3 py-2.5 text-[12px] text-[#C2CAD6] hover:bg-[#161C24]"><ImageIcon className="w-4 h-4 text-[#22C55E]" /> Attach Photo</button>
                      <button onClick={() => { cameraInputRef.current?.click(); }} className="w-full flex items-center gap-2.5 px-3 py-2.5 text-[12px] text-[#C2CAD6] hover:bg-[#161C24]"><Camera className="w-4 h-4 text-[#3B82F6]" /> Take Photo</button>
                    </div>
                  )}
                </div>
                <input ref={fileInputRef} type="file" className="hidden" onChange={(e) => handleFileSelect(e, "file")} />
                <input ref={photoInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => handleFileSelect(e, "image")} />
                <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => handleFileSelect(e, "image")} />
                <div className="flex-1 relative">
                  <input
                    ref={inputRef}
                    value={draft}
                    onChange={handleDraftChange}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                    placeholder="Type a message... Use @ to mention"
                    className="w-full h-10 bg-[#0A0E14] border border-[#222A35] rounded-md px-3 text-[12px] text-white placeholder:text-[#5B6675] focus:outline-none focus:border-[#FF6B1A]"
                  />
                  {/* Mention dropdown */}
                  {showMentions && mentionCandidates.length > 0 && (
                    <div className="absolute bottom-full left-0 mb-1 w-56 max-h-48 overflow-y-auto rounded-lg border border-[#222A35] bg-[#11161D] shadow-lg z-20">
                      {mentionCandidates.map((m) => (
                        <button key={m.id} onClick={() => insertMention(m.name)} className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[#161C24]">
                          <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[9px]" style={{ background: ROLE_COLORS[m.role] }}>{m.initials}</div>
                          <div className="text-[12px] text-white">{m.name}</div>
                          <div className="text-[10px] text-[#5B6675] ml-auto">{m.role}</div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  onClick={sendMessage}
                  disabled={!draft.trim() && attachments.length === 0}
                  className="h-10 px-3 rounded-md bg-[#FF6B1A] text-white text-[12px] flex items-center gap-1.5 disabled:opacity-40"
                >
                  <Send className="w-3.5 h-3.5" /> Send
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {/* New Group Modal */}
      {showNewGroup && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start sm:items-center justify-center p-4 overflow-y-auto" onClick={() => setShowNewGroup(false)}>
          <div className="w-full max-w-[480px] rounded-xl border border-[#222A35] bg-[#11161D] p-5 sm:p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div className="text-[15px] text-white font-display">Create Group</div>
              <button onClick={() => setShowNewGroup(false)} className="w-7 h-7 rounded-md text-[#8A95A5] hover:text-white hover:bg-[#161C24] flex items-center justify-center">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-[11px] text-[#8A95A5] block mb-1">Group Name</label>
                <input
                  value={newGroup.name}
                  onChange={(e) => setNewGroup({ ...newGroup, name: e.target.value })}
                  placeholder="e.g. MEP Coordination"
                  className="w-full h-9 px-3 rounded-md bg-[#0A0E14] border border-[#222A35] text-[13px] text-white placeholder:text-[#5B6675] focus:outline-none focus:border-[#FF6B1A]"
                />
              </div>
              <div>
                <label className="text-[11px] text-[#8A95A5] block mb-2">Select Members ({newGroup.memberIds.length} selected)</label>
                <div className="max-h-[280px] overflow-y-auto space-y-1 rounded-lg border border-[#222A35] bg-[#0A0E14] p-2">
                  {TEAM_MEMBERS.map((m) => {
                    const selected = newGroup.memberIds.includes(m.id);
                    return (
                      <button
                        key={m.id}
                        onClick={() => toggleMember(m.id)}
                        className={`w-full flex items-center gap-3 p-2 rounded-md text-left transition ${selected ? "bg-[#FF6B1A]/10 border border-[#FF6B1A]/30" : "hover:bg-[#161C24]"}`}
                      >
                        <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-[10px] font-medium" style={{ background: ROLE_COLORS[m.role] }}>
                          {m.initials}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[12px] text-white">{m.name}</div>
                          <div className="text-[10px] text-[#8A95A5]">{m.role}</div>
                        </div>
                        {selected && <Check className="w-4 h-4 text-[#FF6B1A] shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              </div>
              <button onClick={createGroup} className="w-full h-10 rounded-md bg-[#FF6B1A] text-white text-[13px] flex items-center justify-center gap-1.5">
                <Users className="w-3.5 h-3.5" /> Create Group
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Link Task Modal */}
      {linkTaskOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start sm:items-center justify-center p-4" onClick={() => setLinkTaskOpen(false)}>
          <div className="w-full max-w-[420px] rounded-xl border border-[#222A35] bg-[#11161D] p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div className="text-[15px] text-white font-display flex items-center gap-2"><Link2 className="w-4 h-4 text-[#3B82F6]" /> Link to Task</div>
              <button onClick={() => setLinkTaskOpen(false)} className="w-7 h-7 rounded-md text-[#8A95A5] hover:text-white hover:bg-[#161C24] flex items-center justify-center"><X className="w-4 h-4" /></button>
            </div>
            <div className="space-y-2 max-h-[300px] overflow-y-auto">
              {[{ id: "t-1", title: "Electrical rough-in — Level 2" }, { id: "t-2", title: "Plumbing pressure test" }, { id: "t-3", title: "Fire alarm conduit inspection" }, { id: "t-4", title: "HVAC ductwork install" }, { id: "t-5", title: "Concrete pour — Level 3 slab" }].map((t) => (
                <button key={t.id} onClick={() => { setLinkedTaskId(t.id); setLinkedTaskTitle(t.title); setLinkTaskOpen(false); toast.success(`Linked to ${t.title}`); }} className={`w-full flex items-center gap-3 p-3 rounded-lg text-left transition ${linkedTaskId === t.id ? "bg-[#3B82F6]/10 border border-[#3B82F6]/30" : "bg-[#0A0E14] border border-[#222A35] hover:bg-[#161C24]"}`}>
                  <ListChecks className="w-4 h-4 text-[#3B82F6]" />
                  <div className="text-[12px] text-white">{t.title}</div>
                  {linkedTaskId === t.id && <Check className="w-4 h-4 text-[#3B82F6] ml-auto" />}
                </button>
              ))}
            </div>
            {linkedTaskId && (
              <button onClick={() => { setLinkedTaskId(null); setLinkedTaskTitle(""); setLinkTaskOpen(false); }} className="w-full mt-3 h-9 rounded-md border border-[#EF4444]/30 text-[#EF4444] text-[12px] flex items-center justify-center gap-1.5 hover:bg-[#EF4444]/10">Remove link</button>
            )}
          </div>
        </div>
      )}

      {/* Push Notification Settings Modal */}
      {showPushSettings && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start sm:items-center justify-center p-4" onClick={() => setShowPushSettings(false)}>
          <div className="w-full max-w-[400px] rounded-xl border border-[#222A35] bg-[#11161D] p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div className="text-[15px] text-white font-display flex items-center gap-2"><Bell className="w-4 h-4 text-[#FF6B1A]" /> Push Notifications</div>
              <button onClick={() => setShowPushSettings(false)} className="w-7 h-7 rounded-md text-[#8A95A5] hover:text-white hover:bg-[#161C24] flex items-center justify-center"><X className="w-4 h-4" /></button>
            </div>
            <div className="space-y-3 text-[12px]">
              <div className="flex items-center justify-between p-3 rounded-lg bg-[#0A0E14] border border-[#222A35]">
                <div>
                  <div className="text-white">Enable push notifications</div>
                  <div className="text-[11px] text-[#8A95A5]">Show toast on new messages</div>
                </div>
                <label className="relative inline-flex cursor-pointer">
                  <input type="checkbox" checked={pushEnabled} onChange={(e) => { setPushEnabled(e.target.checked); try { localStorage.setItem("bf-push-enabled", String(e.target.checked)); } catch {} }} className="sr-only peer" />
                  <div className="w-9 h-5 rounded-full bg-[#222A35] peer-checked:bg-[#FF6B1A] transition-colors relative"><div className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform peer-checked:translate-x-4" /></div>
                </label>
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg bg-[#0A0E14] border border-[#222A35]">
                <div>
                  <div className="text-white">Task-linked messages</div>
                  <div className="text-[11px] text-[#8A95A5]">Notify when messages reference tasks</div>
                </div>
                <label className="relative inline-flex cursor-pointer">
                  <input type="checkbox" defaultChecked className="sr-only peer" />
                  <div className="w-9 h-5 rounded-full bg-[#222A35] peer-checked:bg-[#FF6B1A] transition-colors relative"><div className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform peer-checked:translate-x-4" /></div>
                </label>
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg bg-[#0A0E14] border border-[#222A35]">
                <div>
                  <div className="text-white">Scheduled report alerts</div>
                  <div className="text-[11px] text-[#8A95A5]">Reminders when scheduled reports run</div>
                </div>
                <label className="relative inline-flex cursor-pointer">
                  <input type="checkbox" defaultChecked className="sr-only peer" />
                  <div className="w-9 h-5 rounded-full bg-[#222A35] peer-checked:bg-[#FF6B1A] transition-colors relative"><div className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform peer-checked:translate-x-4" /></div>
                </label>
              </div>
              <button onClick={() => { toast.success("Push notification test", { description: "This is how a push alert will appear." }); }} className="w-full h-9 rounded-md border border-[#222A35] text-[12px] text-[#8A95A5] hover:text-white flex items-center justify-center gap-1.5"><Bell className="w-3.5 h-3.5" /> Send test notification</button>
            </div>
          </div>
        </div>
      )}

      {/* Group Settings Modal */}
      {showGroupSettings && selected && selected.type === "group" && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start sm:items-center justify-center p-4 overflow-y-auto" onClick={() => setShowGroupSettings(false)}>
          <div className="w-full max-w-[520px] rounded-xl border border-[#222A35] bg-[#11161D] p-5 sm:p-6 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <div className="text-[15px] text-white font-display">Group Settings</div>
              <button onClick={() => setShowGroupSettings(false)} className="w-7 h-7 rounded-md text-[#8A95A5] hover:text-white hover:bg-[#161C24] flex items-center justify-center"><X className="w-4 h-4" /></button>
            </div>

            <div className="space-y-5">
              {/* Profile Picture */}
              <div className="flex flex-col items-center">
                <div className="relative">
                  <div className="w-20 h-20 rounded-full bg-gradient-to-br from-[#FF6B1A] to-[#F5A623] flex items-center justify-center text-white text-[20px] overflow-hidden">
                    {groupProfilePic ? <img src={groupProfilePic} alt="" className="w-full h-full object-cover" /> : <Hash className="w-8 h-8" />}
                  </div>
                  <button onClick={() => groupProfilePicInputRef.current?.click()} className="absolute bottom-0 right-0 w-7 h-7 rounded-full bg-[#0A0E14] border border-[#222A35] flex items-center justify-center text-[#8A95A5] hover:text-white">
                    <Camera className="w-3.5 h-3.5" />
                  </button>
                </div>
                <input ref={groupProfilePicInputRef} type="file" accept="image/*" className="hidden" onChange={updateGroupProfilePic} />
                <div className="text-[10px] text-[#5B6675] mt-1">Tap camera to change</div>
              </div>

              {/* Group Name */}
              <div>
                <label className="text-[11px] text-[#8A95A5] block mb-1.5">Group Name</label>
                <div className="flex gap-2">
                  <input
                    value={groupEditName}
                    onChange={(e) => setGroupEditName(e.target.value)}
                    className="flex-1 h-9 px-3 rounded-md bg-[#0A0E14] border border-[#222A35] text-[13px] text-white focus:outline-none focus:border-[#FF6B1A]"
                  />
                  <button onClick={updateGroupName} className="h-9 px-3 rounded-md bg-[#FF6B1A] text-white text-[12px] flex items-center gap-1.5"><Check className="w-3.5 h-3.5" /> Save</button>
                </div>
              </div>

              {/* Members */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-[11px] text-[#8A95A5]">Members ({selected.members.length})</label>
                  <button onClick={() => setShowAddMember((s) => !s)} className="text-[11px] text-[#FF6B1A] hover:underline flex items-center gap-1"><UserPlus className="w-3 h-3" /> {showAddMember ? "Close" : "Add Member"}</button>
                </div>

                {/* Add member list */}
                {showAddMember && (
                  <div className="mb-3 max-h-[200px] overflow-y-auto rounded-lg border border-[#222A35] bg-[#0A0E14] p-2 space-y-1">
                    {TEAM_MEMBERS.filter((m) => !selected.members.includes(m.id)).length === 0 && <div className="text-[11px] text-[#5B6675] p-2 text-center">All team members are already in this group.</div>}
                    {TEAM_MEMBERS.filter((m) => !selected.members.includes(m.id)).map((m) => (
                      <button key={m.id} onClick={() => addMemberToGroup(m.id)} className="w-full flex items-center gap-3 p-2 rounded-md text-left hover:bg-[#161C24] transition">
                        <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-[10px] font-medium" style={{ background: ROLE_COLORS[m.role] }}>{m.initials}</div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[12px] text-white">{m.name}</div>
                          <div className="text-[10px] text-[#8A95A5]">{m.role}</div>
                        </div>
                        <Plus className="w-4 h-4 text-[#22C55E] shrink-0" />
                      </button>
                    ))}
                  </div>
                )}

                {/* Current members */}
                <div className="space-y-1">
                  {selected.members.map((memberId) => {
                    const m = getMember(memberId);
                    if (!m) return null;
                    const isAdmin = selected.admins?.includes(memberId) ?? false;
                    const isMe = memberId === myId;
                    return (
                      <div key={memberId} className="flex items-center gap-3 p-2 rounded-md bg-[#0A0E14] border border-[#222A35]">
                        <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-[10px] font-medium" style={{ background: ROLE_COLORS[m.role] }}>{m.initials}</div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[12px] text-white flex items-center gap-1">
                            {m.name}
                            {isAdmin && <Crown className="w-3 h-3 text-[#F5A623]" />}
                            {isMe && <span className="text-[9px] text-[#5B6675]">(You)</span>}
                          </div>
                          <div className="text-[10px] text-[#8A95A5]">{m.role}</div>
                        </div>
                        <div className="flex items-center gap-1">
                          {!isMe && (
                            <>
                              <button onClick={() => toggleAdmin(memberId)} className={`h-7 px-2 rounded-md text-[10px] flex items-center gap-1 ${isAdmin ? "bg-[#F5A623]/10 text-[#F5A623] border border-[#F5A623]/30" : "bg-[#161C24] text-[#8A95A5] border border-[#222A35] hover:text-white"}`}>
                                <Crown className="w-3 h-3" /> {isAdmin ? "Admin" : "Make Admin"}
                              </button>
                              <button onClick={() => removeMemberFromGroup(memberId)} className="h-7 px-2 rounded-md bg-[#161C24] border border-[#222A35] text-[#8A95A5] hover:text-[#EF4444] hover:border-[#EF4444]/30 flex items-center gap-1">
                                <UserMinus className="w-3 h-3" />
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Delete Group */}
              {selected && canDeleteGroup(selected) && (
                <div className="pt-4 border-t border-[#222A35]">
                  {!confirmDeleteGroup ? (
                    <button onClick={() => setConfirmDeleteGroup(true)} className="w-full h-9 rounded-md border border-[#EF4444]/30 text-[#EF4444] text-[12px] flex items-center justify-center gap-1.5 hover:bg-[#EF4444]/10 transition">
                      <Trash2 className="w-3.5 h-3.5" /> Delete Group
                    </button>
                  ) : (
                    <div className="space-y-2">
                      <div className="text-[11px] text-[#EF4444] text-center">Are you sure? This cannot be undone.</div>
                      <div className="flex gap-2">
                        <button onClick={() => setConfirmDeleteGroup(false)} className="flex-1 h-9 rounded-md bg-[#161C24] border border-[#222A35] text-[#8A95A5] text-[12px] hover:text-white">Cancel</button>
                        <button onClick={deleteGroup} className="flex-1 h-9 rounded-md bg-[#EF4444] text-white text-[12px]">Yes, Delete</button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
