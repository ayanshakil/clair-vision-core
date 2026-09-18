import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { loadThreads, newThreadId } from "@/lib/threads";

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    meta: [
      { title: "Lumen — AI, always on" },
      { name: "description", content: "Meet Lumen, a quiet and capable AI assistant for ideas, code, writing, and planning." },
      { property: "og:title", content: "Lumen — AI, always on" },
      { property: "og:description", content: "A quiet and capable AI assistant for ideas, code, writing, and planning." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

const TITLE = "Lumen".split("");
const BOOT_MODULES = [
  "Booting core",
  "Loading language models",
  "Calibrating tone",
  "Warming up creativity",
  "Ready",
];

function Index() {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<0 | 1 | 2 | 3 | 4>(0);
  const [mounted, setMounted] = useState(false);

  const goToChat = () => {
    const existing = loadThreads();
    const target = existing[0]?.id && existing[0].messages.length > 0 ? existing[0].id : newThreadId();
    navigate({ to: "/c/$threadId", params: { threadId: target }, replace: true });
  };

  useEffect(() => {
    setMounted(true);
    const seen = typeof window !== "undefined" && sessionStorage.getItem("lumen.splash.v1");

    if (seen) {
      goToChat();
      return;
    }
    sessionStorage.setItem("lumen.splash.v1", "1");

    // Staged opening: mark draws in, title/modules start, tagline settles, then fade out.
    const t1 = setTimeout(() => setPhase(1), 150);
    const t2 = setTimeout(() => setPhase(2), 950);
    const t3 = setTimeout(() => setPhase(3), 1700);
    const t4 = setTimeout(() => setPhase(4), 4100);
    const tNav = setTimeout(goToChat, 4600);
    return () => {
      [t1, t2, t3, t4, tNav].forEach(clearTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate]);

  return (
    <div className={`splash relative flex h-screen w-full items-center justify-center overflow-hidden ${phase >= 4 ? "is-leaving" : ""}`}>
      <div className="splash-grid" aria-hidden="true" />
      <div className="splash-orb splash-orb-a" aria-hidden="true" />
      <div className="splash-orb splash-orb-b" aria-hidden="true" />
      <div className="splash-orb splash-orb-c" aria-hidden="true" />
      <IntroStars />

      <button type="button" className="splash-skip" onClick={goToChat}>
        Skip intro
      </button>

      <div className="relative z-10 flex flex-col items-center text-center">
        <LumenMark active={mounted && phase >= 1} />

        <h1 className={`mt-6 font-serif text-5xl font-normal splash-title ${mounted && phase >= 2 ? "is-in" : ""}`}>
          {TITLE.map((ch, i) => (
            <span key={i}>{ch}</span>
          ))}
        </h1>

        <p className={`mt-3 text-sm tracking-wide splash-tagline ${mounted && phase >= 3 ? "is-in" : ""}`}>AI · always on</p>

        <BootSequence active={mounted && phase >= 2} />

        <div className={`splash-bar mt-4 ${mounted && phase >= 2 ? "is-in" : ""}`}>
          <span />
        </div>

        <p className={`mt-6 text-[11px] splash-credit ${mounted && phase >= 3 ? "is-in" : ""}`}>by MD RUHAAN</p>
      </div>
    </div>
  );
}

/** Central mark: glowing box, pulse rings, self-drawing icon that gently tilts toward the pointer. */
function LumenMark({ active }: { active: boolean }) {
  const tiltRef = useRef<HTMLDivElement>(null);

  const handleTilt = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = tiltRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width - 0.5;
    const py = (e.clientY - rect.top) / rect.height - 0.5;
    el.style.setProperty("--tiltX", `${px * 18}deg`);
    el.style.setProperty("--tiltY", `${-py * 18}deg`);
  };

  const resetTilt = () => {
    const el = tiltRef.current;
    if (!el) return;
    el.style.setProperty("--tiltX", "0deg");
    el.style.setProperty("--tiltY", "0deg");
  };

  return (
    <div className={`splash-logo ${active ? "is-in" : ""}`}>
      <span className="splash-ring" aria-hidden="true" />
      <span className="splash-ring splash-ring-2" aria-hidden="true" />
      <div ref={tiltRef} className="splash-tilt" onPointerMove={handleTilt} onPointerLeave={resetTilt}>
        <svg className="splash-icon" viewBox="0 0 120 76" fill="none" aria-hidden="true">
          <path className="splash-trail" d="M60 68V10M60 10l-5 7M60 10l5 7" />
          <path className="splash-horizon" d="M15 68s15-10 45-10 45 10 45 10" />
        </svg>
      </div>
    </div>
  );
}

/** Cycles through short "boot" status lines for a lively, alive-feeling loading state. */
function BootSequence({ active }: { active: boolean }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!active || index >= BOOT_MODULES.length - 1) return;
    const t = setTimeout(() => setIndex((i) => i + 1), 620);
    return () => clearTimeout(t);
  }, [active, index]);

  if (!active) return <div className="splash-modules" aria-hidden="true" />;

  return (
    <div className="splash-modules" aria-live="polite">
      <span key={index} className={`splash-module-line ${index === BOOT_MODULES.length - 1 ? "is-ready" : ""}`}>
        {BOOT_MODULES[index]}
      </span>
    </div>
  );
}

function IntroStars() {
  return (
    <div className="splash-stars" aria-hidden="true">
      {Array.from({ length: 42 }, (_, i) => (
        <i key={i} style={{ left: `${(i * 37) % 101}%`, top: `${(i * 61) % 97}%`, animationDelay: `${(i % 9) * 0.34}s` }} />
      ))}
    </div>
  );
}
