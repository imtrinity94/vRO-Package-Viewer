# vRO Package Viewer

Browse the contents of a VMware **vRealize / Aria Orchestrator** or **VCF Automation Orchestrator** `.package` file in the browser — workflows, actions, configuration elements, resource elements and polyglot environments — without importing it into an Orchestrator.

The package is parsed entirely client-side (JSZip + DOMParser). Nothing is uploaded; the Vercel deployment is a static site with no backend. The CSP in `vercel.json` also blocks outbound connections.

## Features

- **Overview**: package metadata (name, ID, source vRO version, signer, owner), counts per element type, lines of script by language, sortable inventory with CSV / Markdown export.
- **Sidebar tree**: grouped by type, then by folder (workflows, config, resources) or module (actions). Filter by name, folder or ID.
- **Workflows**: inputs, outputs and attributes (including config-element bindings), a schema diagram built from the saved canvas positions (next / alternative / error-handler paths), per-item bindings and scripts, and custom input forms (start form + user-interaction forms).
- **Actions**: signature, parameters, script (JS / Python / PowerShell / Node), runtime, memory / timeout, bundle download.
- **Configuration elements**: attributes with decoded values (arrays, properties, SDK object references); SecureStrings are masked.
- **Resource elements**: MIME type, size, preview for text / JSON / XML / images / PDF, download.
- **Environments** (`ActionEnvironment`): runtime, dependencies, environment variables, bundle file listing and download.
- **References**: "uses" / "used by" between elements (ID references, `System.getModule(...)` calls, `script-module` items, linked workflows, runtime environments), plus a list of actions referenced from outside the package.
- **Search**: full-text / regex search across every script, config value and (optionally) raw XML.
- **Raw**: every file stored for an element, decoded (the package stores most XML as UTF-16BE), with per-file download.

## Package format notes

A `.package` is a zip:

```
dunes-meta-inf                 java.util.Properties XML: pkg-name, pkg-id, vso-version, signer, owner…
certificates/…                 signer certificate(s)
signatures/…                   per-file signatures (when the package is signed)
elements/<id>/info             Properties XML: id, type (Workflow, ScriptModule, ConfigurationElement, ResourceElement, ActionEnvironment…)
elements/<id>/categories       folder path (outermost first) or action module
elements/<id>/data             element XML (UTF-16BE) — or, for ResourceElement, a nested zip with VSO-RESOURCE-INF/attribute_* + data
elements/<id>/input_form_*     workflow custom forms (JSON)
elements/<id>/bundle           polyglot environment / action bundle (zip)
```

Unknown element types still appear under **Other**, with their raw files.

## Develop

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # static build in dist/
npm run build:single # one self-contained HTML file in dist-single/index.html
npm run test:parse -- path/to/file.package   # parse a package in Node and print a summary
```

## Deploy to Vercel

Push the repo to GitHub and import it in Vercel — the Vite preset is detected (`vercel.json` pins build command and output). Or from the CLI:

```bash
npm i -g vercel
vercel        # preview
vercel --prod
```
