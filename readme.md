# Jira Issue Reporter Chrome Extension

A lightweight Chrome extension that lets you capture a screenshot of any webpage, annotate it, and create a Jira issue—complete with dynamically populated metadata fields (priority, project, custom picklists, etc.). No more switching back and forth between Jira and your browser; everything happens in one tidy popup.

---

## Features

- **One-click screenshot capture**  
  Focuses the active tab, takes a screenshot, and loads it into an embedded canvas for annotation.

- **In-browser annotation**  
  Double-click the screenshot area to expand the canvas to full size. Then draw freehand (red pen, 2px stroke) directly on top of the image.

- **Auto-generated description**  
  Automatically fills in:
  - Frontend (FE) version & Backend (BE) version (scraped from any `<p class="--technology-version">` tags on the page)
  - Environment (hostname of the current URL)
  - Full page URL
  - Console logs (collected from the content script)

- **Dynamic Jira metadata**  
  When you open the popup, the extension calls Jira’s Create-Meta API and builds a dropdown for each picklist field in your “Bug” issue type—no hard-coding required. Examples:
  - Project
  - Issue Type
  - Priority
  - Affected System
  - Fix Versions
  - Any other custom single- or multi-select fields

- **Three-step issue creation**  
  1. **Create** a new Jira issue with summary, project, issue type, and all selected picklist fields.  
  2. **Update** the issue’s description (bulleted list + logs).  
  3. **Attach** the annotated screenshot.

- **Click-to-open**  
  Once the issue is created successfully, you’ll see a confirmation dialog with a direct link to the new ticket.

---

## Installation

1. **Clone or download** this repository to your local machine.
2. Open `chrome://extensions/` in Chrome.
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **“Load unpacked”** and select the folder containing this extension’s files (the folder with `manifest.json`).
5. You should now see **“Jira Issue Reporter”** in your extensions list, with the browser toolbar icon available.

---

## Configuration

Before you can create issues, you need to tell the extension how to connect to your Jira instance:

1. Click the extension’s toolbar icon (a small bug icon) to open the popup.
2. In the top right corner of the popup, click the **⚙️ Settings** button.
3. In the **Options** page, fill in:
   - **Jira Host** (e.g. `mycompany.atlassian.net`)
   - **Email** (your Atlassian account email)
   - **API Token** (create one here: https://id.atlassian.com/manage-profile/security/api-tokens)
   - **Default Project Key** (e.g. `PROJ`)
   - **Default Issue Type** (e.g. `Bug`)
4. Click **Save**. The extension will now store these values in `chrome.storage.sync` and use them on every issue creation.

> **Security Note**: The API token is stored in Chrome’s synced storage, encrypted. If you uninstall or reload the extension, you’ll need to re-enter these settings.

---

## Usage

### 1. Capture & Annotate

1. Navigate to any webpage (e.g. a page in your application or a third-party site).
2. Click the **Jira Issue Reporter** toolbar icon.
3. The extension will:
   - Bring the active tab into focus
   - Capture a screenshot of the visible area
   - Download a debug screenshot (for local inspection)
   - Request console logs from the content script
   - Save `issueData` (URL, screenshot Data URL, logs, tab ID) into local storage
   - Open a new popup tab (`popup.html`)

4. In the popup:
   - You’ll see the screenshot rendered inside a **256px-high canvas**.
   - **Double-click** the canvas area to expand it. The full-resolution screenshot will appear, and you can draw freehand on it with your mouse (red ink, 2px stroke).
   - Double-click again to collapse back to 256px.

### 2. Edit Summary & Description

- **Summary**: A one-line text input at the top.  
- **Description**: A large textarea pre-filled with:
  ```
  * FE Version: <scraped_from_page>
  * BE Version: <scraped_from_page>
  * Environment: <hostname>
  * URL: <full_current_url>
  *Console Logs:*
  ```
  followed by a triple-backtick block of captured console logs. You can edit this freely.

### 3. Pick Dynamic Fields

Below the description, you’ll see one dropdown for each “picklist” field in your Jira Create-Meta response. For example:

- **Project**  
- **Issue Type** (e.g. “Bug”)  
- **Priority** (e.g. “Blocker”, “Critical”, “Major”, “Medium”, “Minor”)  
- **Affected System** (custom field)  
- **Fix Versions** (multi-select dropdown—you can choose multiple versions)  
- **Any other custom picklist** (Environment, Components, etc.)

Each dropdown is built at runtime from Jira’s metadata. If the field’s `schema.type === "array"`, the `<select>` is rendered with `multiple`, so you can Ctrl-click/Ways to choose multiple options (e.g. multiple fix versions).

### 4. Submit the Issue

1. Make sure **Summary** is not empty.  
2. Select or multi-select the picklist fields (Priority, Affected System, Fix Versions, etc.).  
3. If you want to modify the screenshot, annotate it now (draw on the canvas).  
4. Click **Submit** at the bottom.
5. The extension will perform:
   1. **POST** `/rest/api/2/issue` with JSON payload:
      ```jsonc
      {
        "fields": {
          "project": { "key": "PROJ" },
          "summary": "Your summary here",
          "issuetype": { "name": "Bug" },
          "priority": { "id": "4" },
          "customfield_12345": { "id": "10100" },      // Affected System
          "fixVersions": [
            { "id": "20007" },
            { "id": "20010" }
          ],
          // … any other single/multi select fields …
        }
      }
      ```
   2. **PUT** `/rest/api/2/issue/{issueKey}` to update the `description` field with your edited text.
   3. **POST** `/rest/api/2/issue/{issueKey}/attachments` to upload the annotated screenshot (`issueData.screenshot`).
6. Once complete, you’ll see a confirmation `confirm()` dialog:
   > ✔ Issue PROJ-123 created in backlog!  
   > 👉 Click “OK” to open: `https://mycompany.atlassian.net/browse/PROJ-123`
7. Click **OK** to open the Jira ticket in a new tab, or **Cancel** to remain in the popup.

---

## File Structure

```
│   manifest.json
│   README.md          ← (this file)
├── background.js      ← Service-worker that captures screenshots, fetches metadata
├── content_script.js  ← Injected into every page: collects console logs on demand
├── debug.mjs          ← Simple helper for console debug logging
├── issue.mjs          ← Issues the 3-step Jira API calls (create, update desc, attach image)
├── metadata.mjs       ← (Deprecated) Static metadata logic was moved to background.js
├── options.html       ← Settings page UI (Jira credentials, project key, issue type)
├── options.js         ← Saves options to chrome.storage.sync
├── popup.html         ← Main popup UI (canvas, summary, description, dynamic picks)
├── popup.mjs          ← Controls popup behavior: drawing, metadata, submission
└── style.css          ← (If you prefer an external stylesheet; otherwise inline styles)
```

---

## Permissions & Security

- **Permissions** listed in `manifest.json`:
  - `"activeTab"`: Focus and capture the visible tab.
  - `"scripting"`: Inject content scripts and request page versions.
  - `"storage"`: Read/write settings (Jira credentials + metadata) and screenshot/logs.
  - `"downloads"`: Save a debug screenshot to your Downloads folder.
  - `"host_permissions": ["https://*.atlassian.net/*"]`: Allow CORS requests to your Jira host.

- **API Token Security**  
  - Your Jira API token is stored in Chrome’s **`chrome.storage.sync`**, which is encrypted and synced across your signed-in devices.  
  - If you uninstall or reload the extension, you’ll need to re-enter your email and token.

---

## Troubleshooting

1. **Popup shows “Couldn’t create issue: …”**  
   - Check the **Debug Log** at the bottom of the popup. Most errors (invalid field values, missing required fields) will display a JSON error from Jira.  
   - Verify that you selected at least one required field (e.g. Affected System cannot be empty).  
   - Make sure your **Jira settings** (host, email, token, project key) are correct in the Options page.

2. **Fields not appearing in the popup**  
   - Ensure that your Jira user has permission to view the Create-Meta for `issuetype=Bug` in that project.  
   - Open DevTools in the popup (Right-click → Inspect) and look for errors in the console under **popup.html**. You may see a CORS or network error—check that `"host_permissions"` in `manifest.json` matches exactly your Jira host.

3. **Drawing doesn’t align when expanded**  
   - We fixed this by mapping CSS coordinates back into the canvas’s internal pixel dimensions. If strokes are still misaligned, double-check that the `<canvas>` element is not wrapped by additional CSS transforms or padding. Inspect the computed `width`/`height` in DevTools.

4. **Screenshot always shows an old tab (e.g. a Jira board)**  
   - The extension focuses the active tab, waits until it is truly active, then captures. If the capture still grabs a different page, check for errors in the **background.js** console (via `chrome://extensions → Inspect Service Worker`).  
   - Make sure no other extension or rapid tab switching interferes.

---

## Development & Contribution

1. **Development setup**  
   - Clone this repo.  
   - In Chrome’s `chrome://extensions`, enable Developer mode and “Load unpacked” pointing to this folder.  
   - Use “Inspect background page” and “Inspect popup” in the Chrome Extensions page to see console logs.  
   - Edit files under `src/` (if you change directory structure) or directly in `background.js`, `popup.mjs`, etc., then click “Reload” on `chrome://extensions` to pick up changes.

2. **Testing flow**  
   - Click the extension icon on any webpage.  
   - Annotate the screenshot.  
   - Fill in Summary + any required picklists.  
   - Click Submit and watch the network calls in the **Service Worker** console.  
   - Verify the new Jira issue appears correctly with annotated image and description.

3. **Pull Requests**  
   - Fork → create a branch → implement features/fixes → test in Chrome → submit a PR with description and screenshots if relevant.  
   - Please follow consistent formatting, keep the code modular (one concern per module), and add console logs (`debug(...)`) for new functionality.

---

## License

This project is released under the **MIT License**. Feel free to inspect, fork, and modify as needed for your organization’s workflows.

---

> _“Capture, annotate, and file your Jira bugs without leaving your browser. Built with ❤️ and browser APIs.”_