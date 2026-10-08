/**
 * Drag-to-resize columns for every data table in the app.
 * Grab the right edge of a column header and drag; double-click the edge to reset the table.
 * One document-level listener, so tables need no extra markup. Opt out with class "no-resize".
 */
const EDGE = 8; // px from a header's right edge that counts as the grip
const MIN_COL = 48;
const MIN_LAST = 120;

function headerCells(table: HTMLTableElement): HTMLTableCellElement[] {
  const row = table.tHead?.rows[0];
  return row ? (Array.from(row.cells) as HTMLTableCellElement[]) : [];
}

function gripTarget(e: MouseEvent): { th: HTMLTableCellElement; table: HTMLTableElement; cells: HTMLTableCellElement[] } | null {
  const th = (e.target as Element | null)?.closest?.("th") as HTMLTableCellElement | null;
  const table = th?.closest("table") as HTMLTableElement | null;
  if (!th || !table || table.classList.contains("no-resize") || table.classList.contains("ser-table")) return null;
  const cells = headerCells(table);
  const idx = cells.indexOf(th);
  if (idx < 0 || idx === cells.length - 1) return null; // the last column takes up the remaining space
  if (e.clientX < th.getBoundingClientRect().right - EDGE) return null;
  return { th, table, cells };
}

function fitTable(table: HTMLTableElement, cells: HTMLTableCellElement[]) {
  const fixed = cells.slice(0, -1).reduce((sum, c) => sum + c.getBoundingClientRect().width, 0);
  const avail = table.parentElement?.clientWidth ?? 0;
  table.style.width = fixed + MIN_LAST > avail ? `${Math.ceil(fixed + MIN_LAST)}px` : "100%";
}

function freeze(table: HTMLTableElement, cells: HTMLTableCellElement[]) {
  if (table.dataset.resized) return;
  const widths = cells.map((c) => c.getBoundingClientRect().width);
  cells.forEach((c, i) => {
    if (i < cells.length - 1) c.style.width = `${widths[i]}px`;
  });
  table.style.tableLayout = "fixed";
  table.dataset.resized = "1";
  fitTable(table, cells);
}

function reset(table: HTMLTableElement, cells: HTMLTableCellElement[]) {
  cells.forEach((c) => (c.style.width = ""));
  table.style.tableLayout = "";
  table.style.width = "";
  delete table.dataset.resized;
}

export function installColumnResize() {
  document.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const hit = gripTarget(e);
    if (!hit) return;
    const { th, table, cells } = hit;
    e.preventDefault();
    freeze(table, cells);
    const startX = e.clientX;
    const startW = th.getBoundingClientRect().width;
    document.body.classList.add("col-resizing");
    th.classList.add("col-resizing-th");

    const move = (ev: PointerEvent) => {
      th.style.width = `${Math.max(MIN_COL, Math.round(startW + ev.clientX - startX))}px`;
      fitTable(table, cells);
    };
    const up = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", up);
      document.body.classList.remove("col-resizing");
      th.classList.remove("col-resizing-th");
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", up);
  });

  document.addEventListener("dblclick", (e) => {
    const hit = gripTarget(e);
    if (hit) reset(hit.table, hit.cells);
  });
}
