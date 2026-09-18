import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { toast } from "sonner";
import {
  Code2,
  Compass,
  Lightbulb,
  PenLine,
  Paperclip,
  Mic,
  MicOff,
  FileText,
  X,
  Send,
  Square,
  Sparkles,
  ImageOff,
  FileDown,
  Presentation,
  Clapperboard,
  Image as ImageIcon,
  MessageCircle,
  Download,
  Film,
  Play,
  Pause,
  Calculator as CalculatorIcon,
  CloudSun,
  Terminal,
} from "lucide-react";
import { Message, MessageContent } from "@/components/ai-elements/message";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { getThread, upsertThread, deriveTitle } from "@/lib/threads";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/lumen/theme-toggle";
import { Calculator } from "@/components/lumen/calculator";
import { WeatherPanel } from "@/components/lumen/weather-panel";
import { useAuth } from "@/hooks/use-auth";
import { useLanguage } from "@/hooks/use-language";
import { languageLabel } from "@/lib/languages";
import { useRank } from "@/hooks/use-rank";
import { awardPoints } from "@/lib/ranks.functions";
import { RANK_DETAILS } from "@/lib/ranks";

async function downloadImage(url: string, prompt?: string) {
  try {
    const res = await fetch(url, { mode: "cors" });
    const blob = await res.blob();
    const obj = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = obj;
    a.download = `${(prompt || "lumen-image").replace(/[^a-z0-9-_]+/gi, "_").slice(0, 60)}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(obj), 1000);
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}
import {
  buildAndDownloadPdf,
  buildAndDownloadPptx,
  type PdfPayload,
  type PptxPayload,
  type StoryboardPayload,
} from "@/lib/generators";

function renderText(message: UIMessage): string {
  return message.parts
    .map((p) => (p.type === "text" ? p.text : ""))
    .join("");
}

function pdfSubtitle(p: PdfPayload): string {
  if (p.blocks && p.blocks.length) {
    const qs = p.blocks.filter((b) => b.type === "questions").reduce(
      (n, b) => n + (b as { items: string[] }).items.length,
      0,
    );
    if (qs > 0) return `${qs} question${qs === 1 ? "" : "s"}`;
    return `${p.blocks.length} block${p.blocks.length === 1 ? "" : "s"}`;
  }
  const n = p.sections?.length ?? 0;
  return `${n} section${n === 1 ? "" : "s"}`;
}

// Normalize various LaTeX delimiter styles so remark-math (which only knows $/$$)
// can render them. Models often emit \( … \), \[ … \], or bare [ … ] blocks.
function normalizeMath(input: string): string {
  if (!input) return input;
  let out = input;
  // Protect fenced code & inline code from substitution.
  const stash: string[] = [];
  out = out.replace(/```[\s\S]*?```|`[^`\n]*`/g, (m) => {
    stash.push(m);
    return `\u0000${stash.length - 1}\u0000`;
  });
  // \[ ... \]  ->  $$ ... $$
  out = out.replace(/\\\[([\s\S]+?)\\\]/g, (_m, body) => `$$${body}$$`);
  // \( ... \)  ->  $ ... $
  out = out.replace(/\\\(([\s\S]+?)\\\)/g, (_m, body) => `$${body}$`);
  // Restore protected segments.
  out = out.replace(/\u0000(\d+)\u0000/g, (_m, i) => stash[Number(i)] ?? "");
  return out;
}

type Attachment = {
  id: string;
  file: File;
  url: string; // data URL
  isImage: boolean;
};

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

const SUGGESTIONS = [
  {
    icon: Lightbulb,
    title: "Explain anything",
    prompt: "Explain quantum entanglement like I'm 12, then like I'm a physics PhD.",
  },
  {
    icon: Code2,
    title: "Write code",
    prompt:
      "Write a React hook called useDebouncedValue with TypeScript and explain how it works.",
  },
  {
    icon: PenLine,
    title: "Help me write",
    prompt: "Draft a concise, friendly cold email pitching a design service to a startup founder.",
  },
  {
    icon: Compass,
    title: "Plan something",
    prompt: "Plan a 5-day solo trip to Tokyo for a first-time visitor on a mid-range budget.",
  },
];

type Mode = { id: string; label: string; icon: typeof MessageCircle; hint: string };

const MODES: Mode[] = [
  { id: "chat", label: "Chat", icon: MessageCircle, hint: "" },
  { id: "image", label: "Image", icon: ImageIcon, hint: "Generate an image of " },
  { id: "pdf", label: "PDF", icon: FileDown, hint: "Create a PDF document about " },
  { id: "slides", label: "Slides", icon: Presentation, hint: "Create a slide deck about " },
  { id: "video", label: "Video", icon: Clapperboard, hint: "Make a video storyboard for " },
];

export function ChatWindow({ threadId }: { threadId: string }) {
  const navigate = useNavigate();
  const initial = useMemo(() => getThread(threadId), [threadId]);
  const { user } = useAuth();
  const rank = useRank();
  const maxFileBytes = RANK_DETAILS[rank].uploadMb * 1024 * 1024;
  const { language } = useLanguage();

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        body: { language, languageLabel: languageLabel(language) },
      }),
    [language],
  );

  const { messages, sendMessage, status, stop, error } = useChat({
    id: threadId,
    messages: initial?.messages ?? [],
    transport,
    onError: (e) => {
      toast.error(e?.message || "Something went wrong. Please try again.");
    },
  });

  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [mode, setMode] = useState<string>("chat");
  const [autoTitle, setAutoTitle] = useState<string | null>(
    initial && initial.title && initial.title !== "New chat" ? initial.title : null,
  );
  const titledRef = useRef(!!autoTitle);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<any>(null);
  const baseTranscriptRef = useRef<string>("");
  const [isRecording, setIsRecording] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(true);
  const [showCalc, setShowCalc] = useState(false);
  const [showWeather, setShowWeather] = useState(false);
  const [codeMode, setCodeMode] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { setVoiceSupported(false); return; }
  }, []);

  const toggleVoice = () => {
    if (typeof window === "undefined") return;
    const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      toast.error("Voice input isn't supported in this browser. Try Chrome or Edge.");
      return;
    }
    if (isRecording) {
      try { recognitionRef.current?.stop(); } catch { /* ignore */ }
      return;
    }
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = navigator.language || "en-US";
    baseTranscriptRef.current = input ? input.replace(/\s*$/, "") + " " : "";
    rec.onresult = (e: any) => {
      let interim = "";
      let finalText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      if (finalText) {
        baseTranscriptRef.current = (baseTranscriptRef.current + finalText).replace(/\s+/g, " ");
        if (!baseTranscriptRef.current.endsWith(" ")) baseTranscriptRef.current += " ";
      }
      setInput((baseTranscriptRef.current + interim).trimStart());
    };
    rec.onerror = (e: any) => {
      if (e?.error && e.error !== "aborted" && e.error !== "no-speech") {
        toast.error(`Mic error: ${e.error}`);
      }
    };
    rec.onend = () => { setIsRecording(false); recognitionRef.current = null; };
    try {
      rec.start();
      recognitionRef.current = rec;
      setIsRecording(true);
    } catch (err) {
      toast.error("Could not start microphone. Check permissions.");
    }
  };

  useEffect(() => () => { try { recognitionRef.current?.stop(); } catch { /* */ } }, []);

  const isBusy = status === "submitted" || status === "streaming";

  // Persist on every update
  useEffect(() => {
    if (messages.length === 0) return;
    // Guests get an ephemeral session — history saves only for signed-in users.
    if (!user) return;
    upsertThread({
      id: threadId,
      title: autoTitle || deriveTitle(messages),
      createdAt: initial?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
      messages,
    });
    window.dispatchEvent(new CustomEvent("lumen:threads-changed"));
  }, [messages, threadId, initial?.createdAt, autoTitle, user]);

  // Auto-generate a catchy title once the first assistant reply lands.
  useEffect(() => {
    if (titledRef.current) return;
    if (status === "streaming" || status === "submitted") return;
    const firstUser = messages.find((m) => m.role === "user");
    const firstAssistant = messages.find((m) => m.role === "assistant");
    if (!firstUser || !firstAssistant) return;
    titledRef.current = true;
    const userText = firstUser.parts.map((p) => (p.type === "text" ? p.text : "")).join(" ").trim();
    const assistantText = firstAssistant.parts.map((p) => (p.type === "text" ? p.text : "")).join(" ").trim();
    if (!userText) return;
    fetch("/api/title", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userText, assistantText }),
    })
      .then((r) => r.json())
      .then((d: { title?: string }) => {
        if (d.title) setAutoTitle(d.title);
      })
      .catch(() => { /* keep fallback */ });
  }, [messages, status]);

  // Keep textarea focused
  useEffect(() => {
    textareaRef.current?.focus();
  }, [threadId, status]);

  // Auto-grow textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 220) + "px";
  }, [input]);

  const submit = (text: string) => {
    const raw = text.trim();
    const m = MODES.find((x) => x.id === mode);
    const trimmed =
      m && m.hint && raw && !raw.toLowerCase().startsWith(m.hint.trim().toLowerCase().slice(0, 6))
        ? (m.hint + raw).trim()
        : raw;
    if ((!trimmed && attachments.length === 0) || isBusy) return;
    const files = attachments.map((a) => ({
      type: "file" as const,
      mediaType: a.file.type || "application/octet-stream",
      url: a.url,
      filename: a.file.name,
    }));
    const finalText = codeMode
      ? `[[CODE_ONLY]] ${trimmed || "(see attached)"}`
      : trimmed || "(see attached)";
    sendMessage({ text: finalText, files });
    if (user) {
      void awardPoints()
        .then(() => window.dispatchEvent(new CustomEvent("lumen:points-changed")))
        .catch(() => {});
    }
    setInput("");
    setAttachments([]);
    setMode("chat");
    // Update URL if we're not already there (defensive)
    navigate({ to: "/c/$threadId", params: { threadId } });
  };

  const addFiles = async (list: FileList | File[]) => {
    const incoming = Array.from(list);
    const next: Attachment[] = [];
    for (const file of incoming) {
      if (file.size > maxFileBytes) {
        toast.error(`${file.name} is too large (your ${RANK_DETAILS[rank].label} limit is ${RANK_DETAILS[rank].uploadMb} MB).`);
        continue;
      }
      try {
        const url = await fileToDataUrl(file);
        next.push({
          id: Math.random().toString(36).slice(2),
          file,
          url,
          isImage: file.type.startsWith("image/"),
        });
      } catch {
        toast.error(`Could not read ${file.name}`);
      }
    }
    if (next.length) setAttachments((prev) => [...prev, ...next]);
  };

  const isEmpty = messages.length === 0;

  return (
    <div
      className={cn(
        "aster-sky relative flex h-full flex-1 flex-col overflow-hidden bg-background",
        codeMode && "code-terminal",
      )}
    >
      <NightSky />
      {showCalc && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 top-14 z-30 flex items-end justify-end p-3 md:p-5">
          <div className="pointer-events-auto animate-msg-in-right">
            <Calculator onClose={() => setShowCalc(false)} />
          </div>
        </div>
      )}
      {showWeather && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 top-14 z-30 flex items-end justify-end p-3 md:p-5">
          <div className="pointer-events-auto animate-msg-in-right">
            <WeatherPanel onClose={() => setShowWeather(false)} />
          </div>
        </div>
      )}
      <header className="relative z-10 flex min-h-[65px] items-center justify-between gap-2 border-b border-border/60 bg-background/70 px-4 pl-14 backdrop-blur-sm md:px-8 md:pl-8">
        {/* calc-anchor */}
        <div className="flex min-w-0 items-center gap-2">
          <span className="inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
          <span className="truncate text-[13px] font-normal text-muted-foreground">Lumen</span>
          {codeMode && (
            <span className="ml-2 inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
              <Terminal className="h-3 w-3" /> Code Mode
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {isBusy && (
            <button
              onClick={() => stop()}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground transition hover:text-foreground"
            >
              <Square className="h-3 w-3" /> Stop
            </button>
          )}
          <button
            onClick={() => {
              if (!user) {
                toast.error("Sign in to use Code Mode.");
                return;
              }
              setCodeMode((v) => !v);
              setShowCalc(false);
              setShowWeather(false);
            }}
            aria-label={codeMode ? "Exit code mode" : "Enter code mode"}
            title="Coding-only tab"
            className={cn(
               "inline-flex h-8 w-8 items-center justify-center rounded-md border border-transparent bg-transparent transition hover:border-border hover:bg-foreground/[0.02] hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              codeMode
                ? "border-primary/50 text-primary"
                 : "text-muted-foreground",
              !user && "opacity-60",
            )}
          >
            <Terminal className="h-4 w-4" />
          </button>
          <button
            onClick={() => {
              if (!user) {
                toast.error("Sign in to use Weather & Location.");
                return;
              }
              setShowWeather((v) => !v);
              setShowCalc(false);
            }}
            aria-label={showWeather ? "Close weather" : "Open weather & location"}
            title="Weather & location"
            className={cn(
               "inline-flex h-8 w-8 items-center justify-center rounded-md border border-transparent bg-transparent transition hover:border-border hover:bg-foreground/[0.02] hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              showWeather
                ? "border-primary/60 text-primary"
                 : "text-muted-foreground",
              !user && "opacity-60",
            )}
          >
            <CloudSun className="h-4 w-4" />
          </button>
          <button
            onClick={() => { setShowCalc((v) => !v); setShowWeather(false); }}
            aria-label={showCalc ? "Close calculator" : "Open calculator"}
            title="Calculator"
            className={cn(
               "inline-flex h-8 w-8 items-center justify-center rounded-md border border-transparent bg-transparent transition hover:border-border hover:bg-foreground/[0.02] hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              showCalc
                ? "border-primary/60 text-primary"
                 : "text-muted-foreground",
            )}
          >
            <CalculatorIcon className="h-4 w-4" />
          </button>
          <ThemeToggle />
        </div>
      </header>

      <div className="relative z-[1] flex-1 overflow-hidden">
        {isEmpty ? (
          <EmptyState onPick={submit} />
        ) : (
          <Conversation className="h-full">
            <ConversationContent className="mx-auto w-full max-w-3xl px-4 py-6">
              {messages.map((m) => (
                <Message
                  from={m.role}
                  key={m.id}
                  className={cn(
                    "mb-5",
                  )}
                >
                  <MessageContent>
                    <MessageBody message={m} />
                  </MessageContent>
                </Message>
              ))}
              {status === "submitted" && (
                <Message from="assistant" className="mb-5">
                  <MessageContent>
                    <ThinkingIndicator />
                  </MessageContent>
                </Message>
              )}
              {error && (
                <div className="mx-auto mt-2 max-w-prose rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive-foreground">
                  {error.message}
                </div>
              )}
            </ConversationContent>
            <ConversationScrollButton />
          </Conversation>
        )}
      </div>

      <div className="relative z-10 bg-background/80 px-3 pb-5 pt-2 backdrop-blur-sm md:px-8 md:pb-6">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(input);
          }}
           className="mx-auto w-full max-w-[680px]"
        >
          {attachments.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {attachments.map((a) => (
                <div
                  key={a.id}
                  className="group relative flex items-center gap-2 rounded-lg border border-border bg-card/80 p-1.5 pr-2 text-xs"
                >
                  {a.isImage ? (
                    <img
                      src={a.url}
                      alt={a.file.name}
                      className="h-10 w-10 rounded object-cover"
                    />
                  ) : (
                    <div className="flex h-10 w-10 items-center justify-center rounded bg-primary/15 text-primary">
                      <FileText className="h-4 w-4" />
                    </div>
                  )}
                  <span className="max-w-[140px] truncate text-foreground/80">
                    {a.file.name}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setAttachments((p) => p.filter((x) => x.id !== a.id))
                    }
                    className="ml-1 flex h-5 w-5 items-center justify-center rounded-full bg-muted text-muted-foreground hover:bg-destructive hover:text-destructive-foreground"
                    aria-label="Remove"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="mb-3 flex flex-wrap items-center justify-center gap-1.5">
            {MODES.map((m) => {
              const Icon = m.icon;
              const active = mode === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMode(m.id)}
                  className={cn(
                     "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-medium transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                    active
                       ? "border-primary/40 bg-primary/[0.06] text-foreground"
                       : "border-border/60 bg-transparent text-muted-foreground hover:border-border hover:text-foreground",
                  )}
                >
                  <Icon className="h-3 w-3" />
                  {m.label}
                </button>
              );
            })}
          </div>
          <div
            className={cn(
               "group relative flex items-end gap-2 rounded-[14px] border border-border bg-card p-1.5 pl-2 transition-colors",
               "focus-within:border-primary/45 focus-within:ring-1 focus-within:ring-primary/10",
              input.length > 0 && !isBusy && "border-primary/30",
            )}
            onDragOver={(e) => {
              e.preventDefault();
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (e.dataTransfer.files.length) void addFiles(e.dataTransfer.files);
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,application/pdf,text/*,.md,.json,.csv"
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) void addFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              aria-label="Attach files"
               className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <Paperclip className="h-4 w-4" />
            </button>
            {voiceSupported && (
              <button
                type="button"
                onClick={toggleVoice}
                aria-label={isRecording ? "Stop recording" : "Start voice input"}
                title={isRecording ? "Stop recording" : "Speak your message"}
                className={cn(
                   "relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                  isRecording
                    ? "bg-destructive/15 text-destructive"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {isRecording ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                {isRecording && (
                  <span className="pointer-events-none absolute inset-0 rounded-xl ring-2 ring-destructive/60 animate-ping" />
                )}
              </button>
            )}
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit(input);
                }
              }}
              onPaste={(e) => {
                const files = Array.from(e.clipboardData.files);
                if (files.length) {
                  e.preventDefault();
                  void addFiles(files);
                }
              }}
              rows={1}
              placeholder={
                codeMode
                  ? "Ask a coding question — snippets, debugging, algorithms…"
                  : "Ask Lumen anything, attach an image, or say ‘draw…’"
              }
               className="order-first flex-1 resize-none bg-transparent px-2 py-2.5 text-[13.5px] text-foreground placeholder:text-foreground/30 focus:outline-none sm:order-none"
              disabled={isBusy && status !== "streaming"}
            />
            <button
              type="submit"
              disabled={(!input.trim() && attachments.length === 0) || isBusy}
              aria-label="Send"
              className={cn(
                 "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                (input.trim() || attachments.length) && !isBusy
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : "bg-muted text-muted-foreground",
              )}
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
           <div className="mt-2.5 text-center text-[10.5px] text-foreground/30">
            Lumen can be wrong. Verify important info. Press <kbd className="rounded bg-muted px-1 py-0.5 text-[10px]">Shift</kbd>+<kbd className="rounded bg-muted px-1 py-0.5 text-[10px]">Enter</kbd> for a new line.
          </div>
        </form>
      </div>
    </div>
  );
}

function EmptyState({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-5 pb-2 pt-8">
      <div className="mb-6 flex flex-col items-center text-center">
        <RocketMark />
        <h1
          className="aster-fade-in mt-5 font-serif text-3xl font-normal italic sm:text-4xl"
          style={{ animationDelay: "0.55s" }}
        >
          How can I help you tonight?
        </h1>
        <p
          className="aster-fade-in mt-2 max-w-md text-sm text-muted-foreground"
          style={{ animationDelay: "0.68s" }}
        >
          Ask Lumen anything — code, ideas, plans, explanations, writing, math.
          I'll do my best.
        </p>
      </div>
      <div
        className="aster-fade-in grid w-full max-w-[600px] grid-cols-1 gap-3 sm:grid-cols-2"
        style={{ animationDelay: "0.8s" }}
      >
        {SUGGESTIONS.map((s) => {
          const Icon = s.icon;
          return (
            <button
              key={s.title}
              onClick={() => onPick(s.prompt)}
               className="group rounded-xl border border-border bg-foreground/[0.008] p-4 text-left transition-[border-color,transform,background-color] duration-200 hover:-translate-y-px hover:border-primary/25 hover:bg-foreground/[0.02] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
            >
              <div className="mb-2 flex items-center gap-2">
                 <Icon className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">{s.title}</span>
              </div>
              <p className="line-clamp-2 text-xs text-muted-foreground">
                {s.prompt}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Hero mark for the empty chat state: the Lumen mark climbing through the night sky. */
function RocketMark() {
  return (
    <div className="rocket-mark" aria-label="Lumen" role="img">
      <span className="rocket-ring" aria-hidden="true" />
      <span className="rocket-ring rocket-ring-2" aria-hidden="true" />
      <div className="rocket-glow" aria-hidden="true" />
      <div className="rocket-plate" aria-hidden="true" />
      <LumenGlyph className="rocket-icon" />
      <span className="rocket-trail" aria-hidden="true">
        <i /><i /><i />
      </span>
    </div>
  );
}

/** The Lumen brand mark (same glyph as the sidebar's AsterMark) — an ascending trajectory. */
function LumenGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 30 30" fill="none" aria-hidden="true">
      <path
        d="M15 22V6M15 6l-3 4.5M15 6l3 4.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M4 24s4-3.5 11-3.5S26 24 26 24"
        stroke="currentColor"
        strokeOpacity=".5"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
    </svg>
  );
}

const STAR_POINTS = [
  [4, 13, 1], [9, 72, 1], [15, 31, 1.5], [21, 89, 1], [27, 8, 1],
  [32, 62, 1], [38, 21, 1], [44, 82, 1.5], [51, 11, 1], [57, 46, 1],
  [63, 93, 1], [69, 25, 1.5], [75, 67, 1], [82, 15, 1], [88, 79, 1.5],
  [94, 36, 1], [12, 53, 1], [35, 95, 1], [73, 4, 1], [97, 71, 1],
] as const;

/** Persistent night-sky backdrop for the whole chat surface: nebula glow, stars, a moon, a distant ringed planet, and the odd shooting star. */
function NightSky() {
  return (
    <div className="aster-sky-layer" aria-hidden="true">
      <div className="aster-nebula" />
      <div className="aster-moon" />
      <div className="aster-planet" />
      <div className="aster-stars">
        {STAR_POINTS.map(([left, top, size], index) => (
          <i
            key={`${left}-${top}`}
            className={index % 6 === 0 ? "twinkle" : undefined}
            style={{ left: `${left}%`, top: `${top}%`, width: size, height: size, animationDelay: `${index * 0.41}s` }}
          />
        ))}
      </div>
      <span className="aster-shooting-star aster-shooting-star-1" />
      <span className="aster-shooting-star aster-shooting-star-2" />
    </div>
  );
}

type AnyPart = UIMessage["parts"][number] & Record<string, unknown>;

function MessageBody({ message }: { message: UIMessage }) {
  const text = renderText(message);
  const parts = message.parts as AnyPart[];

  const files = parts.filter((p) => p.type === "file") as Array<
    AnyPart & { mediaType?: string; url?: string; filename?: string }
  >;

  const generatedImages: Array<{ url: string; prompt?: string }> = [];
  let pendingImagePrompt: string | null = null;
  let imageError: string | null = null;
  const pdfPayloads: PdfPayload[] = [];
  const pptxPayloads: PptxPayload[] = [];
  const storyboards: StoryboardPayload[] = [];
  let pendingDoc: { kind: "pdf" | "pptx" | "storyboard"; title?: string } | null = null;
  for (const p of parts) {
    const t = p.type as string;
    if (t === "tool-generate_image") {
      const state = (p as { state?: string }).state;
      const input = (p as { input?: { prompt?: string } }).input;
      const output =
        (p as { output?: unknown }).output ??
        (p as { result?: unknown }).result;
      if (output && typeof output === "object") {
        const o = output as { imageUrl?: string; prompt?: string; error?: string };
        if (o.imageUrl) generatedImages.push({ url: o.imageUrl, prompt: o.prompt });
        else if (o.error) imageError = o.error;
      }
      if (
        !output &&
        state &&
        state !== "output-available" &&
        state !== "output-error"
      ) {
        pendingImagePrompt = input?.prompt ?? "";
      }
    }
    if (
      t === "tool-generate_pdf" ||
      t === "tool-generate_pptx" ||
      t === "tool-generate_video_storyboard"
    ) {
      const state = (p as { state?: string }).state;
      const output =
        (p as { output?: unknown }).output ??
        (p as { result?: unknown }).result;
      if (output && typeof output === "object") {
        const o = output as { kind?: string };
        if (o.kind === "pdf") pdfPayloads.push(output as PdfPayload);
        else if (o.kind === "pptx") pptxPayloads.push(output as PptxPayload);
        else if (o.kind === "storyboard")
          storyboards.push(output as StoryboardPayload);
      } else if (state && state !== "output-available" && state !== "output-error") {
        const kind: "pdf" | "pptx" | "storyboard" =
          t === "tool-generate_pdf"
            ? "pdf"
            : t === "tool-generate_pptx"
              ? "pptx"
              : "storyboard";
        pendingDoc = { kind };
      }
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {files.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {files.map((f, i) => {
            const isImg = f.mediaType?.startsWith("image/");
            if (isImg && f.url) {
              return (
                <img
                  key={i}
                  src={f.url}
                  alt={f.filename ?? "attachment"}
                  className="max-h-64 max-w-xs rounded-lg border border-border object-cover"
                />
              );
            }
            return (
              <a
                key={i}
                href={f.url}
                download={f.filename}
                className="inline-flex items-center gap-2 rounded-lg border border-border bg-card/60 px-3 py-2 text-xs hover:bg-card"
              >
                <FileText className="h-4 w-4 text-primary" />
                <span className="max-w-[180px] truncate">{f.filename ?? "file"}</span>
              </a>
            );
          })}
        </div>
      )}

      {text &&
        (message.role === "assistant" ? (
          <div className="prose-content">
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkMath]}
              rehypePlugins={[rehypeKatex]}
            >
              {normalizeMath(text)}
            </ReactMarkdown>
          </div>
        ) : (
          <div className="whitespace-pre-wrap">{text}</div>
        ))}

      {generatedImages.length > 0 && (
        <div className="flex flex-col gap-2">
          {generatedImages.map((img, i) => (
            <figure
              key={i}
              className="overflow-hidden rounded-lg border border-border bg-card/40 animate-image-reveal"
            >
              <img
                src={img.url}
                alt={img.prompt ?? "Generated image"}
                className="block h-auto w-full"
                loading="lazy"
                onError={(e) => {
                  const el = e.currentTarget;
                  if (el.dataset.fallback === "1") return;
                  el.dataset.fallback = "1";
                  el.src = `https://image.pollinations.ai/prompt/${encodeURIComponent(
                    img.prompt ?? "abstract neon mint dreamscape",
                  )}?width=1024&height=1024&nologo=true`;
                }}
              />
              {img.prompt && (
                <figcaption className="px-3 py-2 text-[11px] text-muted-foreground">
                  {img.prompt}
                </figcaption>
              )}
              <div className="flex items-center justify-end gap-2 border-t border-border/60 px-3 py-2">
                <button
                  type="button"
                  onClick={() => downloadImage(img.url, img.prompt)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card/70 px-2.5 py-1.5 text-[11px] text-foreground transition hover:bg-card"
                >
                  <Download className="h-3.5 w-3.5" />
                  Download
                </button>
              </div>
            </figure>
          ))}
        </div>
      )}

      {pendingImagePrompt !== null && (
        <ImageGeneratingCard prompt={pendingImagePrompt} />
      )}

      {imageError && (
        <div className="inline-flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive-foreground">
          <ImageOff className="h-3.5 w-3.5" /> {imageError}
        </div>
      )}

      {pdfPayloads.map((p, i) => (
        <DocumentCard
          key={`pdf-${i}`}
          icon={FileDown}
          label="PDF document"
          title={p.title}
          subtitle={p.subtitle || pdfSubtitle(p)}
          onDownload={() => buildAndDownloadPdf(p)}
        />
      ))}
      {pptxPayloads.map((p, i) => (
        <DocumentCard
          key={`pptx-${i}`}
          icon={Presentation}
          label="Slide deck"
          title={p.title}
          subtitle={p.subtitle || `${p.slides.length} slides`}
          onDownload={() => buildAndDownloadPptx(p)}
        />
      ))}
      {storyboards.map((s, i) => (
        <StoryboardCard key={`sb-${i}`} payload={s} />
      ))}
      {pendingDoc && (
        <div className="inline-flex items-center gap-2 rounded-xl border border-primary/40 bg-primary/5 px-3 py-2 text-xs">
          <Sparkles className="h-3.5 w-3.5 animate-pulse text-primary" />
          <Shimmer>
            {pendingDoc.kind === "pdf"
              ? "Drafting your PDF…"
              : pendingDoc.kind === "pptx"
                ? "Designing your slides…"
                : "Storyboarding your video…"}
          </Shimmer>
        </div>
      )}
    </div>
  );
}

function DocumentCard({
  icon: Icon,
  label,
  title,
  subtitle,
  onDownload,
}: {
  icon: typeof FileDown;
  label: string;
  title: string;
  subtitle?: string;
  onDownload: () => void | Promise<void>;
}) {
  return (
    <div className="group flex items-center gap-3 rounded-lg border border-border bg-card/60 p-3">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/20 text-primary">
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[10px] uppercase tracking-wider text-primary/80">
          {label}
        </div>
        <div className="truncate text-sm font-semibold text-foreground">
          {title}
        </div>
        {subtitle && (
          <div className="truncate text-[11px] text-muted-foreground">
            {subtitle}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={() => void onDownload()}
        className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition hover:brightness-110"
      >
        <Download className="h-3.5 w-3.5" />
        Download
      </button>
    </div>
  );
}

function StoryboardCard({ payload }: { payload: StoryboardPayload }) {
  const scenesWithImages = payload.scenes.filter((s) => !!s.imageUrl);
  const hasVideo = scenesWithImages.length > 0;
  const [loaded, setLoaded] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [progress, setProgress] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const imgRefs = useRef<Array<HTMLImageElement | null>>([]);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number>(0);
  const sceneStartRef = useRef<number>(0);

  const totalSeconds = useMemo(
    () => scenesWithImages.reduce((a, s) => a + (s.seconds || 5), 0) || 1,
    [scenesWithImages],
  );

  // Preload images.
  useEffect(() => {
    if (!hasVideo) return;
    let live = true;
    let count = 0;
    scenesWithImages.forEach((s) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = img.onerror = () => {
        if (!live) return;
        count += 1;
        setLoaded(count);
      };
      img.src = s.imageUrl!;
    });
    return () => {
      live = false;
    };
  }, [hasVideo, scenesWithImages]);

  const allReady = loaded >= scenesWithImages.length && hasVideo;

  // Play loop.
  useEffect(() => {
    if (!playing) return;
    startRef.current = performance.now();
    sceneStartRef.current = performance.now();
    let idx = current;
    const tick = (now: number) => {
      const sceneDur = (scenesWithImages[idx]?.seconds || 5) * 1000;
      const elapsedScene = now - sceneStartRef.current;
      const elapsedTotal = (now - startRef.current) / 1000;
      setProgress(Math.min(1, elapsedTotal / totalSeconds));
      if (elapsedScene >= sceneDur) {
        idx += 1;
        if (idx >= scenesWithImages.length) {
          setPlaying(false);
          setCurrent(0);
          setProgress(0);
          return;
        }
        sceneStartRef.current = now;
        setCurrent(idx);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [playing, scenesWithImages, totalSeconds, current]);

  const togglePlay = () => {
    if (!allReady) return;
    if (playing) {
      setPlaying(false);
    } else {
      if (current >= scenesWithImages.length) setCurrent(0);
      setPlaying(true);
    }
  };

  const downloadVideo = async () => {
    if (!allReady || downloading) return;
    setDownloading(true);
    try {
      const blob = await recordSlideshow(scenesWithImages, payload.title);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${payload.title.replace(/[^a-z0-9-_]+/gi, "_").slice(0, 60) || "video"}.webm`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      toast.error("Couldn't render the video — your browser may not support it.");
      // eslint-disable-next-line no-console
      console.error(e);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card/40">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <Film className="h-4 w-4 text-primary" />
        <div className="min-w-0 flex-1">
          <div className="text-[10px] uppercase tracking-wider text-primary/80">
            Generated video
          </div>
          <div className="truncate text-sm font-semibold">{payload.title}</div>
        </div>
        <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] text-primary">
          ~{Math.round(totalSeconds)}s
        </span>
      </div>

      {hasVideo && (
        <div className="relative aspect-video w-full overflow-hidden bg-black">
          {scenesWithImages.map((s, i) => (
            <img
              key={i}
              ref={(el) => { imgRefs.current[i] = el; }}
              src={s.imageUrl}
              alt={s.scene}
              className={cn(
                "absolute inset-0 h-full w-full object-cover transition-opacity duration-700",
                i === current ? "opacity-100" : "opacity-0",
                i === current && playing ? "ken-burns" : "",
              )}
              style={
                i === current && playing
                  ? { animationDuration: `${(s.seconds || 5)}s` }
                  : undefined
              }
              crossOrigin="anonymous"
            />
          ))}

          {/* Loading overlay */}
          {!allReady && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/60 backdrop-blur-sm">
              <Sparkles className="h-6 w-6 animate-pulse text-primary" />
              <Shimmer className="text-xs">
                {`Rendering scenes… ${loaded}/${scenesWithImages.length}`}
              </Shimmer>
            </div>
          )}

          {/* Caption */}
          {playing && scenesWithImages[current]?.voiceover && (
            <div className="absolute bottom-12 left-0 right-0 px-6 text-center">
              <span className="rounded-md bg-black/60 px-3 py-1 text-xs text-white shadow scene-fade">
                {scenesWithImages[current].voiceover}
              </span>
            </div>
          )}

          {/* Play overlay */}
          {!playing && allReady && (
            <button
              type="button"
              onClick={togglePlay}
              className="absolute inset-0 flex items-center justify-center bg-black/30 transition hover:bg-black/40"
              aria-label="Play"
            >
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/90 text-primary-foreground">
                <Play className="h-7 w-7 translate-x-0.5" fill="currentColor" />
              </span>
            </button>
          )}

          {/* Progress + controls */}
          <div className="absolute bottom-0 left-0 right-0 flex items-center gap-2 bg-gradient-to-t from-black/70 to-transparent px-3 py-2">
            <button
              type="button"
              onClick={togglePlay}
              disabled={!allReady}
              className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 disabled:opacity-50"
              aria-label={playing ? "Pause" : "Play"}
            >
              {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" fill="currentColor" />}
            </button>
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/15">
              <div
                className="h-full bg-primary transition-[width] duration-100"
                style={{ width: `${progress * 100}%` }}
              />
            </div>
            <span className="text-[10px] text-white/80 tabular-nums">
              {Math.floor(progress * totalSeconds)}s / {Math.round(totalSeconds)}s
            </span>
          </div>
        </div>
      )}

      <p className="px-4 pt-3 text-xs italic text-muted-foreground">
        {payload.logline}
      </p>

      <div className="flex items-center justify-between gap-2 px-4 pb-3 pt-3">
        <div className="text-[11px] text-muted-foreground">
          {scenesWithImages.length} scenes
        </div>
        {hasVideo && (
          <button
            type="button"
            onClick={downloadVideo}
            disabled={!allReady || downloading}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition hover:brightness-110 disabled:opacity-60"
          >
            <Download className="h-3.5 w-3.5" />
            {downloading ? "Rendering…" : "Download .webm"}
          </button>
        )}
      </div>

      <details className="border-t border-border/60 px-4 py-3">
        <summary className="cursor-pointer text-[11px] uppercase tracking-wider text-primary/80">
          Scene breakdown
        </summary>
        <ol className="mt-2 space-y-2">
          {payload.scenes.map((s, i) => (
            <li
              key={i}
              className="flex gap-3 rounded-lg border border-border/60 bg-background/40 p-3"
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/20 text-[10px] font-bold text-primary">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium text-foreground">{s.scene}</div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  <span className="text-primary/80">Visual:</span> {s.visual}
                </div>
                {s.voiceover && (
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    <span className="text-primary/80">VO:</span> “{s.voiceover}”
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}

async function recordSlideshow(
  scenes: StoryboardPayload["scenes"],
  _title: string,
): Promise<Blob> {
  const W = 1280;
  const H = 720;
  const fps = 30;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unsupported");

  // Preload all scene images as HTMLImageElement.
  const images = await Promise.all(
    scenes.map(
      (s) =>
        new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.onload = () => resolve(img);
          img.onerror = () => reject(new Error("image load failed"));
          img.src = s.imageUrl!;
        }),
    ),
  );

  const stream = canvas.captureStream(fps);
  const mimeCandidates = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ];
  const mime = mimeCandidates.find((m) =>
    typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m),
  );
  if (!mime) throw new Error("MediaRecorder not supported");
  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4_000_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };
  const done = new Promise<Blob>((resolve) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: mime }));
  });
  recorder.start();

  // Draw frames.
  const drawCover = (img: HTMLImageElement, scale: number, dx: number, dy: number) => {
    const iw = img.naturalWidth;
    const ih = img.naturalHeight;
    const ratio = Math.max(W / iw, H / ih) * scale;
    const dw = iw * ratio;
    const dh = ih * ratio;
    const x = (W - dw) / 2 + dx;
    const y = (H - dh) / 2 + dy;
    ctx.drawImage(img, x, y, dw, dh);
  };

  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  const frameMs = 1000 / fps;

  for (let i = 0; i < images.length; i++) {
    const dur = (scenes[i].seconds || 5) * 1000;
    const frames = Math.max(1, Math.round(dur / frameMs));
    const prev = images[i - 1];
    const fadeFrames = i > 0 ? Math.min(12, frames) : 0;
    for (let f = 0; f < frames; f++) {
      const t = f / Math.max(1, frames - 1);
      const scale = 1.05 + t * 0.13;
      const dx = -t * (W * 0.02);
      const dy = -t * (H * 0.02);
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, W, H);
      if (f < fadeFrames && prev) {
        drawCover(prev, 1.18, -W * 0.02, -H * 0.02);
        ctx.globalAlpha = f / fadeFrames;
        drawCover(images[i], scale, dx, dy);
        ctx.globalAlpha = 1;
      } else {
        drawCover(images[i], scale, dx, dy);
      }
      // Caption
      const vo = scenes[i].voiceover;
      if (vo) {
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.font = "600 28px system-ui, -apple-system, sans-serif";
        const text = vo.length > 90 ? vo.slice(0, 87) + "…" : vo;
        const m = ctx.measureText(text);
        const tw = m.width + 32;
        const tx = (W - tw) / 2;
        const ty = H - 80;
        ctx.fillRect(tx, ty, tw, 48);
        ctx.fillStyle = "#fff";
        ctx.textBaseline = "middle";
        ctx.fillText(text, tx + 16, ty + 24);
      }
      await sleep(frameMs);
    }
  }
  recorder.stop();
  return done;
}

function ImageGeneratingCard({ prompt }: { prompt: string }) {
  return (
    <div className="relative w-full max-w-md overflow-hidden rounded-xl border border-primary/40 bg-card/40 p-4 shadow-[0_0_30px_-8px_hsl(var(--primary)/0.5)]">
      {/* moving highlight sweep */}
      <div className="pointer-events-none absolute inset-0 -translate-x-full animate-shimmer-sweep bg-gradient-to-r from-transparent via-primary/25 to-transparent" />

      <div className="relative aspect-video overflow-hidden rounded-lg bg-[#05090c]">
        {/* rotating aurora backdrop */}
        <div
          className="absolute -inset-1/3 animate-aurora-spin opacity-70 blur-2xl"
          style={{
            background:
              "conic-gradient(from 0deg, hsl(var(--primary)/0.9), transparent 25%, hsl(180 90% 55% / 0.5) 50%, transparent 75%, hsl(var(--primary)/0.9))",
          }}
        />

        {/* pixel-materialize grid that fades away */}
        <div
          className="pointer-events-none absolute inset-0 animate-pixel-fade mix-blend-overlay"
          style={{
            backgroundImage:
              "linear-gradient(hsl(var(--primary)/0.35) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--primary)/0.35) 1px, transparent 1px)",
            backgroundSize: "12px 12px",
          }}
        />

        {/* horizontal scanline */}
        <div className="pointer-events-none absolute inset-x-0 h-8 animate-scanline bg-gradient-to-b from-transparent via-primary/70 to-transparent blur-[2px]" />

        {/* centre logo + dashed ring */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="relative flex h-20 w-20 items-center justify-center">
            <span className="absolute inset-0 animate-ping rounded-full bg-primary/25" />
            <span
              className="absolute inset-0 animate-dash-spin rounded-full border-2 border-dashed border-primary/70"
              style={{ borderStyle: "dashed" }}
            />
            <span className="absolute inset-3 rounded-full bg-primary/40 blur-md" />
            <Sparkles className="relative h-8 w-8 text-primary animate-pulse drop-shadow-[0_0_10px_hsl(var(--primary))]" />
          </div>
        </div>

        {/* status pill */}
        <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between rounded-md bg-black/50 px-2.5 py-1 text-[10px] text-primary-foreground/90 backdrop-blur-sm">
          <Shimmer className="text-[10px]">Rendering pixels…</Shimmer>
          <span className="tabular-nums text-primary">●●●</span>
        </div>
      </div>

      {prompt && (
        <p className="mt-3 line-clamp-2 text-[11px] italic text-muted-foreground">
          “{prompt}”
        </p>
      )}
    </div>
  );
}

function ThinkingIndicator() {
  return (
    <div className="inline-flex items-center gap-3 rounded-lg border border-border bg-card/60 px-4 py-2.5">
      <Sparkles className="h-4 w-4 text-primary animate-float-y" />
      <Shimmer className="text-xs">Lumen is thinking</Shimmer>
      <span className="dot-bounce inline-flex items-center" aria-hidden>
        <span /><span /><span />
      </span>
    </div>
  );
}