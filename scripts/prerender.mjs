// Renders the landing page (the app with no package loaded) to static HTML and
// writes it into dist/index.html, so search engines and link previews that don't
// run JavaScript still see the page content. The client replaces it on load.
import { readFileSync, writeFileSync } from "node:fs";
import { tsImport } from "tsx/esm/api";

const React = await import("react");
const { renderToString } = await import("react-dom/server");
const { default: App } = await tsImport("../src/App.tsx", import.meta.url);

const html = renderToString(React.createElement(App));
const file = new URL("../dist/index.html", import.meta.url);
const page = readFileSync(file, "utf8");
const marker = '<div id="root"></div>';
if (!page.includes(marker)) throw new Error("prerender: #root placeholder not found in dist/index.html");
writeFileSync(file, page.replace(marker, `<div id="root">${html}</div>`));
console.log(`prerender: wrote ${html.length.toLocaleString()} chars of landing HTML`);
