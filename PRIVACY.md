# Privacy Policy

**Last updated: June 6, 2026**

GitHub Accelerator is a browser extension that accelerates GitHub resource downloads through intelligent proxy node selection and 302 redirect, with full compatibility for download managers like IDM.

## Data Collection

GitHub Accelerator **does not collect, store, or transmit** any personal information, browsing history, credentials, or sensitive data. No analytics, cookies, or tracking technologies are used.

The extension only stores the following data locally via Browser Storage API:

| Data                       | Storage         | Purpose                                                                      |
| -------------------------- | --------------- | ---------------------------------------------------------------------------- |
| Best proxy node cache      | `storage.local` | Cached optimal proxy node with 2-hour TTL to avoid repeated speed tests      |
| Proxy node list            | `storage.local` | Cached list of available proxy nodes with latency results                    |
| Always accelerate toggle   | `storage.local` | User preference to automatically redirect without showing the intercept page |
| Session disable flag       | `storage.local` | Temporary flag to skip interception for the current session                  |
| Domain-level preferences   | `storage.local` | Per-domain accelerate/direct preferences set by the user                     |
| Anonymous usage statistics | `storage.local` | Aggregate counters for acceleration jumps and install counts                 |

## Data Usage & Storage

All data is stored locally in the user's browser and is never sent to any external server except as explicitly described in the Permissions & Network section below.

- **Local storage**: All cached data and user preferences are stored locally only and are automatically cleared upon extension uninstall.
- **No sync storage**: This extension does not use `storage.sync`, so no data is synchronized across devices or linked to the user's Google account.
- **No credentials**: The extension does not require, store, or handle any authentication tokens or credentials.

## Anonymous Statistics

This extension collects **anonymous, aggregate-only** usage statistics to help us understand how the extension is being used. The following data is tracked:

| Statistic               | Description                                                   |
| ----------------------- | ------------------------------------------------------------- |
| Acceleration jump count | Total number of times the acceleration redirect was triggered |
| Install / update count  | Number of times the extension was installed or updated        |

**What we do NOT collect:**

- Personal information (name, email, IP address, etc.)
- Browsing history or visited URLs
- Downloaded file names or content
- Browser bookmarks, passwords, or any sensitive data
- Any identifier that could be linked back to an individual user

**How the data is used:**
The anonymous aggregate statistics are used solely to understand extension usage patterns and for public-facing metrics (e.g., "over X accelerations delivered"). Data may be submitted to our server for aggregation, but no personally identifiable information is ever transmitted.

## Data Sharing

GitHub Accelerator **does not** share any user data with third parties. The extension has no servers, databases, or backend infrastructure. All data processing occurs entirely within the user's browser.

No personal information is sold, rented, or disclosed to any external party.

## Permissions & Network

The permissions declared in the extension manifest are the minimum required to provide its functionality:

| Permission                                 | Reason                                                           |
| ------------------------------------------ | ---------------------------------------------------------------- |
| `storage`                                  | Save settings and cache proxy node data locally                  |
| `contextMenus`                             | Add right-click menu items for copying/opening accelerated links |
| `scripting`                                | Execute scripts to display in-page notifications                 |
| `webNavigation`                            | Detect navigation to GitHub download URLs before they load       |
| `https://github.com/*`                     | Intercept GitHub download links (Releases, Archive, Raw, Blob)   |
| `https://codeload.github.com/*`            | Intercept GitHub code download links                             |
| `https://raw.githubusercontent.com/*`      | Intercept GitHub raw file links                                  |
| `https://gist.githubusercontent.com/*`     | Intercept GitHub Gist file links                                 |
| `https://hubp.tbedu.top/*`                 | Fetch the list of available proxy nodes from the API             |
| `https://addon-analytics.hubp.org/*`       | Submit anonymous usage statistics to the aggregation backend     |
| `https://addon-analytics-hubp.tbedu.top/*` | Submit anonymous usage statistics to the fallback backend        |
| `https://gh.dpik.top/*`                    | Geographic detection via Cloudflare trace endpoint (own domain)  |
| `https://www.visa.cn/*`                    | Fallback geographic detection via Cloudflare trace endpoint      |
| `https://www.cloudflare.com/*`             | Fallback geographic detection via Cloudflare trace endpoint      |
| `https://api.ipapi.is/*`                   | Last-resort fallback geographic detection                        |
| `https://api.ip.sb/*`                      | Last-resort fallback geographic detection                        |

Network requests made by the extension:

| Destination                                            | Data Sent                                                                                                 | Purpose                                                |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `https://hubp.tbedu.top/nodes.json`                    | None (GET request with Origin header)                                                                     | Fetch available proxy node list                        |
| `https://addon-analytics.hubp.org/stats/collect`       | Anonymous aggregate count only (e.g., `{ jumps: 1, installs: 0, browser: "chromium", version: "1.0.7" }`) | Submit anonymous usage statistics for aggregation      |
| `https://addon-analytics-hubp.tbedu.top/stats/collect` | Anonymous aggregate count only (same payload as above)                                                    | Fallback endpoint used when the primary is unreachable |
| `https://gh.dpik.top/cdn-cgi/trace`        | IP address (used only to determine country, not stored)          | Detect user geographic location (own domain, no third party) |
| `https://www.visa.cn/cdn-cgi/trace`        | IP address (used only to determine country, not stored)          | Fallback geographic detection (answered by Cloudflare/Visa)   |
| `https://www.cloudflare.com/cdn-cgi/trace` | IP address (used only to determine country, not stored)          | Fallback geographic detection (answered by Cloudflare)        |
| `https://api.ipapi.is/`                    | IP address (used only to determine country, not stored)          | Last-resort geographic detection (third party)                |
| `https://api.ip.sb/geoip`                  | IP address (used only to determine country, not stored)          | Last-resort geographic detection (third party)                |
| Proxy node URLs (e.g. `gh.dpik.top`)       | None                                                                                                      | Speed test proxy nodes by downloading a test resource  |
| `https://raw.githubusercontent.com/*`                  | None                                                                                                      | Verify proxy node integrity via hash comparison        |

No personal data, browsing history, or user identifiers are included in any network request. Geographic detection is used solely to determine whether the user's region requires proxy acceleration (e.g., GFW-restricted areas) and is not stored or transmitted.

## Open Source & Contact

This extension is fully open source. You can verify this privacy policy by reviewing the source code or report issues at:

https://github.com/hubporg/ghproxy-extension
