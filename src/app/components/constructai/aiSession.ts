// One Buildsasa AI session for the whole app: the conversation the AI page and
// the docked panel share, which category it is in, and its saved history.
// Every AI reply is saved, so a chat started anywhere shows up in History.
import { useCallback, useEffect, useRef, useState } from "react";
import api, { type AiConversationRow } from "../../services/api";
import { AI_GREETING, aiErrorText, inferTradeCategory, looksLikeFormRequest, parseActions, type Msg } from "./AiAssistantPanel";

const isGreeting = (m: Msg) => m.role === "ai" && m.text === AI_GREETING.text;

// "Design a modern kitchen…", "show me a living room with…", "render a
// 3-bedroom bungalow facade": make the picture here in the chat, with a costed
// materials list, instead of sending people to the Design studio. Questions
// ("what colours suit…", "suggest finishes…") stay as written answers.
const SPACE = /\b(room|kitchen|bed ?rooms?|master|living|lounge|sitting|bath ?rooms?|toilet|washroom|office|reception|dining|interior|fa[cç]ade|exterior|house|home|villa|bungalow|maisonette|apartment|flat|shop|salon|restaurant|cafe|hotel|lobby|space|ceiling|wardrobe|staircase|garden|compound|gate|balcony|terrace)\b/i;
export const looksLikeDesignRequest = (t: string, category?: string) => {
  const s = t.trim();
  if (/^\s*(how|what|why|when|where|which|who|explain|tell me|is |are |should |can i|do i|suggest|recommend|list|compare|estimate|price|quote|cost)/i.test(s)) return false;
  if (/\b(quote|boq|bill of quantities|estimate|price|cost|checklist|schedule|programme|log)\b/i.test(s) && !/\b(render|visuali[sz]e|image|picture|photo|3d)\b/i.test(s)) return false;
  const verb = /\b(design|redesign|render|visuali[sz]e|show me|draw|generate|create|imagine|mock ?up|picture|image of|make (me )?a)\b/i.test(s);
  return verb && (SPACE.test(s) || (category === "design" && s.length > 12));
};

/** Ask the assistant (or build a checklist when that's what was asked) and
 *  return the reply as a chat message. Never throws, except when stopped. */
export async function askAi(text: string, before: Msg[], opts: { signal?: AbortSignal; page?: string; category?: string; images?: string[] } = {}): Promise<Msg> {
  const history = before.filter((m) => !isGreeting(m)).map((m) => ({ role: m.role === "ai" ? "assistant" : "user", content: m.text }));
  try {
    // A photo attached: the Visualizer turns the raw space into the finished
    // interior and prices the materials.
    if (opts.images?.length) {
      const d = await api.generateDesign({ mode: "interior", prompt: text, images: opts.images, aspect: "landscape", estimate: true }, opts.signal);
      const total = d.estimate?.total ? ` Estimated cost: **KES ${Math.round(d.estimate.total).toLocaleString("en-KE")}**.` : "";
      return { role: "ai", text: `Here's the space redesigned from your photo. Drag the slider to compare before and after.${total}`, design: { id: d.id, before: opts.images[0], after: d.imageUrl, prompt: d.prompt, estimate: d.estimate || null } };
    }
    if (looksLikeDesignRequest(text, opts.category)) {
      const d = await api.generateDesign({ mode: /\b(fa[cç]ade|exterior|house|villa|bungalow|maisonette|gate|compound)\b/i.test(text) && !/\binterior\b/i.test(text) ? "render3d" : "interior", prompt: text, aspect: "landscape", estimate: true }, opts.signal);
      const total = d.estimate?.total ? ` Estimated cost: **KES ${Math.round(d.estimate.total).toLocaleString("en-KE")}**.` : "";
      return { role: "ai", text: `Here's your design.${total} Tell me what to change (colours, materials, layout, budget) and I'll redo it, or attach a photo of the real space to design from it.`, design: { id: d.id, after: d.imageUrl, prompt: d.prompt, estimate: d.estimate || null } };
    }
    if (looksLikeFormRequest(text)) {
      const res = await api.buildChecklistAI({ prompt: text }, opts.signal);
      const items = Array.isArray(res.items) ? res.items : [];
      const guess = inferTradeCategory(text);
      const trade = res.trade || guess.trade;
      const category = res.category || guess.category;
      const reply = (res.reply || "").trim() || (items.length
        ? `I drafted "${res.title || "a checklist"}" (${trade} · ${category}) with ${items.length} item${items.length > 1 ? "s" : ""}. Preview it, then open it in the Form Builder to edit and save.`
        : "I couldn't turn that into checklist items. Try naming the trade and what to inspect.");
      return items.length ? { role: "ai", text: reply, form: { title: res.title || "Untitled checklist", trade, category, items } } : { role: "ai", text: reply };
    }
    const res = await api.aiAssistant(text, history, opts.signal, opts.page, opts.category);
    const { text: answer, actions } = parseActions(res.answer || "No answer.");
    return { role: "ai", text: answer || "Done.", actions };
  } catch (err: any) {
    if (err?.name === "AbortError" || opts.signal?.aborted) throw err;
    if (opts.images?.length || looksLikeDesignRequest(text, opts.category)) return { role: "ai", text: `I couldn't generate the design: ${aiErrorText(err)}` };
    return { role: "ai", text: `I couldn't reach the AI: ${aiErrorText(err)}. Check your connection and try again. If it keeps failing, the AI key on the server may need topping up.` };
  }
}

export function useAiSession() {
  const [messages, setMessages] = useState<Msg[]>([AI_GREETING]);
  const [convId, setConvId] = useState<string | null>(null);
  const [category, setCategory] = useState("general");
  const [history, setHistory] = useState<AiConversationRow[] | null>(null);
  const idRef = useRef<string | null>(null);
  const creating = useRef<Promise<string | null> | null>(null);
  const savedLen = useRef(1);
  const catRef = useRef(category);
  catRef.current = category;

  const refresh = useCallback(() => { api.aiConversations().then(setHistory).catch(() => setHistory((h) => h || [])); }, []);
  useEffect(() => { refresh(); }, [refresh]);

  // Save after each AI reply. The first save creates the chat; replies that land
  // while it is being created wait for it rather than creating a second one.
  useEffect(() => {
    const last = messages[messages.length - 1];
    const body = messages.filter((m) => !isGreeting(m));
    if (!last || last.role !== "ai" || isGreeting(last) || !body.some((m) => m.role === "user") || messages.length === savedLen.current) return;
    savedLen.current = messages.length;
    const title = body.find((m) => m.role === "user")!.text.replace(/\s+/g, " ").slice(0, 80);
    (async () => {
      try {
        let id = idRef.current || (creating.current ? await creating.current : null);
        if (!id) {
          creating.current = api.createAiConversation({ title, category: catRef.current, messages: body }).then((c) => c.id).catch(() => null);
          id = await creating.current;
          creating.current = null;
          if (id) { idRef.current = id; setConvId(id); }
        } else await api.saveAiConversation(id, { messages: body });
        refresh();
      } catch { /* history is a convenience; the chat itself still works */ }
    })();
  }, [messages, refresh]);

  const reset = useCallback((cat = "general") => {
    idRef.current = null; creating.current = null; savedLen.current = 1;
    setConvId(null); setCategory(cat); setMessages([AI_GREETING]);
  }, []);
  const open = useCallback(async (id: string) => {
    const c = await api.aiConversation(id);
    const msgs: Msg[] = c.messages?.length ? c.messages : [AI_GREETING];
    idRef.current = id; savedLen.current = msgs.length;
    setConvId(id); setCategory(c.category || "general"); setMessages(msgs);
  }, []);
  const remove = useCallback(async (id: string) => {
    await api.deleteAiConversation(id);
    if (id === idRef.current) reset();
    setHistory((h) => (h || []).filter((x) => x.id !== id));
  }, [reset]);

  return { messages, setMessages, convId, category, setCategory, history, refresh, reset, open, remove };
}
export type AiSession = ReturnType<typeof useAiSession>;
