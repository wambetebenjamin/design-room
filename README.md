# CHRISCO Design Room

An original, browser-based graphic design editor — pick a canvas size, compose from
templates or blank, add text/shapes/uploads, arrange and crop, then export
high-quality PNG/JPEG images, a ZIP of all pages, or a portable JSON document.

CHRISCO is an independent product inspired by common design-editor workflows.
It is not affiliated with, endorsed by, or derived from any existing design service.

## Stack

- **React 18 + TypeScript + Vite** — app shell, components, build
- **Zustand** — editor state with snapshot-based, grouped undo/redo transactions
- **Plain CSS** (`src/styles/global.css`) — light workspace, turquoise identity
- **IndexedDB** (hand-rolled promise wrapper) — designs, pages, elements, uploads
- **JSZip** — multi-page ZIP export
- **Canvas2D renderer** shared with the DOM view for exact-size exports
- **@fontsource** (OFL-licensed) — Inter, Space Grotesk, Playfair Display, Bebas Neue
  bundled locally; no runtime third-party requests
- **Vitest** — domain, persistence, history and jsdom integration tests

Domain logic (`src/domain`), data access (`src/data`), state (`src/store`),
rendering (`src/render`), export (`src/export`) and UI (`src/components`) are
kept in separate layers.

## Run

```bash
npm install
npm run dev        # local dev server
npm run build      # typecheck + production build → dist/
npm run preview    # serve the production build
npm test           # 57 unit + integration tests
```

## Features

- **Start a design** — social post (1080×1080), story (1080×1920), poster
  (A4 @150 DPI), presentation (1920×1080) or custom size (64–8000 px), blank or
  from one of six original templates rendered from real document data.
- **Compose** — text, five geometric shapes, and uploaded PNG/JPEG/WebP images
  (15 MB / 12000 px validation). Move, resize (8 handles, Shift keeps aspect),
  rotate (Shift snaps to 15°), crop images (reposition + rescale inside the
  frame), layer order, and align to page.
- **Typography & style** — font family, size, weight, color, alignment, italic,
  line height, letter spacing; six original color palettes and four page-level
  design presets.
- **Documents** — rename, duplicate, delete, reopen; multiple pages with
  thumbnails, add/duplicate/reorder/delete; grouped undo/redo (one gesture =
  one step) with Ctrl+Z / Ctrl+Shift+Z; autosave with visible status and
  Ctrl+S.
- **Export** — current page as PNG/JPEG at 1–4× scale, all pages as a ZIP, or a
  validated portable JSON document (importable from the home screen).

## Accessibility & keyboard

- Every control is a real button/input with labels; focus is always visible.
- Tab to an object, then: arrows nudge (Shift = 10 px), Enter edits text,
  Delete removes, Ctrl+D duplicates, Escape deselects / exits crop.
- Number fields for X/Y/W/H/rotation give a non-drag path for every direct
  manipulation; align buttons replace drag-only alignment.
- Tabs support arrow-key navigation; `prefers-reduced-motion` disables motion.

## Data & behaviour

- Storage is **local-first**: designs, pages, elements and image blobs live in
  IndexedDB in this browser. There is no backend, no accounts, no sharing —
  nothing is simulated as cloud functionality.
- Autosave debounces after each change; save errors surface with a retry;
  unsaved edits warn on tab close.
- Imported JSON is treated as untrusted and validated field-by-field before
  reaching editor state. Uploaded SVGs are rejected (no script-capable formats).
- Sample content is clearly labelled: the six bundled templates and any design
  marked **Sample** — never mixed into your own list beyond that badge.

## Known limits (honest notes)

- Portable JSON stores geometry/content but **not** uploaded image blobs
  (they stay in this browser); imported documents drop image elements by design.
- Verification ran as automated tests (57) plus a production-build smoke test —
  no real browser was available in the build sandbox, so pixel-level export
  comparisons and drag interactions were verified through jsdom mocks and unit
  tests rather than manual clicking.
