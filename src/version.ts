// Single source of truth is "version" in package.json.
// Scheme: YEAR.MINOR.PATCH  (e.g. 2026.7.0)
//   MINOR = new features or visible changes (resets to 1 each new year)
//   PATCH = fixes and small tweaks
import { version } from "../package.json";

export const APP_VERSION: string = version;
