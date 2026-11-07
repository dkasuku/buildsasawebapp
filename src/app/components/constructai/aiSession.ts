// One Buildsasa AI session for the whole app: the conversation the AI page and
// the docked panel share, which category it is in, and its saved history.
// Every AI reply is saved, so a chat started anywhere shows up in History.
import { useCallback, useEffect, useRef, useState } from "react";
import api, { type AiConversationRow } from "../../services/api";
import { AI_GREETING, aiErrorText, inferTradeCategory, looksLikeFormRequest, parseActions, type Msg } from "./AiAssistantPanel";
import { setChatLogo } from "./aiDocs";
import { draftFromAnswer, quoteMarkdown } from "./aiQuote";

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

/** What an attached photo is for. "auto" works it out from the words. */
export type ImageMode = "auto" | "design" | "logo" | "ask";
const DESIGN_WORDS = /\b(redesign|design|renovat\w*|transform|turn (this|it) into|make (it|this) (look|into|modern)|finish(ed|es)?|interior|decor\w*|style|modern|makeover|visuali[sz]e|render|repaint|furnish\w*|remodel\w*|upgrade)\b/i;
const DOC_WORDS = /\b(quot\w*|invoice|estimate|boq|bill of quantities|proposal|letter|report|price|cost|budget|logo|letterhead)\b/i;
export const imageModeFor = (text: string, mode: ImageMode = "auto"): Exclude<ImageMode, "auto"> => {
  if (mode !== "auto") return mode;
  if (/\b(logo|letterhead|brand(ing)?)\b/i.test(text)) return "logo";
  if (!text.trim()) return "design";
  if (DESIGN_WORDS.test(text) && !DOC_WORDS.test(text)) return "design";
  // Anything else (a quote request, a site photo, a drawing, a question): the
  // AI looks at the photo and works out whether it is a logo.
  return "ask";
};

/** Ask the assistant (or build a checklist when that's what was asked) and
 *  return the reply as a chat message. Never throws, except when stopped. */
export async function askAi(text: string, before: Msg[], opts: { signal?: AbortSignal; page?: string; category?: string; images?: string[]; files?: { url: string; name: string }[]; imageMode?: ImageMode } = {}): Promise<Msg> {
  // A quote edited by hand goes back to the AI as it now stands.
  const history = before.filter((m) => !isGreeting(m)).map((m) => ({
    role: m.role === "ai" ? "assistant" : "user",
    content: m.quote ? `${m.text.split("\n")[0]}\n\n[The quote as the user last edited it]\n${quoteMarkdown(m.quote)}` : m.files?.length ? `${m.text}\n(Attached: ${m.files.map((f) => f.name).join(", ")})` : m.text,
  }));
  const prevQuote = [...before].reverse().find((m) => m.quote)?.quote;
  const files = opts.files || [];
  const mode = opts.images?.length ? imageModeFor(text, opts.imageMode) : null;
  try {
    // A photo of a raw space: the Visualizer turns it into the finished
    // interior and prices the materials.
    if (opts.images?.length && mode === "design") {
      const d = await api.generateDesign({ mode: "interior", prompt: text, images: opts.images, aspect: "landscape", estimate: true }, opts.signal);
      const total = d.estimate?.total ? ` Estimated cost: **KES ${Math.round(d.estimate.total).toLocaleString("en-KE")}**.` : "";
      return { role: "ai", text: `Here's the space redesigned from your photo. Drag the slider to compare before and after.${total}`, design: { id: d.id, before: opts.images[0], after: d.imageUrl, prompt: d.prompt, estimate: d.estimate || null } };
    }
    if (!opts.images?.length && !files.length && looksLikeDesignRequest(text, opts.category)) {
      const d = await api.generateDesign({ mode: /\b(fa[cç]ade|exterior|house|villa|bungalow|maisonette|gate|compound)\b/i.test(text) && !/\binterior\b/i.test(text) ? "render3d" : "interior", prompt: text, aspect: "landscape", estimate: true }, opts.signal);
      const total = d.estimate?.total ? ` Estimated cost: **KES ${Math.round(d.estimate.total).toLocaleString("en-KE")}**.` : "";
      return { role: "ai", text: `Here's your design.${total} Tell me what to change (colours, materials, layout, budget) and I'll redo it, or attach a photo of the real space to design from it.`, design: { id: d.id, after: d.imageUrl, prompt: d.prompt, estimate: d.estimate || null } };
    }
    if (!opts.images?.length && !files.length && looksLikeFormRequest(text)) {
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
    const res = await api.aiAssistant(text, history, opts.signal, opts.page, opts.category, { images: opts.images, files, logo: mode === "logo" });
    // [[logo]]: the AI saw that the attached image is a company logo.
    let raw = res.answer || "No answer.";
    const sawLogo = /\[\[logo\]\]/i.test(raw);
    raw = raw.replace(/\[\[logo\]\]/gi, "").trim();
    const logo = opts.images?.length && (mode === "logo" || sawLogo) ? opts.images[0] : undefined;
    if (logo) setChatLogo(logo);
    const { text: answer, actions } = parseActions(raw);
    // A priced table becomes an editable quote; its save card is the quote's own Save.
    const meta = actions.find((a) => a.kind === "save" && a.type === "quote");
    const quote = draftFromAnswer(answer, meta && meta.kind === "save" ? meta.data : {}, prevQuote);
    if (quote && logo) quote.logo = logo;
    return { role: "ai", text: answer || "Done.", actions: quote ? actions.filter((a) => a !== meta) : actions, ...(quote ? { quote } : {}) };
  } catch (err: any) {
    if (err?.name === "AbortError" || opts.signal?.aborted) throw err;
    if (mode === "design" || (!opts.images?.length && looksLikeDesignRequest(text, opts.category))) return { role: "ai", text: `I couldn't generate the design: ${aiErrorText(err)}` };
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

  // Save after each AI reply, and (a moment later) after edits such as a quote
  // changed by hand. The first save creates the chat; saves that land while it
  // is being created wait for it rather than creating a second one.
  const savedSig = useRef("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const last = messages[messages.length - 1];
    const body = messages.filter((m) => !isGreeting(m));
    if (!last || last.role !== "ai" || isGreeting(last) || !body.some((m) => m.role === "user")) return;
    const sig = JSON.stringify(body);
    if (sig === savedSig.current) return;
    const isNewReply = messages.length !== savedLen.current;
    savedLen.current = messages.length;
    const title = body.find((m) => m.role === "user")!.text.replace(/\s+/g, " ").slice(0, 80);
    const run = async () => {
      savedSig.current = sig;
      try {
        let id = idRef.current || (creating.current ? await creating.current : null);
        if (!id) {
          creating.current = api.createAiConversation({ title, category: catRef.current, messages: body }).then((c) => c.id).catch(() => null);
          id = await creating.current;
          creating.current = null;
          if (id) { idRef.current = id; setConvId(id); }
        } else await api.saveAiConversation(id, { messages: body });
        if (isNewReply) refresh();
      } catch { /* history is a convenience; the chat itself still works */ }
    };
    if (timer.current) clearTimeout(timer.current);
    if (isNewReply) run(); else timer.current = setTimeout(run, 1200);
  }, [messages, refresh]);

  const reset = useCallback((cat = "general") => {
    idRef.current = null; creating.current = null; savedLen.current = 1; savedSig.current = "";
    setChatLogo(null);
    setConvId(null); setCategory(cat); setMessages([AI_GREETING]);
  }, []);
  const open = useCallback(async (id: string) => {
    const c = await api.aiConversation(id);
    const msgs: Msg[] = c.messages?.length ? c.messages : [AI_GREETING];
    idRef.current = id; savedLen.current = msgs.length; savedSig.current = JSON.stringify(msgs.filter((m) => !isGreeting(m)));
    // Documents from this chat keep the logo that was attached in it.
    const lastLogo = [...msgs].reverse().find((m) => m.quote?.logo || m.logo);
    setChatLogo(lastLogo?.quote?.logo || lastLogo?.logo || null);
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
