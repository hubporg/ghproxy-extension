# Privacy Policy

**Last updated: May 28, 2026**

GitHub Accelerator is a browser extension that accelerates GitHub resource downloads through intelligent proxy node selection and 302 redirect, with full compatibility for download managers like IDM.

## Data Collection

GitHub Accelerator **does not collect, store, or transmit** any personal information, browsing history, credentials, or sensitive data. No analytics, cookies, or tracking technologies are used.

The extension only stores the following data locally via Browser Storage API:

| Data                          | Storage              | Purpose                                                          |
| ----------------------------- | -------------------- | ---------------------------------------------------------------- |
| Best proxy node cache         | `storage.local`      | Cached optimal proxy node with 2-hour TTL to avoid repeated speed tests |
| Proxy node list               | `storage.local`      | Cached list of available proxy nodes with latency results        |
| Always accelerate toggle      | `storage.local`      | User preference to automatically redirect without showing the intercept page |
| Session disable flag          | `storage.local`      | Temporary flag to skip interception for the current session      |
| Domain-level preferences      | `storage.local`      | Per-domain accelerate/direct preferences set by the user         |

## Data Usage & Storage

All data is stored locally in the user's browser and is never sent to any external server except as explicitly described in the Permissions & Network section below.

- **Local storage**: All cached data and user preferences are stored locally only and are automatically cleared upon extension uninstall.
- **No sync storage**: This extension does not use `storage.sync`, so no data is synchronized across devices or linked to the user's Google account.
- **No credentials**: The extension does not require, store, or handle any authentication tokens or credentials.

## Data Sharing

GitHub Accelerator **does not** share any user data with third parties. The extension has no servers, databases, or backend infrastructure. All data processing occurs entirely within the user's browser.

No personal information is sold, rented, or disclosed to any external party.

## Permissions & Network

The permissions declared in the extension manifest are the minimum required to provide its functionality:

| Permission                        | Reason                                                       |
| --------------------------------- | ------------------------------------------------------------ |
| `storage`                         | Save settings and cache proxy node data locally              |
| `contextMenus`                    | Add right-click menu items for copying/opening accelerated links |
| `activeTab`                       | Access the current tab to inject notification scripts        |
| `scripting`                       | Execute scripts to display in-page notifications             |
| `tabs`                            | Intercept and redirect GitHub download navigation            |
| `webNavigation`                   | Detect navigation to GitHub download URLs before they load   |
| `https://github.com/*`            | Intercept GitHub download links (Releases, Archive, Raw, Blob) |
| `https://codeload.github.com/*`   | Intercept GitHub code download links                         |
| `https://raw.githubusercontent.com/*` | Intercept GitHub raw file links                          |
| `https://gist.githubusercontent.com/*` | Intercept GitHub Gist file links                        |
| `https://api.akams.cn/*`          | Fetch the list of available proxy nodes from the API         |

Network requests made by the extension:

| Destination                        | Data Sent                      | Purpose                                              |
| ---------------------------------- | ------------------------------ | ---------------------------------------------------- |
| `https://api.akams.cn/github`     | None (GET request with Origin header) | Fetch available proxy node list               |
| `https://api.ipapi.is/`           | None                           | Detect user geographic location (country code)       |
| `https://api.ip.sb/geoip`         | None                           | Fallback geographic location detection               |
| Proxy node URLs (e.g. `gh.llkk.cc`) | None                        | Speed test proxy nodes by downloading a test resource |
| `https://raw.githubusercontent.com/*` | None                        | Verify proxy node integrity via hash comparison      |

No personal data, browsing history, or user identifiers are included in any network request. Geographic detection is used solely to determine whether the user's region requires proxy acceleration (e.g., GFW-restricted areas) and is not stored or transmitted.

## Open Source & Contact

This extension is fully open source. You can verify this privacy policy by reviewing the source code or report issues at:

https://github.com/hubporg/ghproxy-extension
