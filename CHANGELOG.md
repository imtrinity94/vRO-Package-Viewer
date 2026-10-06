# Changelog

All notable changes to vRO Peekage are listed here, newest first.

**Versioning:** `YEAR.MINOR.PATCH` (for example `2026.7.0`).

- **YEAR**: the calendar year of the release.
- **MINOR**: goes up for new features or visible changes. It restarts at 1 in a new year.
- **PATCH**: goes up for fixes and small tweaks.

The version lives in `package.json` and is shown in the app's top bar.

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
