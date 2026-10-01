import type { PkgElement } from "../lib/types";

const paths: Record<PkgElement["kind"], string> = {
  // flow chart
  workflow: "M3 3h6v5H3zM15 16h6v5h-6zM6 8v5h12v3",
  // brackets
  action: "M8 4 4 12l4 8M16 4l4 8-4 8",
  // sliders
  config: "M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4",
  // file
  resource: "M6 2h8l4 4v16H6zM14 2v4h4",
  // box
  environment: "M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10",
  // play in circle
  run: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM10 8.5v7l5.5-3.5z",
  generic: "M4 4h16v16H4z",
};

export function KindIcon({ kind, size = 14 }: { kind: PkgElement["kind"]; size?: number }) {
  return (
    <svg className={`kicon k-${kind}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={paths[kind]} />
    </svg>
  );
}
