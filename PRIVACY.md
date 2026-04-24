# Privacy Policy — SnapFull

_Last updated: 2026-04-24_

SnapFull ("the Extension") is a Chrome browser extension that captures full-page screenshots of web pages you visit. This policy explains what data is collected, how it is stored, and what is shared with third parties.

---

## 1. Data We Collect

### Screenshots and History
When you trigger a capture, the Extension renders a full-page screenshot of the active tab entirely inside your browser. The resulting image is stored **locally on your device** in the browser's IndexedDB storage. No screenshot is ever transmitted to any external server.

### No Browsing History
The Extension does **not** read, record, or transmit your browsing history, page content, passwords, form data, or any other personal information.

---

## 2. Data Storage

| Data | Where stored | Transmitted? |
|---|---|---|
| Full-page screenshots | Device (IndexedDB) | Never |
| Screenshot thumbnails | Device (IndexedDB) | Never |

All locally stored data remains on your device and can be deleted at any time from the Extension's History gallery (Clear All) or by uninstalling the Extension.

---

## 3. Third-Party Services

The Extension does **not** communicate with any third-party services. No analytics, advertising, or tracking SDKs are included.

---

## 4. Permissions Explanation

| Permission | Reason |
|---|---|
| `activeTab` | Access the currently active tab to capture its content |
| `tabs` | Query the active tab's URL and open the preview/gallery pages |
| `scripting` | Inject the capture script into the page to perform scrolling |
| `storage` | Save screenshot history locally |
| `host_permissions: <all_urls>` | Allow capturing screenshots on any website the user visits |

---

## 5. Children's Privacy

The Extension does not knowingly collect any information from children under the age of 13.

---

## 6. Changes to This Policy

If this policy changes materially, the updated version will be committed to this repository with a revised "Last updated" date.

---

## 7. Contact

For privacy-related questions, please open an issue at:  
**https://github.com/JerryLiang1222/SnapFull/issues**
