# 3D-DMS — Palashbari–Sualkuchi Bridge Digital Twin

3D-DMS (formerly *RoadBIM*) is a web application for tracking construction of the
**Palashbari–Sualkuchi Extradosed Bridge** across the Brahmaputra. It is a React front end
and an ASP.NET Core 8 + PostgreSQL back end.

At its centre is the **Bridge RFI Tracker**. Each month the team uploads the IPC
measurement workbook, and the tracker:
- links every Schedule 4 row to a bridge element in the 3D model;
- colours the bridge by what has actually been built;
- flags work that must have been done but has no RFI;
- lists billing and data errors in the workbook.

Everything runs locally in the browser and the server. No AI model or external service is involved.

> **Status, 8 Oct 2026:** the deployment holds one project, **Palashbari Project**. Its
> package **001 · Bridge** is the tracker. Sign-in is currently **switched off** for team
> sharing (see [Sign-in](#sign-in-and-roles)). Turn it back on before exposing the server.

---

## Contents

1. [Quick start](#quick-start)
2. [What is in the deployment](#what-is-in-the-deployment)
3. [Architecture](#architecture)
4. [Repository layout](#repository-layout)
5. [Projects, packages and modules](#projects-packages-and-modules)
6. [The Bridge RFI Tracker](#the-bridge-rfi-tracker)
7. [Road packages (the original RoadBIM features)](#road-packages-the-original-roadbim-features)
8. [Back end](#back-end)
9. [Front end](#front-end)
10. [Testing](#testing)
11. [Sharing with the team over ngrok](#sharing-with-the-team-over-ngrok)
12. [Operations: backups, restore, migrations](#operations-backups-restore-migrations)
13. [Known issues and open decisions](#known-issues-and-open-decisions)
14. [Change history](#change-history)
15. [Other documents](#other-documents)

---

## Quick start

### Prerequisites

| Tool | Version used | Notes |
|---|---|---|
| .NET SDK | 8.0 | `dotnet --version` |
| Node.js | 18+ (tested on 24) | Node 21+ is needed for the test glob syntax |
| PostgreSQL | 18 (any recent version works) | `psql`, `pg_dump`, `pg_restore` are in `C:\Program Files\PostgreSQL\18\bin` |
| Chrome or Edge | current | WebGL is required for the 3D views |

### 1. Database

Create an empty database, then point the back end at it in
[Backend/appsettings.json](Backend/appsettings.json):

```json
"ConnectionStrings": {
  "DefaultConnection": "Host=localhost;Port=5432;Database=roadbimtwindb;Username=postgres;Password=<your password>"
}
```

You don't need to create tables. On start-up the back end applies every EF Core migration
automatically.

### 2. Back end — http://localhost:5000

```bash
cd Backend
dotnet restore
dotnet run
```

- Swagger UI: http://localhost:5000/swagger
- On start-up the back end:
  - applies migrations;
  - installs the PostgreSQL helper functions;
  - with sign-in off, prints a banner saying so.
- Uploaded files are written under `Backend/Storage/` (see [Storage](#storage-on-disk)).

### 3. Front end — http://localhost:3000

```bash
cd Frontend
npm install        # postinstall copies web-ifc.wasm into public/wasm
npm run dev
```

Vite proxies `/api` to `http://localhost:5000`, so the browser only ever talks to port 3000.
To point the proxy at another back end, set `API_TARGET`, e.g.
`API_TARGET=http://localhost:5055 npm run dev`.

### 4. Open the tracker

Select **Palashbari Project → 001 · Bridge** in the top bar, then **Bridge RFI Tracker**
in the sidebar.

---

## What is in the deployment

| Project | Code | Packages |
|---|---|---|
| **Palashbari Project** | `road-50` | `main`, `r50-1`, `pkg-tunnel` (road packages), **`001` · Bridge** (the tracker) |

- **Code:** the project code stays `road-50` even though the project was renamed. Changing it
  would break package paths (`road-50/001`) and the selection each browser remembers.
- **Deleted projects:** the eight other projects were deleted on 8 Oct 2026. A backup is in
  `Backups/2026-10-08-before-deleting-8-projects/` (see [Operations](#operations-backups-restore-migrations)).

**Package 001 · Bridge** (module `palashbari-tracker`) shows only two screens:

| Screen | What it shows |
|---|---|
| **Bridge RFI Tracker** | The 3D tracker. |
| **Dashboard** | The tracker's figures: built, cast in yard, RFI not raised, data issues, segments cast, wells, and where each figure comes from. |

Its current uploads:

| Upload | File |
|---|---|
| IFC model | `Bridge plb 2.ifc` — 791 elements, 2 modules, 9 piers |
| Mapping register | `register.xlsx` — `Element_Register`, 1,811 keys, 289 GUIDs |
| Monthly IPC | IPC‑34 — 1 Jul–31 Jul 2026, 1,152 Schedule 4 rows |
| Alignment | Reduced from `align.kmz` — 1,232 points, 12.19 km |

---

## Architecture

```text
Browser (Chrome / Edge)
 ├─ React 18 app (Vite)                                   Frontend/src
 │   ├─ Top bar: project / package picker, status chips   components/Auth/ProjectBar.jsx
 │   ├─ Sidebar: screens for the active package           components/SidebarNav.jsx
 │   ├─ Road screens: dashboard, 3D (web-ifc + three.js),
 │   │   plan map (Leaflet), RFIs, import wizard, EVM
 │   └─ Bridge RFI Tracker module                         modules/bridgeTracker/
 │        ├─ parsers: IFC (own STEP reader), Schedule 4, register, KMZ
 │        ├─ engine: element keys, stages, 9 sequence rules, 16 data checks
 │        ├─ automap + plan: geometry keys, pier numbering, module copies
 │        └─ viewer: three.js scene, legend, 4D replay, exports
 │
 └─ /api  ── Vite proxy ──►  ASP.NET Core 8 Web API        Backend/
                              ├─ JWT auth (or the shared-access bypass)
                              ├─ Controllers (projects, packages, IFC, imports,
                              │   RFIs, inspections, bridge tracker, legacy)
                              ├─ EF Core 8 + Npgsql  ──►  PostgreSQL (roadbimtwindb)
                              └─ Files on disk           Backend/Storage/
```

**Design rule: the browser parses, the server stores.** Excel, IFC and KMZ files are parsed
in the browser. The server holds:
- each file, under its SHA-256 hash;
- who uploaded it, and when;
- the transactional state.

Re-uploading identical bytes is a no-op.

---

## Repository layout

```text
Backend/                     ASP.NET Core 8 Web API
  Controllers/               HTTP endpoints (see the API reference below)
  Data/                      RoadDbContext, DatabaseSeeder, LegacyScope, SQL functions
  Migrations/                EF Core migrations (applied automatically on start-up)
  Models/                    Entities and DTOs
  Services/                  Import, access control, RFI workflow, JWT, auth bypass, analytics
  Storage/                   Uploaded files (created at run time)
Frontend/                    React 18 + Vite
  src/api/client.js          The only place that calls the API
  src/context/               AuthContext (session, project, package), RoadDataContext (package data)
  src/components/            Screens and widgets
  src/modules/bridgeTracker/ The Palashbari Bridge RFI Tracker
  src/utils/                 IFC loader, Excel import, resolver, PDF export, metrics
  tests/bridge/              Tracker test suite (node:test) and fixtures/
  tests/bridge-api/          Read-only smoke test for a running back end
Database/                    Reference SQL schemas (the live schema comes from migrations)
docs/                        Design notes (see "Other documents")
Backups/                     Local backups — do not commit (see Known issues)
Project_Documentation.md     Original 100 km road prototype write-up (out of date)
```

---

## Projects, packages and modules

- **Project:** the unit people belong to. Membership and roles are granted per project.
- **Package:** the unit data belongs to, e.g. one contract. Every upload, import, model and RFI
  is written into exactly one package. The top bar's package picker chooses which.
- **Module:** a package setting (`Package.Module`) that switches a package onto its own data
  path and screens.

| Module | Value | Data path | Screens |
|---|---|---|---|
| Road package | `null` | Chainages × layers, four road workbooks, IFC models, RFIs | All road screens |
| Palashbari tracker | `palashbari-tracker` | Four tracker uploads | Bridge RFI Tracker and Dashboard only |

To make a package a tracker (Contributor or Owner role required):

```bash
curl -X PATCH http://localhost:5000/api/packages/11 -H "Content-Type: application/json" \
     -d '{"module":"palashbari-tracker"}'      # "" turns it back into a road package
```

### Sign-in and roles

- **Accounts:** users register and sign in with email and password. Passwords are hashed with
  BCrypt, and the server issues an 8-hour JWT (`Jwt:AccessTokenMinutes`).
- **Project roles:**
  - **Viewer** reads everything.
  - **Contributor** also imports, uploads and edits.
  - **Owner** also manages members and can delete.
- **System administrators** reach every project.
- **Field engineer** is a per-member flag. It governs who may inspect RFIs.

**Sign-in is off at the moment.** `Auth:Disabled` is `true` in
`Backend/appsettings.Development.json`. In that mode:
- every request runs as a system administrator ("shared access");
- the top bar shows a red **Sign-in off** chip.

Set it back to `false` and restart before the server is reachable by anyone you don't
trust.

---

## The Bridge RFI Tracker

The tracker began as a standalone claude.ai artifact and now runs inside 3D-DMS as a
module. All of its logic is deterministic JavaScript in `Frontend/src/modules/bridgeTracker/`.

### The four uploads

Each upload goes through the tracker's own **Upload** dialog (toolbar → upload). It is stored
per package by `BridgeTrackerController`, and every viewer of the package sees the same files.

| Upload | Content | How often | Stored as |
|---|---|---|---|
| **IFC model** | Revit IFC export of one or more whole modules (5 piers each) | When the model is revised | `.ifc`, current one replaces the last |
| **Mapping register** | Workbook with sheet `Element_Register`: `Element_Key`, `IFC_GlobalId` (+ optional metadata) | When the model changes | `.xlsx`, replaces the last |
| **Monthly IPC workbook** | The IPC measurement workbook; only sheet `Schedule 4` is read | **Every month** | `.xlsx`, kept as history; the newest becomes current |
| **Alignment** | KMZ or KML; the longest line is taken as the alignment, the rest as context | Once | Reduced in the browser to a JSON local frame (~1 MB) |

After an upload the server says which file is current. All four are re-read on every
visit, and cached by hash.

### From a Schedule 4 row to an element

Every Schedule 4 row is turned into an **element key** from its BOQ item code and its
column J text. The grammar is in `keys.js`:

| Site text (column J) | Item | Key |
|---|---|---|
| `P22 - Well Curb` | 402.a | `P22-WELL-L00` |
| `P22 - 7th Lift` | 402.a | `P22-WELL-L07` |
| `P26 - Bottom Plugging` / `P26 - Well Cap` | 402.b / 402.c | `P26-WELL-PLUG` / `P26-WELL-CAP` |
| `P8 - Lower Pylon - Starter` / `- 3rd Lift` | 403.a | `P8-LPYL-L00` / `P8-LPYL-L03` |
| `P8 - Pier Table` | 404.a | `P8-PT` |
| `P17-BP-S09a-O©` | 406–409 | `P17-BP-S09a-O` (© = stay-cable anchor segment) |

How the segment IDs are built:
- **Pier:** the segment hangs from the pier named first.
- **Arm:** `KS` faces lower pier numbers (Palashbari end), `BP` faces higher.
- **`S09`:** the segment number counted outward from the pier.
- **`a`:** marks the side-span arm of an outer pylon.
- **Family:** `E` (EJ pier), `O` (outer pylon, 34 segments per arm) or `M` (middle pylon, 18 per arm).
- **Layout:** the bridge is P6–P30 in six repeating EJ–Outer–Middle–Outer–EJ modules,
  giving **1,116 segments**, 372 of them cable-anchor segments.
- **Replacement wells:** P12 and P14 toppled, and their replacements are keyed `P12(A)` and
  `P14(N)` (`model.unitAlias` in Settings).

The BOQ codes give each element a **lifecycle stage**:

| Codes | Stage |
|---|---|
| 401.a / 401.b / 401.c | Cutting edge fabricated / placed / shutter & scaffold |
| 402.a | Well lift cast & sunk |
| 402.b, 402.c, 403.a, 404.a, 405.a | Plug / cap / lower pylon / pier table / upper pylon cast |
| 406.a (+ 407.c, 408.c) | Segment cast in yard |
| 406.b → 407.d → 408.d → 407.e → 409.a → 409.b → 409.c | Erected → stressed → stay stressed → grouted → deck complete → stay final → continuity PT |

Negative rows without RFIs are treated as **reversals**. An element whose net quantity
returns to zero is shown as reversed.

### What the engine flags (`engine.js`)

**RFI not raised.** Later work is billed, so the element must exist, yet it has no RFI.
Each rule can be switched off in Settings.

| Rule | Logic |
|---|---|
| R1 | Well lift *n* has an RFI ⇒ lifts 0…*n*−1 must have one |
| R2 | Bottom plug has an RFI ⇒ every modelled lift of that well must |
| R3 | Well cap ⇒ bottom plug |
| R4 | Lower-pylon lift *n* ⇒ lifts below it and the well cap |
| R5 | Well curb ⇒ cutting edge 401.b and 401.c |
| R6 | Segment casting runs are match-cast in order (O: S1–8, 9–21, 22–34; M: 1–7, 8–18; E: 1–6) |
| R7 | An erected segment needs its twin on the other arm, all earlier segments on both arms, its 406.a and the pier table |
| R8 | 407.d / 407.e / 408.d / 409.a / 409.b / 409.c need 406.b of the same segment |
| R9 | A pier table needs the lower pylon at full height (E/M 21.624 m, O 21.324 m) and the well cap |

**Data checks**, by severity:

| Code | Check |
|---|---|
| H1 | Negative quantity on a row that carries RFIs (usually a broken formula) |
| H2 | Row outside its item block's *Cumulative paid upto this Bill* SUM range, so it isn't billed |
| H3 | One element's full RFI chain also quoted on another element |
| H4 | New work booked on a written-off unit (P12/P14 after 30 Nov 2025) |
| M1 | Quantity formula pointing at another element's row (the sheet was re-sorted) |
| M2 | One RFI number used at different piers |
| M3 | RFI dated in the future |
| M4 | RFI date far from its numbering neighbours (likely typo) |
| M5 | RFI dated long after the bulk of its IPC |
| M6 | Cable-anchor segment billed without 408.c |
| M7 | Well steining billed deeper than design (E 50.55 m, M/O 54.05 m) |
| L1 | RFI count ≠ date count; date text not readable |
| L2 | Segment with fewer than 3 RFIs (MB → Sur → MB) |
| L3 | Well lift with every RFI on the same day |
| L4 | Segment ID not one of the 1,116 |
| I1 / I2 | Next lift started before the previous closed / survey RFI shared by two lifts |

All thresholds are editable in **Settings → Edit rule and check parameters**.

**What IPC‑34 shows today** (as of 8 Oct 2026):
- 1,152 rows, 1,094 elements, 11 unlinked rows.
- **2 RFIs not raised:** `P25-BP-S04a-O` and `P15-BP-S09-O`.
- **350 data issues:** 8 High, 36 Medium, 251 Low, 55 Info.
- 496 segments cast in yard, of 1,116.
- 520 well lifts cast and sunk, 1,307.03 m net steining.

The M1/H2 findings show the workbook was re-sorted after its reversal formulas were
written. As a result, 15 of the 16 toppled-well reversals no longer cancel, which
over-measures well steining by about 17.56 m.

### Linking the model (`automap.js`, `plan.js`)

Each model element gets its key from the first of these that has one:
1. the **register** (by IFC GlobalId);
2. an IFC property (`RFI_Tracker.RFI_Key`, configurable);
3. the **geometry**.

The geometry step is a port of the original `map_register.ps1` script and runs on every load:
- well caps, in order along the bridge, give the piers;
- well lifts are ranked by level within each pier (**provisional**: the model slices every
  well evenly, while the RFIs record the lifts as cast);
- deck slabs are split into cantilever arms at gaps over 1 m, and numbered outward from their pier.

On the rar's original model it reproduces the register exactly (289/289). On
`Bridge plb 2.ifc` it keys **557 of 791 elements**, with 0 disagreements with the register.
The 234 unkeyed elements are 124 stay cables, 94 lower-pylon pieces, 6 upper-pylon pieces
and 10 context elements. Each has its reason listed under Issues → Mapping coverage.

**Pier numbering** (Settings → *Piers in this IFC*):
- **Where it starts:** the register's numbering.
- **When that's wrong:** the register numbers `Bridge plb 2.ifc` as P26–P34, past the end of
  the bridge. The tracker then draws the model at the nearest whole-module run inside it,
  **P22–P30**, and labels this as an assumption in Settings, Issues and the Dashboard.
- **Choices:** any whole-module position (P6–P14 … P22–P30), each also available "numbered
  the other way".

**Drawing the whole bridge:**
- **Copies:** modules the IFC doesn't contain are drawn as copies of one modelled module,
  renumbered 4 piers per module. Settings → Model copies chooses which modules to draw.
- **Placement:** each module is fitted on its own five piers to the alignment, by chainage
  (P6 at ch 5,425 m, spans 135 / 165 / 165 / 135 m). The Revit model is straight while
  the crossing curves, so piers sit within about 10 m of the alignment.
- **EJ piers:** an EJ pier shared by two modules is drawn once.
- **Off-model elements:** "RFI not raised" elements that aren't in the model are drawn as red
  stand-in blocks.

### The tracker screen

| Part | What it does |
|---|---|
| Top bar | IPC picker (history), period and uploader, summary chips, search by element key or RFI number |
| Legend | Built · Cast in yard · Not yet · **RFI not raised** · Data issue (amber outline) · Reversed · No model element · No key; colour by stage, IPC or date |
| Toolbar | Home, orbit/pan, fit, section box, measure, model tree, properties, filters, issues, **4D replay** (by RFI date, or "new in this IPC"), upload, export, settings |
| Properties | Everything Schedule 4 says about the selected element: rows, quantities, RFI chain with dates, bill, stage, issues |
| Exports | **Element register** (.xlsx with Summary, Elements, RFI log and Issues sheets), **issues** (.csv), **screenshot** (.png) |
| Settings | Display, model link, **piers in this IFC**, model copies and map, rules on/off, parameters (JSON), acceptance tests |

### Tracker figures elsewhere in 3D-DMS

- **Where they appear:** the Dashboard, the top-bar chips (`IPC - 34`, `2 not raised`,
  `8 high`) and the sidebar status lines.
- **Same numbers as the legend:** they are computed by the same code (`plan.js` +
  `engine.js`), so they always match.
- **When the tracker is open:** it publishes its figures directly.
- **When it isn't:** the Dashboard computes them from the stored files, and only when a file
  or a relevant setting has changed (`summary.js`, `computeSummary.js`, `useTrackerSummary.js`).

### Module files

| File | Role |
|---|---|
| `BridgeTracker.jsx` | React host: mounts the tracker per package and tears it down cleanly (WebGL contexts, listeners, timers) |
| `app.js` | The tracker application (UI, scene building, uploads, settings), wrapped as `mountTracker(root, { store })` |
| `markup.js`, `tracker.css` | Its page markup and styles, scoped under `.bt-root` |
| `backendStore.js` | Storage adapter to the 3D-DMS API (replaces the artifact's store) |
| `ipc.js`, `register.js`, `kml.js`, `ifc.js` | Parsers: Schedule 4, Element_Register, KMZ/KML, IFC (STEP → three.js geometry) |
| `keys.js`, `engine.js` | Key grammar and stages; rules, checks and visual states |
| `automap.js`, `plan.js` | Geometry keys, pier numbering, module copies, the link |
| `viewer.js`, `exporter.js` | three.js viewer (view cube, section box, measuring) and exports |
| `summary.js`, `summaryStore.js`, `computeSummary.js`, `useTrackerSummary.js` | Figures shared with the rest of 3D-DMS |
| `selftest.js` | The acceptance tests shown in Settings |
| `constants.js` | Module identifier and the screens a tracker package hides |

---

## Road packages (the original RoadBIM features)

The three road packages in Palashbari Project (`main`, `r50-1`, `pkg-tunnel`) keep every
original screen:

| Screen | What it does |
|---|---|
| **Dashboard** | KPI cards, chainage heatmap, 3D view, 4D timeline, EVM analytics |
| **3D Digital Twin** | Uploaded IFC parsed in the browser with **web-ifc**, drawn with three.js. Progress rows are bound to IFC elements by the resolver (`ifcResolver.js`), coloured by status. Layer explorer, cross-section, inspector |
| **Plan & GIS** | Leaflet plan map of every package's modelled layers, placed by the IFC's site georeference |
| **Inspections / Raise RFI** | RFI register and workflow: **draft → submitted → inspected → approved / rejected** (or cancelled). Numbered per project, inspections with photos, due dates from the package's notice period |
| **Site Reality** | 360° capture viewer with hotspots |
| **Analytics** | EVM (PV, EV, AC, CPI, SPI) |
| **Data Import** | Import wizard. **Road mode:** an IFC plus four workbooks (CHAINAGES, LAYERS, PROGRESS, METRICS), validated and reconciled before commit. **Bridge mode:** one register workbook coloured by Approval (the older one-sheet bridge path; retired on tracker packages) |

Other features:
- **Executive PDF export** at the bottom of the sidebar.
- **Ask the assistant:** a chat box that returns **hard-coded replies about the old 100 km
  highway demo** (delays, completion, cost), chosen by keywords in the question. It is
  not an AI model, and it doesn't read any project data or call the back end. The back
  end's `POST /api/aiquery/ask` is a separate keyword matcher that the screen doesn't use.

---

## Back end

### Stack

| Package | Version | Purpose |
|---|---|---|
| .NET | 8.0 | Web API |
| Npgsql.EntityFrameworkCore.PostgreSQL | 8.0.11 | EF Core 8 on PostgreSQL |
| Microsoft.AspNetCore.Authentication.JwtBearer | 8.0.11 | JWT sign-in |
| BCrypt.Net-Next | 4.0.3 | Password hashing |
| ClosedXML | 0.102.1 | Legacy Excel upload |
| Swashbuckle.AspNetCore | 6.5.0 | Swagger UI |

### Configuration (`appsettings.json` / `appsettings.Development.json`)

| Key | Default | Meaning |
|---|---|---|
| `ConnectionStrings:DefaultConnection` | `Host=localhost;Database=roadbimtwindb;…` | PostgreSQL connection |
| `Auth:Disabled` | `false` (**`true` in Development now**) | Shared access: everyone is a system administrator |
| `Jwt:Issuer` / `Jwt:Audience` | `roadbim` / `roadbim-client` | Token claims (unchanged by the rename, so existing tokens stay valid) |
| `Jwt:SigningKey` | — | Required outside Development; a throw-away key is generated in Development if missing |
| `Jwt:AccessTokenMinutes` | 480 | Session length |
| `Cors:AllowedOrigins` | localhost:3000/4173/5173 | Direct browser origins (the Vite proxy makes CORS unnecessary) |
| `Storage:IfcRoot` | `Storage/ifc` | Road IFC models, per **project** id |
| `Storage:ImportRoot` | `Storage/imports` | Archived road and bridge-register workbooks, per **package** id |
| `Storage:BridgeTrackerRoot` | `Storage/bridge-tracker` | Tracker uploads, per **package** id |
| `Storage:RfiPhotoRoot` | `Storage/rfi-photos` | Inspection photos, per **RFI** id |

### API reference

Everything below requires a session, or shared access while sign-in is off. Package routes
accept a numeric id or `project-code/package-code` (e.g. `road-50/001`). A package or project
you can't see returns 404, never 403.

| Area | Endpoints |
|---|---|
| Auth | `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/change-password` |
| Projects | `GET/POST /api/projects`, `GET/PATCH /api/projects/{code}`, members `GET/POST/DELETE /api/projects/{code}/members[/{userId}]`, `GET …/chainages`, `…/layers`, `…/progress` |
| Packages | `GET/POST /api/projects/{code}/packages`, `GET/PATCH/DELETE /api/packages/{pkg}`, `GET …/chainages`, `…/layers`, `…/progress` |
| IFC models | `POST/GET /api/packages/{pkg}/ifc-models`, `GET /api/projects/{code}/ifc-models`, `GET /api/ifc-models/{id}/file`, `…/elements`, `…/groups`, `…/layers`, `…/segments` |
| Road imports | `POST/GET /api/packages/{pkg}/imports`, `GET /api/projects/{code}/imports`, `GET /api/imports/{batchId}`, `…/issues` |
| Bindings | `GET/PUT /api/projects/{code}/bindings`, `PUT /api/progress/{id}` |
| RFIs | `GET /api/packages/{pkg}/rfi-form-options`, `POST /api/packages/{pkg}/rfis`, `GET /api/projects/{code}/rfis`, `GET /api/rfis/{id}`, `POST /api/rfis/{id}/submit`, `…/assign`, `…/cancel` |
| Inspections | `POST/GET /api/rfis/{id}/inspections`, `POST /api/rfis/{id}/decide`, `GET /api/rfi-photos/{attachmentId}` |
| Bridge register (one-sheet) | `GET /api/packages/{pkg}/bridge-items`, `POST /api/packages/{pkg}/bridge-imports` |
| **Bridge tracker** | `GET /api/packages/{pkg}/bridge-tracker` (current files, IPC history, active IPC, settings) · `POST …/bridge-tracker/files` (multipart `kind` = `ifc` \| `register` \| `ipc` \| `alignment`, `file`, optional `bill`, `period`; 64 MB) · `GET /api/bridge-tracker/files/{id}/content` (content-addressed, ETag/304) · `PUT …/bridge-tracker/config` · `PUT …/bridge-tracker/active-ipc` |
| Legacy (pre-project) | `GET /api/roadprogress`, `…/layers`, `…/chainage-layers/{km}`, `PUT /api/roadprogress/{id}`, `POST …/chainage-layers/update`, `GET /api/analytics/executive-summary`, `GET/POST /api/sitehotspots`, `POST /api/excelimport/upload`, `POST /api/aiquery/ask` |

How the tracker endpoints behave:
- **Package type:** they only answer for packages whose module is `palashbari-tracker`;
  anything else gets 409.
- **File checks:** uploads are checked by content (`ISO-10303-21` for IFC, zip for xlsx,
  JSON with an `align` line for the alignment), and wrong kinds are refused before storing.
- **Duplicates:** the same bytes uploaded again as the same kind are recognised
  (`alreadyStored: true`), and that file is made current again.

### Data model

| Area | Tables |
|---|---|
| Identity & tenancy | `Users`, `Projects`, `ProjectMembers`, `Packages` (`Module` column) |
| Road data | `RoadChainages`, `RoadLayers`, `LayerProgress` (soft-retired with `SupersededAt`), `ProjectMetrics`, `SiteHotspots` |
| IFC | `IfcModels` (one active per package), `IfcElements`, `IfcGroups`, `IfcGroupMembers`, `IfcSegments`, `IfcModelLayers`, `ProgressIfcBindings` |
| Imports | `ImportBatches`, `ImportBatchFiles`, `ImportIssues` |
| RFIs | `Rfis`, `RfiEvents`, `RfiInspections`, `RfiAttachments`, `NumberSeries` |
| Bridges | `BridgeItems` (one-sheet register), `BridgeTrackerFiles`, `BridgeTrackerConfigs` |

Every row belongs to a project and a package, and deleting a project cascades. Migrations
are in `Backend/Migrations` (latest: `20261008072525_BridgeTracker`).

### Storage on disk

```text
Backend/Storage/
  ifc/{projectId}/{sha256}.ifc                  road IFC models
  imports/{packageId}/{sha256}.xlsx             archived workbooks
  bridge-tracker/{packageId}/{sha256}.{ifc|xlsx|json}
  rfi-photos/{rfiId}/…                          inspection photos
```

The database stores each file's path and hash, never its bytes.

### Seed data and legacy endpoints

- **Seeder:** `DatabaseSeeder` fills the old 100 km demo corridor only if a project with
  code `default` exists. It never creates that project; the demo project was deleted on purpose.
- **Legacy endpoints:** these predate projects and are pinned to that demo project by
  `LegacyScope`. With it gone they read nothing and write nothing.
- **Built-in fallbacks:** `GET /api/roadprogress` and `GET /api/analytics/executive-summary`
  still return built-in demo figures (100 km, 60.4 %) when they find no data (see Known issues).

---

## Front end

| Package | Purpose |
|---|---|
| React 18, Vite 5 | App and dev server/bundler |
| Tailwind CSS 3 | Styling (plus the design tokens in `src/index.css`) |
| three 0.160 | 3D (road viewer and tracker viewer) |
| web-ifc 0.0.77 | IFC parsing for road packages (WASM, copied to `public/wasm` on install) |
| xlsx 0.18.5 | Reading Excel in the browser |
| exceljs 4.4 | Formatted Excel export from the tracker (loaded only on export) |
| Leaflet 1.9 | Plan & GIS map |
| Chart.js / react-chartjs-2 | Analytics charts |
| jsPDF, jspdf-autotable, html2canvas | Executive PDF |
| lucide-react | Icons |

**State**
- **`AuthContext`:** session, projects, the active project and package (remembered in
  `localStorage` as `roadbim.projectCode` / `roadbim.packageId`).
- **`RoadDataContext`:** the active package's road data, IFC summary, resolver and dashboard metrics.
- **The tracker:** keeps its own state inside its module.

**Loading.** The tracker is code-split. It loads on first use as a ~105 KB chunk plus a
shared parser chunk, and ExcelJS (~940 KB) loads only when someone exports.

**Scripts** (`Frontend/package.json`)

| Script | Does |
|---|---|
| `npm run dev` | Dev server on :3000 with `/api` proxied to :5000 |
| `npm run build` / `npm run preview` | Production build / serve it |
| `npm run share` / `npm run share:preview` | Same, tunnel-friendly (ngrok hosts allowed, HMR off) |
| `npm run share:tunnel` | `ngrok http 3000` |
| `npm run test:bridge` | Tracker test suite |
| `npm run test:bridge:api` | Read-only smoke test of a running back end |

---

## Testing

```bash
cd Frontend
npm run test:bridge                                    # 14 tests, ~2 s, no server needed
npm run test:bridge:api                                # against http://localhost:5000, package 11
API_BASE=http://host:port PACKAGE_ID=11 npm run test:bridge:api
API_TOKEN=<jwt> npm run test:bridge:api                # when sign-in is on
```

**`test:bridge`** (`tests/bridge/`) runs the tracker against the real project files in
`tests/fixtures/bridge/` (IPC‑34, the register, the KMZ, the original one-module model and
`Bridge plb 2.ifc`; 7.6 MB). It checks:
- Schedule 4 parsing;
- the key grammar;
- what IPC‑34 says has been built;
- the 2 RFIs not raised;
- all 350 issues by severity and code;
- the geometry mapper against the register;
- pier numbering in both directions;
- all six modules (25 caps, 1,104 segments, nothing drawn twice);
- the Dashboard/legend counts;
- the summary signature and settings merge;
- the alignment.

Issue counts are pinned to 8 Oct 2026, because the "future date" check depends on today's date.

The tracker's own acceptance tests (Settings) show **21/26**. Five expectations were written
against an earlier sort of the IPC‑34 sheet. The suite pins those five as known, so any other
change fails it.

**`test:bridge:api`** (`tests/bridge-api/`) reads only. It checks that every current tracker
file downloads byte for byte, that caching returns 304, and that road packages are refused.

---

## Sharing with the team over ngrok

```bash
# terminal 1
cd Backend  && dotnet run
# terminal 2
cd Frontend && npm run share          # or: npm run build && npm run share:preview (faster for viewers)
# terminal 3
ngrok http 3000
```

- **One tunnel is enough:** the page and the API share one origin through the Vite proxy.
- **Allowed hosts:** share mode admits `*.ngrok-free.app`, `*.ngrok-free.dev`, `*.ngrok.io`
  and `*.ngrok.app`, and refuses other hosts (403).
- **More detail:** [docs/SHARING_WITH_NGROK.md](docs/SHARING_WITH_NGROK.md).
- **Who can get in:** with `Auth:Disabled` on, anyone with the tunnel URL has full access.

---

## Operations: backups, restore, migrations

**Back up**

```bash
"C:/Program Files/PostgreSQL/18/bin/pg_dump.exe" -h localhost -U postgres -d roadbimtwindb -Fc -f roadbimtwindb.dump
# and copy Backend/Storage/ — the database holds paths, not file contents
```

**Restore**

```bash
"C:/Program Files/PostgreSQL/18/bin/pg_restore.exe" -h localhost -U postgres -d roadbimtwindb --clean --if-exists roadbimtwindb.dump
```

`Backups/2026-10-08-before-deleting-8-projects/` holds two things from before the eight other
projects were deleted:
- the full database dump;
- copies of their files on disk (`files/`), with lists of what was removed.

Delete this folder once it is no longer wanted.

**Adding a migration**

```bash
cd Backend
dotnet ef migrations add <Name> --configuration Release   # Release avoids the locked Debug exe while the app runs
```

It is applied automatically on the next start.

**Restart after back-end changes.** The running server keeps the old code until it is restarted.

---

## Known issues and open decisions

| # | Item | Status |
|---|---|---|
| 1 | **Which piers does `Bridge plb 2.ifc` cover?** Drawn as P22–P30 by assumption | Needs the modeller's answer → Settings → *Piers in this IFC* |
| 2 | Five acceptance-test expectations predate a re-sort of IPC‑34 | Decide whether to update them to the workbook as uploaded |
| 3 | **Sign-in is off** (`Auth:Disabled: true`) | Turn back on when sharing ends |
| 4 | Package `main`'s IFC record points at a missing `C:\Users\…\Documents\…` path, which is the source of the 404 on `/api/ifc-models/7/file` | The same file is in `Storage/ifc/8`; repoint the record |
| 5 | Legacy endpoints return built-in demo figures when empty (road progress, analytics) | Remove the fallbacks if the road screens should show "no data" |
| 6 | The tracker keeps its own light colour scheme inside the dark app | Restyle to the app's tokens if wanted |
| 7 | 001 · Bridge still has 38 rows from the retired one-sheet register (unread) | Keep as history or delete |
| 8 | 234 model elements have no key (124 cables, 94 lower-pylon pieces, 6 upper-pylon pieces, 10 context) | Lower and upper pylons need re-splitting in Revit to match the RFI lifts |
| 9 | Straight Revit modules on a curved alignment: piers sit within ~10 m of their chainage | Inherent to rigid module placement |
| 10 | `npm audit`: `xlsx` (high), `jspdf` (critical), `jspdf-autotable`, `dompurify` (via jspdf), `uuid` (via exceljs) | Review before production |
| 11 | `Backups/` and `Backend/Storage/` are not in `.gitignore`; the database password and JWT key sit in `appsettings*.json` | Ignore them and move secrets to user-secrets/environment before pushing |
| 12 | **Ask the assistant** returns hard-coded 100 km highway answers, including on 001 · Bridge | Hide it on tracker packages, or remove it |
| 13 | `Project_Documentation.md` and older `docs/` describe the original 100 km road prototype | Historical reference |

---

## Change history

| Date | Change |
|---|---|
| Aug 2026 | RoadBIM prototype: procedural 100 km road, then PostgreSQL persistence, projects and packages, IFC upload with web-ifc, the four-workbook import wizard, RFI workflow with inspections |
| 15 Sep 2026 | One-sheet bridge register import (Approval → green/red) and register detail in the 3D inspector |
| 8 Oct 2026 | **Bridge RFI Tracker** integrated from the Palashbari artifact. **Phase 0:** tracker storage API and `Package.Module`. **Phase 1:** tracker mounted in the app. **Phase 2:** geometry mapper, multi-module IFCs, pier numbering, per-module placement. **Phase 3:** Dashboard, top bar and sidebar fed by the tracker; one-sheet register retired on tracker packages. **Phase 4:** test suites and share-mode verification |
| 8 Oct 2026 | Tracker package shows only Bridge RFI Tracker and Dashboard. Road_50 renamed **Palashbari Project**. Eight other projects deleted (backup kept). The demo seeder no longer recreates them. **RoadBIM renamed 3D-DMS** |

---

## Other documents

| Document | About |
|---|---|
| [docs/SHARING_WITH_NGROK.md](docs/SHARING_WITH_NGROK.md) | Sharing a build with the team |
| [docs/PHASE4_PERSISTENCE_SCHEMA.md](docs/PHASE4_PERSISTENCE_SCHEMA.md) | Original PostgreSQL schema proposal |
| [docs/IFC_EXCEL_INTEGRATION_PLAN.md](docs/IFC_EXCEL_INTEGRATION_PLAN.md) | How road workbooks bind to IFC elements |
| [docs/IFC_LAYERPROGRESS_MATCH_REPORT.md](docs/IFC_LAYERPROGRESS_MATCH_REPORT.md) | Match report for the sample road IFC and workbook |
| [Project_Documentation.md](Project_Documentation.md) | Architecture write-up of the original 100 km road prototype (out of date) |
