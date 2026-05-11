# Turn the BDM PDF Tool into a real Windows app

Goal: double-click any PDF on your computer and have it open straight into the BDM tool — no drag-and-drop, no Open dialog.

It's a one-time setup (about 10 minutes the first time, then everyone on the team just installs it). You'll do it in three stages.

---

## Stage 1 — Put the tool on the web (one person, one time)

The tool needs a real web address before Windows can hook it up. Pick **one** of these:

### Option A — Netlify Drop (easiest, no account needed to try)

1. Go to **https://app.netlify.com/drop** in Chrome or Edge.
2. Open the folder that contains these four files on your PC:
   - `BDM-PDF-Markup-Tool.html`
   - `manifest.json`
   - `icon-192.png`
   - `icon-512.png`
3. Select all four files and **drag them onto the Netlify Drop page**.
4. Netlify gives you a web address that looks like `https://something-random-123.netlify.app`.
5. **Sign up for the free Netlify account when it prompts you** — otherwise the site disappears after 24 hours. Free account = permanent address.
6. Open the address Netlify gave you, then add `/BDM-PDF-Markup-Tool.html` on the end. That's your tool. Bookmark it.

That's it for hosting. Share that URL with anyone at BDM who needs the tool.

### Option B — GitHub Pages (free, slightly more clicks, more "professional")

1. Make a free GitHub account at **https://github.com** if you don't have one.
2. Click the green **New** button to make a new repository. Name it `bdm-pdf-tool`. Tick "Public" (private also works but needs a paid plan for Pages on some accounts). Click **Create**.
3. On the new empty repo's page, click **uploading an existing file**.
4. Drag in those same four files. Click **Commit changes**.
5. Click the repo's **Settings** tab → **Pages** in the left sidebar.
6. Under "Branch", choose `main` and `/ (root)`. Click **Save**.
7. Wait about a minute. Refresh. GitHub shows you a URL like `https://yourname.github.io/bdm-pdf-tool/`.
8. Your tool lives at `https://yourname.github.io/bdm-pdf-tool/BDM-PDF-Markup-Tool.html`.

---

## Stage 2 — Install the tool as an app (each person, one time, ~30 seconds)

On every machine that wants to use it:

1. Open the URL from Stage 1 in **Chrome or Edge** (not Firefox — it doesn't support this yet).
2. In the address bar, look for a small **install icon** on the right-hand side. It looks like a monitor with a downward arrow, or a "+" inside a circle. (In Edge, you can also click the ··· menu → **Apps** → **Install this site as an app**.)
3. Click it. Confirm **Install**.
4. The tool now appears in your Start Menu like any other program. You'll get a desktop shortcut too.

It runs in its own window from now on — no browser tabs around it. Looks like a real app because, well, now it is one.

---

## Stage 3 — Make PDFs open in the BDM tool by default (each person, one time)

1. Open **Windows Settings** → **Apps** → **Default apps**.
2. In the search box, type `.pdf` and press Enter.
3. Click whatever app is currently set as the default for `.pdf` (usually Edge or Adobe).
4. Pick **BDM PDF Markup & Measurement Tool** from the list. Click **Set default**.

Done. Now double-clicking any PDF anywhere on your computer opens it directly in the BDM tool.

---

## What if I want to update the tool later?

**Netlify:** drag the new file(s) onto your Netlify site dashboard (Deploys → drag-and-drop). Done — the installed app updates next time it opens.

**GitHub:** upload the new file in your repo (overwrites the old one). Same — updates automatically.

---

## Troubleshooting

**No install icon in the address bar.** Make sure you're using Chrome or Edge, not Firefox/Safari. Also: refresh the page once.

**"Set default" doesn't show the BDM tool.** Restart Windows after installing the app, then try again. Windows sometimes needs a kick.

**Double-clicking a PDF still opens Edge/Adobe.** Re-check Stage 3. Windows occasionally resets defaults after Windows updates — just redo Stage 3.

**Wrong PDF opens, or nothing happens.** Try right-clicking the PDF → **Open with** → pick the BDM tool. That'll confirm the file handler is wired up.
