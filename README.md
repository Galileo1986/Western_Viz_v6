# WesternU 3D Viewer — v6

A browser-based, **read-only** interactive 3D model of the WesternU campus for inspecting
space-inventory and reconciliation data at three nested scopes: **campus → building → floor (zone, room)**.

This is a **self-contained distributable**: a viewer, the frozen campus data, the Rhino geometry,
and a tiny local web server. It computes nothing and calls no external service.

---

## Run it

You need **Python 3** installed (used only as a static file server).

- **Windows:** double-click **`start.bat`**.
- **macOS / Linux:** run **`./start.sh`** in a terminal (make it executable once with `chmod +x start.sh`).

The launcher serves this folder on `http://localhost:8000/` and opens the viewer at
**`http://localhost:8000/viewer/`** in your default browser.

To stop: close the server window (Windows) or press **Ctrl+C** (macOS / Linux).
On Windows you can also run **`stop.bat`** to free port 8000.

> The viewer loads `.3dm` geometry directly in the browser (rhino3dm + three.js), so it must be
> served over `http://` — opening `viewer/index.html` from the file system will not work.

---

## Using the viewer

- First load shows the **campus** with every building. A short splash tracks loading, then **Enter**.
- **Layer menu** (left rail) — pick one layer at a time; the model recolors and the legend updates.
- **Click** a building (campus) to see its info card; **double-click** (or *Explore*) to enter
  **building** scope, where every room is colored by the active layer.
- In building scope, **click a room** for its readings. A **2D floor-plan** panel (bottom-right)
  is synced with the 3D model where a plan is available.
- Scope-up returns to campus.

---

## What's inside

```
viewer/        the viewer application (three.js + vanilla web components)
data/          frozen campus data the viewer reads (manifests, per-building data,
               content/prose, infographics, 2D plans, decor anchors, render config, cameras)
geometry/      Rhino .3dm models — 18 buildings + campus context + trees/roads/labels
fonts/         the Inter web font
devserver.py   a minimal no-cache static HTTP server (serves bytes only)
start.bat / start.sh / stop.bat   launchers
```

Everything the viewer displays is **pre-computed and frozen**. The same data always renders the
same way (deterministic). There is no build step, no database, and no network calls beyond loading
the three.js / rhino3dm libraries from their CDN on first run.

---

## Notes

- **Internet on first load:** the viewer pulls the three.js and rhino3dm libraries from a public CDN.
  After the browser has cached them, repeat runs work offline.
- **Copy it out of cloud sync (OneDrive / Dropbox / Google Drive) before running.** Sync engines can
  lock or truncate the large `.3dm` / data files mid-read and cause buildings to fail to load.
- A modern desktop browser with WebGL2 (recent Chrome, Edge, Firefox, or Safari) is recommended.
