"use client";

import { type PointerEvent, type ReactNode, useEffect, useState } from "react";
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
    if (!active) return;

    const examples = prompts.filter(Boolean);
    if (!examples.length) return;

    const motion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    let timer: number | undefined;
    let index = 0;
    let length = 0;
    let deleting = false;

    function tick() {
      const example = examples[index]!;
      length += deleting ? -1 : 1;
      setTyped(example.slice(0, length));

      let delay = deleting ? 16 : 45;
      if (!deleting && length === example.length) {
        deleting = true;
        delay = 2200;
      } else if (deleting && length === 0) {
        index = (index + 1) % examples.length;
        deleting = false;
        delay = 350;
      }
      timer = window.setTimeout(tick, delay);
    }

    function play() {
      window.clearTimeout(timer);
      if (!motion || motion.matches) {
        setTyped(examples[0]!);
        return;
      }
      index = 0;
      length = 0;
      deleting = false;
      setTyped(null);
      timer = window.setTimeout(tick, 600);
    }

    play();
    motion?.addEventListener("change", play);
    return () => {
      motion?.removeEventListener("change", play);
      window.clearTimeout(timer);
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
