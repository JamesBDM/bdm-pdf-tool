# Hosting the BDM PDF Tool on GitHub Pages

> ## Already set up? Publishing a change is one step
>
> The project folder is now a git working copy of this repo, so there is no
> more dragging files into a browser:
>
> **Double-click `Deploy to GitHub.cmd`** (or run `.\deploy.ps1` in PowerShell).
>
> It checks the app's JavaScript actually parses, shows you exactly which files
> are going up, commits, pushes, and prints the live URL. GitHub Pages rebuilds
> in a minute or two — then hard-refresh with **Ctrl+F5** and check the version
> badge next to the logo.
>
> - `.\deploy.ps1 -WhatIfOnly` — see what would go up, send nothing.
> - `.\deploy.ps1 -Message "what changed"` — your own commit message.
> - **What gets published is decided by `.gitignore`, which is deny-by-default.**
>   Only the app, the icons, `index.html`, `manifest.json` and the three public
>   `.md` files leave your machine. Client PDFs, the user guides, brand assets,
>   backups and the agent skill stay put. Anything new you drop in the folder
>   stays private until you add it to the allow-list.
>
> The walkthrough below is the original one-off setup, kept for reference (and
> for the day someone has to do this again from scratch).

---

A click-by-click walkthrough. You only do this once. Allow about 10 minutes.

What you'll end up with: a permanent web address (e.g. `https://jamesbdm.github.io/bdm-pdf-tool/`) that you can install on any Windows machine as a real app.

The four files we're uploading live in this folder:
- `BDM-PDF-Markup-Tool.html`
- `manifest.json`
- `icon-192.png`
- `icon-512.png`

---

## Step 1 — Sign up for GitHub (skip if you already have an account)

1. Go to **https://github.com/signup**.
2. Enter your email (your work email is fine), pick a password, pick a username. The username becomes part of your web address, so pick something tidy — e.g. `jamesbdm` or `bentleydev`. Lowercase, no spaces.
3. GitHub will email you a code — paste it in to verify.
4. When it asks "How many team members?", choose **Just me**.
5. When it offers a paid plan, scroll down and pick the **Free** option. (Free is fine for this — Pages is included.)
6. You'll land on the GitHub homepage.

---

## Step 2 — Make a new "repository"

A repository is just a folder on GitHub. Don't let the jargon scare you.

1. In the top-right corner click the **+** icon → choose **New repository**.
2. **Repository name:** type `bdm-pdf-tool` (lowercase, with hyphens — this name becomes part of your web address).
3. **Description:** type something like *BDM PDF Markup & Measurement Tool* (optional).
4. Leave **Public** ticked. (Public means the *files* are visible if someone finds the URL. Your PDFs are never uploaded — only the tool itself. If you really want it private, that needs a paid plan to use Pages, so just keep it Public.)
5. Tick **Add a README file**. (This is so the repo isn't empty — needed for the next step.)
6. Leave the rest alone. Click the green **Create repository** button.

You'll land on a page that shows your new repo. The address bar will look like `https://github.com/yourname/bdm-pdf-tool`.

---

## Step 3 — Upload the four files

1. On the repo page, you'll see a row of buttons. Click the **Add file** dropdown → **Upload files**.
2. A page opens with a big dashed-line box that says "Drag files here…".
3. Open the BDM tool folder on your computer in a separate File Explorer window.
4. Select all four files (`BDM-PDF-Markup-Tool.html`, `manifest.json`, `icon-192.png`, `icon-512.png`) — hold **Ctrl** and click each one.
5. **Drag them into the dashed box** on the GitHub page. You'll see them appear as a list below.
6. Scroll down a bit. There's a green **Commit changes** button — click it. ("Commit" is GitHub-speak for "save". Don't worry about the message box, the default is fine.)
7. You're back on the repo page. You should now see all four files listed.

---

## Step 4 — Turn on GitHub Pages

This is what makes your repo accessible as a real website.

1. On your repo page, click the **Settings** tab (top row, near the right end — looks like a gear).
2. In the left-hand sidebar, click **Pages**.
3. You'll see a section called "Build and deployment". Under **Source**, leave it on **Deploy from a branch**.
4. Below that, under **Branch**, you'll see two dropdowns:
   - Left one: change from `None` to **main**.
   - Right one: leave on `/ (root)`.
5. Click **Save**.
6. The page will refresh. Near the top of the Pages settings, GitHub now shows a yellow message: *"Your site is live at https://yourname.github.io/bdm-pdf-tool/"* — but the link doesn't work yet. **Wait about 1–2 minutes** for GitHub to build it.
7. After a couple of minutes, refresh the page. The yellow notice turns green and says **"Your site is live at…"**.

---

## Step 5 — Bookmark your tool

Your tool's actual address is the Pages URL plus the HTML filename on the end. So if your Pages URL is:

`https://yourname.github.io/bdm-pdf-tool/`

Then your tool is at:

`https://yourname.github.io/bdm-pdf-tool/BDM-PDF-Markup-Tool.html`

1. Open that URL in **Chrome or Edge**.
2. The tool should load exactly like it does when you double-click the HTML file locally — but now it's running from the internet.
3. Bookmark it.

If the page shows GitHub's "404 — File not found" instead of your tool, you've either typed the URL wrong or GitHub hasn't finished building yet. Wait another minute and refresh.

---

## Step 6 — Install it as a Windows app

Now the magic step. With your tool open in Chrome or Edge:

1. Look at the address bar. On the right-hand side (just inside the URL bar, before the bookmark star) you'll see a small **install icon** — a monitor with a downward arrow, or a "+" inside a circle.
   - If you don't see it: click the **⋮** (three dots) menu at the top right → look for **Install BDM PDF Tool…** or **Apps → Install this site as an app**.
2. Click it. A dialog pops up: *"Install BDM PDF Markup & Measurement Tool?"*. Click **Install**.
3. The tool now opens in its own window — no browser tabs around it. It looks like a real Windows app.
4. Check your Start Menu — you'll find **BDM PDF Markup & Measurement Tool** in the apps list. There'll also be a desktop shortcut.

---

## Step 7 — Make it the default PDF app

This is the final step that turns "drag and drop" into "double-click any PDF":

1. Open **Windows Settings** (press the Windows key, type "Settings", Enter).
2. Click **Apps** → **Default apps**.
3. In the search box at the top, type `.pdf` and press Enter.
4. You'll see the current default for `.pdf` (probably Edge or Adobe). Click it.
5. From the list, pick **BDM PDF Markup & Measurement Tool**.
6. Click **Set default**.
7. Close Settings.

**Test it:** double-click any PDF anywhere on your machine. It should open straight in the BDM tool. Done.

---

## Sharing with the team

Each teammate just needs:

1. The URL: `https://yourname.github.io/bdm-pdf-tool/BDM-PDF-Markup-Tool.html`
2. To open it in Chrome or Edge and do **Step 6** (install) and **Step 7** (set default) on their machine.

That's about 60 seconds per person. No GitHub account needed for them — only for you, because you're the one hosting.

---

## Updating the tool later

When I (or you) make a change to the HTML file, you push the new version to GitHub:

1. On your repo page, click the file you want to replace (e.g. `BDM-PDF-Markup-Tool.html`).
2. Click the pencil/edit icon, or use **Add file → Upload files** with the new copy. Confirm "Commit changes".
3. The installed app on your team's machines picks up the new version next time it's opened. (Sometimes a Ctrl+F5 refresh inside the app helps if it's caching.)

---

## Troubleshooting

**"I can't see the install icon."** Make sure you're in Chrome or Edge, not Firefox or Safari. Also: the install icon appears once the manifest has loaded — try a hard refresh (Ctrl+F5).

**"The Settings → Default apps list doesn't show BDM."** Restart Windows after installing. Windows registers new file handlers at login.

**"GitHub Pages is showing the README instead of my tool."** That just means you typed the base URL without `BDM-PDF-Markup-Tool.html` on the end. Add it.

**"Double-clicking a PDF still opens Edge / Adobe."** Re-do Step 7 — Windows occasionally undoes default-app changes after big updates.

**"I changed the file but the app shows the old version."** Click the **⋮** menu inside the installed app window → look for a refresh option, or close and reopen. The browser caches things aggressively.

---

Stuck somewhere? Tell me which step and what you're seeing — I'll get you unstuck.
