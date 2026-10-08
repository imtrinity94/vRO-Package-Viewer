# Changelog

All notable changes to vRO Peekage are listed here, newest first.

**Versioning:** `YEAR.MINOR.PATCH` (for example `2026.7.0`).

- **YEAR**: the calendar year of the release.
- **MINOR**: goes up for new features or visible changes. It restarts at 1 in a new year.
- **PATCH**: goes up for fixes and small tweaks.

The version lives in `package.json` and is shown in the app's top bar.

---

## 2026.9.1 (2026-10-08)

### Fixed
- **PowerShell and Python actions shown as JavaScript.** An 8.x action that runs in an action environment can name that environment in a `<environment>` element instead of a `runtime` attribute. That element wasn't read, so the action fell back to "JavaScript (Rhino)". It was highlighted as JavaScript and exported as a `.js` file.
- Scriptable tasks that use an environment were always assumed to be Python.

### Changed
- The script language is now worked out in this order:
  1. the element's own runtime
  2. the runtime of its environment, if the environment is in the package
  3. detection from the script itself, labelled for example "PowerShell (detected) · environment not in package"
  4. JavaScript (Rhino) for ordinary scripts
- The viewer, the report and the exported files (`.ps1` / `.py` / `.js`) all use the same result.

---

## 2026.9.0 (2026-10-08)

### Added
- **Resizable table columns.** Drag the right edge of any column header to resize it, and double-click the edge to reset. This works on every data table in the app.
- **Readable composite and array values.** Values such as an `Array/CompositeType(...)` in a configuration element, previously shown raw as `[205:CompositeType(...)#{14:20:...}`, are now decoded:
  - an array of composite values becomes a small table with one row per item and one column per field
  - plain arrays become a numbered list, and properties become a key/value table
  - the same decoding is used in workflow-run values, and as one-line text in the export report

### Changed
- Composite types in the Type column show their short name (for example `Array/ABSADCToRubrikClusterMapping`), with the field names underneath and the full signature on hover.

### Fixed
- Long sidebar group titles such as "Configuration Elements" now wrap left-aligned instead of centred.

---

## 2026.8.2 (2026-10-08)

### Changed
- The AI note moved out of the "Browse and export" step and into the landing page hero, right under the main description. It now reads "Ready for your AI assistant".
- A small **AI** badge sits beside it, with a slow colour shimmer and two twinkling sparkles. The animation switches off when "reduce motion" is turned on.

---

## 2026.8.1 (2026-10-08)

### Changed
- The landing page now says what the export actually contains — report, inventory, diagrams and every script as a real file — and notes that the zip is plain text throughout, so an AI assistant can read it too: point one at the unzipped folder and ask it about your workflows.
- The third step is now "Browse and export" rather than "Browse and share", which better matches what it does.

---

## 2026.8.0 (2026-10-06)

### Added
- An **Edit** button on every script and code viewer for quick prototyping. It is scratch editing only: nothing is saved, and the package and the export are never changed.
  - Syntax colours update live as you type, and the line numbers follow.
  - **Tab** and **Shift+Tab** indent and outdent, including across several selected lines.
  - **Enter** keeps the current indentation, and adds one level after `{`, `(` or `[`.
  - **Esc** leaves the editor.
  - An **edited** badge appears once the script changes. **Reset** restores the original. **Copy** copies your edited version.
  - Edits are discarded when you open another item.

## 2026.7.0 (2026-10-06)

### Added
- Vercel Web Analytics (`@vercel/analytics`) for page views and visitors.
- Vercel Speed Insights (`@vercel/speed-insights`) for real-user performance metrics.
- App version shown next to "vRO Peekage" in the top bar, in a smaller and lighter style.
- This changelog, with year-based version numbers.

## 2026.6.1 (2026-10-06)

### Changed
- The exported report and zip no longer carry any vRO Peekage branding, so they can be shared with customers as they are. This covers the title, cover, footer, README, script headers and fonts.

### Fixed
- Removed a stray `.claude-update.tgz` from the repo and added `.claude-*` to `.gitignore`.

## 2026.6.0 (2026-10-05)

### Added
- An **Export everything** button in the top bar and on the Overview page, with progress. It produces one zip per package containing:
  - `report.html`: a self-contained, print-ready report with an inventory and a section per element type
  - workflow schema diagrams as SVG and PNG, with the run overlay where a run exists
  - action and workflow scripts as `.js` files with header comments
  - raw workflow XML, configurations, resources, environments and runs
  - `inventory.csv` / `inventory.md` and a `README.txt`
- SecureString values are masked everywhere in the export.

## 2026.5.0 (2026-10-02)

### Added
- A workflow schema that matches Orchestrator, ported from wdt4vro: the real Orchestrator item icons, layout, error handlers and connectors.
- Zoom (wheel or buttons), drag-to-pan and fit-to-view on the schema.
- **Download SVG** and **Download PNG** for the schema.
- The workflow run overlay on the schema, showing executed items in green.

## 2026.4.0 (2026-10-02)

### Changed
- An Orchestrator-like light theme: navy top bar and a grey side panel, with blue highlighting on the active item.
- The UI font is now Clarity City, the font Orchestrator uses. It replaced Metropolis, which was harder to read.

## 2026.3.0 (2026-10-02)

### Added
- A Home button in the top bar that closes the package and returns to the front page.
- A floating back-to-top button.
- A GitHub icon link.

### Changed
- A taller top bar with larger icons.

## 2026.2.1 (2026-10-02)

### Fixed
- CSS and JS failed to load on the live site after a host redirect. The redirect was removed and URLs now point at the current domain.
- Restored source files that the rebrand commit had removed.

## 2026.2.0 (2026-10-01)

### Added
- The **vRO Peekage** name, the Peek Box logo and the tagline "Peek into your vRO Packages — no Orchestrator needed".
- A new, modern landing page that keeps the in-app look.
- Supported products listed as vRealize Orchestrator 7.x, Aria Automation Orchestrator 8.x and VCF Operations Orchestrator 9.x.
- SEO: meta and Open Graph tags, an OG image, sitemap, robots.txt, web manifest and a prerendered landing page.
- Security headers (CSP) in `vercel.json`.

## 2026.1.1 (2026-10-01)

### Fixed
- Code in the code viewer no longer overlaps the line-number gutter.

## 2026.1.0 (2026-10-01)

### Added
- The first release of the vRO package viewer, which parses `.package` files entirely in the browser.
- Lists workflows, actions, configuration elements, resource elements, environments and other elements, with search.
- Workflow details: inputs, outputs, attributes, script items, schema and presentation.
- Action scripts with syntax highlighting.
- A workflow run (WorkflowToken) view showing status, timings, inputs and outputs, variables and logs.
