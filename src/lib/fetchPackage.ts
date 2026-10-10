/**
 * "Open from URL": download a .package from a link and hand it to the parser.
 * The browser downloads directly whenever the site allows it (no server involved). Only when a
 * site blocks that (no CORS headers) does it fall back to the small /api/fetch-package proxy.
 */

const PROXY_MAX_MB = 4.4;

/** Turn common "view" links into direct-download links. */
export function normalizePackageUrl(input: string): string {
  const raw = input.trim();
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("That doesn't look like a link. Paste a full URL starting with https://");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("Only http and https links are supported.");

  // github.com/<owner>/<repo>/blob/<ref>/<path>  ->  raw.githubusercontent.com/<owner>/<repo>/<ref>/<path>
  const gh = /^\/([^/]+)\/([^/]+)\/(?:blob|raw)\/(.+)$/.exec(u.pathname);
  if (u.hostname === "github.com" && gh) return `https://raw.githubusercontent.com/${gh[1]}/${gh[2]}/${gh[3]}`;

  // gitlab.com/<group>/<project>/-/blob/<ref>/<path>  ->  .../-/raw/<ref>/<path>
  if (u.hostname === "gitlab.com" && u.pathname.includes("/-/blob/")) {
    u.pathname = u.pathname.replace("/-/blob/", "/-/raw/");
    return u.toString();
  }

  // Dropbox share links: ask for the file itself instead of the preview page
  if (/(^|\.)dropbox\.com$/.test(u.hostname)) {
    u.searchParams.set("dl", "1");
    return u.toString();
  }
  return u.toString();
}

/** A readable file name from the URL, e.g. "com.example.package". */
export function fileNameFromUrl(url: string): string {
  try {
    const last = decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).pop() || "");
    if (last) return /\.package$/i.test(last) ? last : `${last}.package`;
  } catch {
    /* fall through */
  }
  return "downloaded.package";
}

export interface FetchedPackage {
  file: File;
  /** "direct" when the browser downloaded it, "proxy" when the fallback was used */
  via: "direct" | "proxy";
}

async function asError(res: Response): Promise<Error> {
  let msg = `${res.status} ${res.statusText}`.trim();
  try {
    const j = (await res.json()) as { error?: string };
    if (j.error) msg = j.error;
  } catch {
    /* not JSON */
  }
  if (msg === "too-large")
    return new Error(`That package is larger than ${PROXY_MAX_MB} MB, the most the online download helper can carry. Download it yourself and drop the file here instead.`);
  return new Error(msg);
}

export async function fetchPackage(input: string): Promise<FetchedPackage> {
  const url = normalizePackageUrl(input);
  const name = fileNameFromUrl(url);

  // 1. Direct, in the browser. Fails with a TypeError when the site doesn't allow cross-site downloads.
  try {
    const res = await fetch(url, { mode: "cors", credentials: "omit", redirect: "follow" });
    if (res.ok) return { file: new File([await res.blob()], name), via: "direct" };
    if (res.status === 404) throw new Error("Nothing was found at that link (404).");
    if (res.status === 401 || res.status === 403)
      throw new Error("That link needs a sign-in, so vRO Peekage can't open it. Download the file yourself and drop it here instead.");
  } catch (e) {
    if (!(e instanceof TypeError)) throw e;
  }

  // 2. Fallback: the small proxy on this site.
  const res = await fetch(`/api/fetch-package?url=${encodeURIComponent(url)}`, { credentials: "omit" });
  if (!res.ok) throw await asError(res);
  return { file: new File([await res.blob()], name), via: "proxy" };
}

/** Link that opens a package straight in vRO Peekage. */
export function shareLink(packageUrl: string): string {
  return `${location.origin}/?url=${encodeURIComponent(packageUrl)}`;
}
