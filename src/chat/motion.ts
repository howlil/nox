import { animate } from "motion/mini";

const EASE_OUT_STRONG = [0.23, 1, 0.32, 1] as const;

function reducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function play(
  element: HTMLElement,
  keyframes: Record<string, string | number | Array<string | number>>,
  duration: number,
): void {
  if (reducedMotion()) return;

  element.addClass("nox-motion-active");
  const animation = animate(element, keyframes, {
    duration,
    ease: EASE_OUT_STRONG,
  });

  const cleanup = () => element.removeClass("nox-motion-active");
  void animation.then(cleanup, cleanup);
}

export function animateNoxEnter(element: HTMLElement, offset = 6): void {
  play(
    element,
    {
      opacity: [0, 1],
      transform: [`translateY(${offset}px)`, "translateY(0px)"],
    },
    0.18,
  );
}

export function animateNoxPopover(element: HTMLElement): void {
  play(
    element,
    {
      opacity: [0, 1],
      transform: ["translateY(4px) scale(0.985)", "translateY(0px) scale(1)"],
    },
    0.16,
  );
}
