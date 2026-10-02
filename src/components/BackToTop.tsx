import { useEffect, useState, type RefObject } from "react";

/** Floating button that appears after scrolling down `target` and scrolls it back to the top. */
export function BackToTop({ target, threshold = 480 }: { target: RefObject<HTMLElement | null>; threshold?: number }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const el = target.current;
    if (!el) return;
    const onScroll = () => setShow(el.scrollTop > threshold);
    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [target, threshold]);

  const toTop = () => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    target.current?.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  };

  return (
    <button className={`to-top ${show ? "show" : ""}`} onClick={toTop} aria-label="Back to top" title="Back to top" tabIndex={show ? 0 : -1} aria-hidden={!show}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M12 19V5M5 12l7-7 7 7" />
      </svg>
    </button>
  );
}
