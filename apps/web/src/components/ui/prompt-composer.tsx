"use client";

import { type PointerEvent, type ReactNode, useEffect, useState } from "react";
import { gsap } from "gsap";
import { ArrowUp, Paperclip } from "lucide-react";
import styles from "./prompt-composer.module.css";

interface PromptComposerProps {
  prompts: readonly string[];
  placeholder: string;
  controls: ReactNode;
  maxLength: number;
  disabled: boolean;
  onSubmit: (prompt: string) => void;
  onAttach: () => void;
}

function useAnimatedPrompt(prompts: readonly string[], active: boolean) {
  const [typed, setTyped] = useState<string | null>(null);

  useEffect(() => {
    setTyped(null);
    if (!active || !prompts.length) return;

    const motion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!motion) {
      setTyped(prompts[0]!);
      return;
    }
    const play = () => {
      if (motion.matches) {
        setTyped(prompts[0]!);
        return;
      }

      const cursor = { length: 0 };
      const timeline = gsap.timeline({ repeat: -1, delay: 0.6 });
      for (const prompt of prompts) {
        const update = () => setTyped(prompt.slice(0, Math.round(cursor.length)));
        timeline.to(cursor, {
          length: prompt.length,
          duration: prompt.length * 0.045,
          ease: "none",
          onUpdate: update,
        });
        timeline.to(
          cursor,
          { length: 0, duration: prompt.length * 0.016, ease: "none", onUpdate: update },
          "+=2.2",
        );
        timeline.to(cursor, { length: 0, duration: 0.35 });
      }
      return () => timeline.kill();
    };

    let stop = play();
    const change = () => {
      stop?.();
      setTyped(null);
      stop = play();
    };
    motion.addEventListener("change", change);
    return () => {
      motion.removeEventListener("change", change);
      stop?.();
    };
  }, [active, prompts]);

  return typed;
}

function moveSheen(event: PointerEvent<HTMLFormElement>) {
  if (event.pointerType !== "mouse") return;
  const card = event.currentTarget;
  const bounds = card.getBoundingClientRect();
  card.style.setProperty("--sheen-x", `${event.clientX - bounds.left}px`);
  card.style.setProperty("--sheen-y", `${event.clientY - bounds.top}px`);
}

export default function PromptComposer({
  prompts,
  placeholder,
  controls,
  maxLength,
  disabled,
  onSubmit,
  onAttach,
}: PromptComposerProps) {
  const [draft, setDraft] = useState("");
  const [focused, setFocused] = useState(false);
  const animate = !draft && !focused;
  const typed = useAnimatedPrompt(prompts, animate);
  const prompt = draft.trim();

  return (
    <div className="space-y-3">
      <form
        className={styles.card}
        aria-label="Compose a journal message"
        onPointerMove={moveSheen}
        onSubmit={(event) => {
          event.preventDefault();
          if (!prompt || disabled) return;
          onSubmit(prompt);
          setDraft("");
        }}
      >
        <div className="relative">
          <textarea
            aria-label="Message"
            className={styles.input}
            rows={2}
            maxLength={maxLength}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }}
          />
          {!draft && (
            <span className={styles.placeholder} aria-hidden="true">
              {animate ? (typed ?? placeholder) : placeholder}
              {animate && typed !== null && <i className={styles.caret} />}
            </span>
          )}
        </div>
        <div className="relative mt-4 flex flex-wrap items-center justify-between gap-2 sm:mt-5">
          {controls}
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <button
              type="button"
              className={styles.attach}
              aria-label="Attach a trading statement"
              title="Attach a trading statement"
              onClick={onAttach}
            >
              <Paperclip className="size-[19px]" aria-hidden="true" />
            </button>
            <button
              type="submit"
              className={styles.send}
              aria-label="Send message"
              disabled={disabled || !prompt}
            >
              <ArrowUp className="size-[18px]" strokeWidth={2.5} aria-hidden="true" />
            </button>
          </div>
        </div>
      </form>
      <p className={styles.hint}>
        <kbd>Enter</kbd> to send <span aria-hidden="true">/</span> <kbd>Shift</kbd> +{" "}
        <kbd>Enter</kbd> for a new line
      </p>
    </div>
  );
}
