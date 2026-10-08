# Road BIM Digital Twin — System Architecture & Integration Guide

> **Document Type:** Project Documentation & Architecture Overview  
> **Written For:** Stakeholders, Project Managers, Engineers, and Developers  
> **Target System:** 4D/5D Road BIM Digital Twin Platform (100 KM Highway Corridor)  

---

## 1. Executive Summary

This project is a web-based **Digital Twin for Highway Infrastructure Monitoring**. It provides real-time tracking of a 100 kilometer road construction project by combining a **2D satellite map**, an **interactive 3D road model**, and a **data-driven backend**.

Instead of relying on heavy offline CAD software or static PDF site updates, project managers can open a browser to:
- View the entire 100 KM highway corridor on satellite imagery.
- Zoom into any 1 KM section to inspect sub-surface pavement layers (soil foundation up to asphalt surface).
- Track project progress, budget vs. actual costs, and construction delays.
- Upload Excel progress sheets to update the live system automatically.

---

## 2. System Architecture Overview

The system is organized into three clean layers:

```
┌────────────────────────────────────────────────────────────────────────┐
│                          FRONTEND (Client)                             │
│ React 18 + Vite | Tailwind CSS | Three.js (3D) | Leaflet (2D Maps)    │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ HTTP / REST API Calls
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                          BACKEND (Server)                              │
│ ASP.NET Core C# Web API | REST Controllers | Entity Framework Core     │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Database Queries & Stored Procedures
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                         DATABASE (Storage)                             │
│ Microsoft SQL Server | 4 Primary Core Tables | Asset & Progress Cache │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Frontend Architecture

The **Frontend** is what users see and interact with in their web browser. It is built as a single-page web application that renders dashboards, maps, and 3D scenes quickly without needing page reloads.

### Core Frontend Stack
* **JavaScript (React 18 & JSX):** The main coding language and framework used to build interactive UI components (buttons, panels, cards, and modal popups).
* **Vite:** The modern build tool and development server that compiles JavaScript files and serves the web application instantly.
* **Tailwind CSS:** Used for all visual styling, layout grids, dark mode themes, and glassmorphism panel designs.

### Primary UI Components
1. **Executive Dashboard (`App.jsx`, `ExecutiveKPICards.jsx`):** Displays key project metrics like total kilometers completed, cost variance, schedule index, and progress heatmaps.
2. **2D GIS Map Viewer (`GISMapViewer.jsx`):** Displays the 100 KM corridor over Google Earth HD Satellite or CartoDB satellite tiles.
3. **3D BIM Corridor Viewer (`RoadBIMViewer.jsx`):** Renders a dynamic, 3D WebGL model of the road with color-coded construction statuses and individual pavement layers.
4. **360° Reality & Street View (`MatterportViewer.jsx`):** Embeds Google Street View, Google Earth 3D views, and photo hotspot logs.

---

## 4. Backend Architecture

The **Backend** acts as the engine of the application. It receives requests from the frontend, handles business logic (like computing cost variances or parsing Excel files), and communicates securely with the SQL database.

### Core Backend Stack
* **C# (.NET 8 / ASP.NET Core Web API):** The primary server-side language and framework used to write secure, scalable RESTful web APIs.
* **Entity Framework Core (EF Core):** An Object-Relational Mapper (ORM) that allows C# code to read and write database records without writing manual SQL queries everywhere.
* **Swagger UI (Swashbuckle):** Provides an interactive web browser dashboard at `/swagger` to inspect and test all backend API endpoints.

### Main Backend Services & API Controllers
* **`RoadProgressController`:** Handles requests to fetch section-by-section construction progress and update layer data.
* **`AnalyticsController` & `EVMAnalyticsService`:** Computes Earned Value Management (EVM) metrics such as SPI (Schedule Performance Index), CPI (Cost Performance Index), and cost variances.
* **`ExcelImportController` & `ExcelParserService`:** Receives uploaded `.xlsx` spreadsheets, parses rows, and syncs progress directly into the database.
* **`SiteHotspotsController`:** Manages geo-tagged site photos, drone inspection records, and quality audit flags.
* **`AIQueryController` & `AIQueryService`:** Processes natural language queries about project status and returns automated summary responses.

---

## 5. Database Design & 4 Core Tables

The database is built on **Microsoft SQL Server**. It structures the 100 KM highway corridor into logical sections, pavement layer definitions, live progress tracking, and site inspection media.

Here are the **4 main database tables** that power the system:

```
 ┌──────────────────────┐         ┌──────────────────────┐
 │   dbo.RoadChainages  │         │    dbo.RoadLayers    │
 ├──────────────────────┤         ├──────────────────────┤
 │ Id (PK)              │         │ Id (PK)              │
 │ ChainageStart        │         │ LayerName            │
 │ ChainageEnd          │         │ Code (SUB, GSB, etc) │
 │ KmLabel              │         │ ThicknessMm          │
 │ Latitude / Longitude │         │ DefaultColorHex      │
 │ Elevation            │         │ SortOrder            │
 └──────────┬───────────┘         └──────────┬───────────┘
            │                                │
            │      ┌───────────────────┐     │
            └────► │ dbo.LayerProgress │ ◄───┘
                   ├───────────────────┤
                   │ Id (PK)           │
                   │ ChainageId (FK)   │
                   │ LayerId (FK)      │
                   │ Status            │
                   │ ProgressPercent   │
                   │ Top/Base Elevation│
                   │ Budget & Actual $ │
                   └───────────────────┘

                   ┌───────────────────┐
                   │ dbo.SiteHotspots  │
                   ├───────────────────┤
                   │ Id (PK)           │
                   │ ChainageId (FK)   │
                   │ Category & Image  │
                   │ Description       │
                   └───────────────────┘
```

### Table 1: `dbo.RoadChainages`
* **What it does:** Divides the 100 KM highway corridor into 1 KM physical road segments.
* **Key fields:** `Id`, `ChainageStart` (e.g. 12.0), `ChainageEnd` (e.g. 13.0), `KmLabel` ("KM 012 - KM 013"), `Latitude`, `Longitude`, `Elevation` (ground terrain altitude in meters).
* **Why it matters:** Gives every kilometer section an exact geographical location on the map.

### Table 2: `dbo.RoadLayers`
* **What it does:** Serves as the master catalog for the standard pavement sub-surface layers.
* **Key fields:** `Id`, `LayerName` ("Bituminous Concrete", "Subgrade Earthwork"), `Code` (`BC`, `DBM`, `WMM`, `GSB`, `SUB`), `ThicknessMm` (e.g. 50mm, 500mm), `DefaultColorHex`, `SortOrder` (1=Bottom up to 5=Top surface).
* **Why it matters:** Defines the standard cross-section engineering blueprint of the road.

### Table 3: `dbo.LayerProgress`
* **What it does:** Tracks live construction progress, thickness adjustments, level elevations, and cost details for **every layer in every 1 KM section**.
* **Key fields:** `Id`, `ChainageId` (links to `RoadChainages`), `LayerId` (links to `RoadLayers`), `Status` (*Completed*, *In-Progress*, *Delayed*, *Not Started*), `ProgressPercent`, `TopLevelMeters`, `BaseLevelMeters`, `PlannedStartDate`, `PlannedEndDate`, `BudgetCost`, `ActualCost`, `CostVariance`.
* **Why it matters:** It is the central transactional table that feeds both the 3D color-coding and financial charts.

### Table 4: `dbo.SiteHotspots`
* **What it does:** Stores geo-tagged inspection photos, 360° site captures, drone logs, and quality issues linked to specific chainage points.
* **Key fields:** `Id`, `ChainageId`, `Title`, `Description`, `Category` (*Photo360*, *DroneInspection*, *QualityIssue*), `ImageUrl`, `InspectionDate`, `Status` (*Open*, *Closed*).
* **Why it matters:** Connects real-world site imagery directly to the digital model.

---

## 6. How the Map & 3D Integration Works

One of the highlights of this platform is how seamlessly the **2D GIS satellite map**, the **3D BIM corridor view**, and the **database** connect together in real time.

```
┌────────────────────────┐      ┌────────────────────────┐      ┌────────────────────────┐
│  1. USER CLICKS 2D MAP │ ───► │  2. REACT CONTEXT      │ ───► │  3. 3D BIM CAMERA      │
│  Leaflet station marker│      │  Broadcasts KM Station │      │  Three.js flies to KM  │
└────────────────────────┘      └────────────────────────┘      └────────────────────────┘
                                                                            │
                                                                            ▼
┌────────────────────────┐      ┌────────────────────────┐      ┌────────────────────────┐
│  6. 5-LAYER CROSS-     │ ◄─── │  5. SQL DATABASE       │ ◄─── │  4. BACKEND API        │
│     SECTION DRAWER     │      │  Runs EF Core query    │      │  GET /api/roadprogress │
└────────────────────────┘      └────────────────────────┘      └────────────────────────┘
```

### Simple Breakdown of Map Integration

#### Languages Used
* **JavaScript / JSX:** Powers map interactions, camera animation, and state sync on the frontend.
* **C#:** Receives coordinate/station requests on the backend and returns layer data.
* **SQL:** Fetches exact chainage and layer records from SQL Server.

#### APIs Used
* **Leaflet GIS Tile API:** Downloads satellite map tiles from Google Earth HD / CartoDB servers.
* **REST Web API (`/api/roadprogress/chainage/{km}`):** Frontend-to-backend communication protocol.
* **Google Street View / Earth Embed API:** Displays interactive 360° road imagery.

#### Libraries Used
* **Leaflet.js:** Lightweight JavaScript library used to render the 2D map, draw the curved highway line, and handle marker clicks.
* **Three.js:** Powerful WebGL 3D graphics library used to render the 3D road corridor, stacked pavement layers, and interactive mouse hover/click controls.
* **Lucide React:** Icons for map toolbars and station badges.

#### Tools Used
* **Vite:** Bundles and serves client-side map code efficiently.
* **ASP.NET Core & EF Core:** Serves data to the map via API.
* **Microsoft SQL Server:** Stores latitude/longitude coordinates and elevation data.

---

### Step-by-Step Flow: What Happens When You Click the Map

1. **User Clicks a Station on the 2D Map (Leaflet):**  
   The user opens the 2D GIS view and clicks a marker (e.g. `KM 042`). Leaflet captures the click event and reads the station's geographical coordinates (`28.5355° N, 77.3910° E`).

2. **State Updates Across the Application (React Context):**  
   The click event calls `setSelectedKmSection({ km: 42 })` inside `RoadDataContext`. This global state change alerts all components in the app that KM 42 is currently selected.

3. **3D Camera Flies to Location (Three.js WebGL):**  
   The 3D viewer component (`RoadBIMViewer.jsx`) listens to the context update. Three.js smoothly moves its camera target along the 3D corridor directly over the 3D box model representing KM 42.

4. **Frontend Requests Sub-Surface Details from Backend:**  
   The app automatically sends an API request to the backend:  
   `GET http://localhost:5000/api/roadprogress/chainage/42`

5. **Backend Queries SQL Database:**  
   The ASP.NET Core backend calls the stored procedure `sp_GetChainageLayerDetails(42.0)` or executes an EF Core query combining `RoadChainages`, `RoadLayers`, and `LayerProgress`.

6. **Interactive Sub-Surface Drawer Opens:**  
   The backend returns JSON data containing the top elevation, base elevation, and status of all 5 layers:
   - **L5 (Top): Bituminous Concrete (BC Surface)** — 50 mm (18% In-Progress, Cyan)
   - **L4: Dense Bituminous Macadam (DBM)** — 100 mm (38% Delayed, Red)
   - **L3: Wet Mix Macadam (WMM)** — 250 mm (62% In-Progress, Blue)
   - **L2: Granular Sub-Base (GSB)** — 200 mm (84% In-Progress, Light Blue)
   - **L1 (Base): Subgrade Earthwork (SUB)** — 500 mm (100% Completed, Green)

The side panel instantly opens on screen, allowing users to inspect exact thickness in millimeters, status badges, and cost variances.

---

## 7. Technology Summary Matrix

| Category | Technology / Tool | Role & Purpose in Project |
| :--- | :--- | :--- |
| **Frontend Language** | JavaScript (ES6+ / JSX) | Primary language for user interface and state logic. |
| **Frontend Framework** | React 18 + Vite | Component-based UI rendering and fast development server. |
| **Styling & Theme** | Tailwind CSS | Modern utility CSS for dark-mode dashboard cards and glassmorphism. |
| **2D Mapping Library** | Leaflet.js | Renders satellite maps, curved highway polyline, and station markers. |
| **3D Graphics Engine** | Three.js (WebGL) | Procedural 3D BIM road model, 5-layer stacked boxes, camera controls. |
| **Chart Visualization** | Chart.js / react-chartjs-2 | Visualizes SPI/CPI indices, progress bars, and cost variance graphs. |
| **Backend Language** | C# (.NET 8) | High-performance server-side language for web APIs and services. |
| **Backend Framework** | ASP.NET Core Web API | RESTful backend framework handling routing, CORS, and dependency injection. |
| **Database ORM** | Entity Framework Core (EF Core) | Maps database tables to C# models and executes queries safely. |
| **Database Engine** | Microsoft SQL Server | Relational database hosting chainages, layers, progress, and hotspots. |
| **API Documentation** | Swagger / OpenAPI | Interactive web interface for viewing and testing API endpoints. |
| **Data Ingestion** | xlsx Library & ExcelParserService | Reads uploaded Excel files and updates layer progress records automatically. |

---

## 8. Key Benefits of This System

1. **Simple & Intuitive:** Complex engineering and survey data is converted into easy-to-read visual maps and 3D models.
2. **Unified Data Source:** 2D maps, 3D BIM views, site inspection photos, and financial charts all read from the exact same database.
3. **No Heavy Software Needed:** Operates entirely within standard web browsers (Chrome, Edge, Safari, Firefox) without installing expensive desktop CAD software.
4. **Excel-Friendly:** Site engineers can continue collecting data in Excel sheets; uploading the sheet updates the 3D twin instantly.

---
*Documentation compiled for presentation and technical review.*
