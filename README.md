# Road BIM Digital Twin Documentation

## 1. Project Overview

This project is a web-based Road BIM Digital Twin for highway infrastructure monitoring. It combines a React frontend, an ASP.NET Core backend, and a database-backed analytics layer to visualize a 100 km highway corridor in 2D, 3D, and timeline-based views.

The application is designed to help stakeholders review:
- road construction progress by kilometer
- layer-by-layer pavement status
- EVM cost and variance analytics
- Excel-based data ingestion
- AI-assisted project queries

---

## 2. What This Project Does

The application provides the following major capabilities:

### Executive dashboard
- KPI summary cards
- progress heatmap by chainage
- 3D BIM-style highway visualization
- 4D timeline/scrubber view
- analytics and cost reporting

### 2D GIS view
- satellite-style map view
- corridor alignment visualization
- chainage station markers
- click-to-focus interaction with the 3D scene

### 3D BIM-like view
- procedural road corridor generation
- kilometer sections and pavement layers
- color-coded progress states
- hover and click inspection
- layer visibility and isolation controls

### Backend services
- REST API endpoints for analytics and road progress
- Excel import processing
- AI query service integration
- Swagger API documentation

---

## 3. Technology Stack

### Frontend
- React 18
- Vite
- Tailwind CSS
- Three.js for 3D rendering
- Leaflet for 2D GIS mapping
- Chart.js + react-chartjs-2 for charts
- xlsx for Excel handling
- jspdf + html2canvas for export/report generation

### Backend
- ASP.NET Core Web API
- Entity Framework Core
- SQL Server (with in-memory fallback for local/dev use)
- Swagger / Swagger UI

### Project structure
- Frontend: React app and UI components
- Backend: ASP.NET Core API, services, controllers, EF Core models
- Database: SQL schema and seeding logic

---

## 4. Frontend Architecture

### Main UI entry points
- App.jsx: main app shell
- ExecutiveDashboardView.jsx: dashboard layout container
- RoadBIMViewer.jsx: 3D visualization component
- GISMapViewer.jsx: 2D GIS viewer component
- TimelineScrubber.jsx: timeline-based construction simulation
- AnalyticsSection.jsx: analytics and reporting UI

### State management
The app uses a React context provider:
- Frontend/src/context/RoadDataContext.jsx

This context manages shared state such as:
- selected kilometer section
- active layer filter
- timeline slice state
- 3D view interaction state

---

## 5. Backend Architecture

### ASP.NET Core API
The backend is initialized in Backend/Program.cs.

It provides:
- CORS support for the React frontend
- Swagger documentation support
- Entity Framework Core configuration
- dependency injection registration for services
- automatic database creation and seeding

### Main backend services
- EVMAnalyticsService: cost and variance analytics
- ExcelParserService: handling Excel import data
- AIQueryService: AI-style querying workflow

### API controllers
- AIQueryController
- AnalyticsController
- ExcelImportController
- RoadProgressController
- SiteHotspotsController

---

## 6. Libraries and Tools Used in Detail

### React
React is used to build the user interface as a component-based single-page application.
It powers the executive dashboard, sidebar navigation, modal dialogs, and interactive visual components.

### Vite
Vite is the frontend build tool and development server.
It provides:
- fast hot module replacement
- quick development startup
- optimized production build output

### Tailwind CSS
Tailwind CSS is used for styling the dashboard and panels.
It provides utility-based responsive styles without requiring a large custom CSS framework.

### Three.js
Three.js is the core library used to create the 3D view.
It is responsible for:
- creating the scene
- adding camera and lighting
- generating 3D geometry
- rendering the highway corridor as a WebGL canvas
- handling mouse-based selection and hover interaction

### Leaflet
Leaflet is used to render the 2D GIS map.
It displays a satellite-style map layer and overlays a polyline corridor plus chainage markers.

### Chart.js and react-chartjs-2
These libraries are used to render charts and visual analytics in the dashboard.

### xlsx
The xlsx library is used for reading Excel files and importing project data into the system.

### ASP.NET Core + EF Core
The backend API is built with ASP.NET Core, and Entity Framework Core is used to work with data models and database persistence.

### Swagger
Swagger is used to expose and test the API endpoints from the backend.

---

## 7. How the 3D View Works

The 3D view is created in the component [Frontend/src/components/Viewer3D/RoadBIMViewer.jsx](Frontend/src/components/Viewer3D/RoadBIMViewer.jsx).

### Step-by-step rendering flow

1. The React component mounts a canvas container.
2. A Three.js Scene is created.
3. A PerspectiveCamera is initialized with a view angle and position.
4. A WebGLRenderer is created to draw the scene into the browser canvas.
5. OrbitControls are attached so users can rotate, zoom, and pan the 3D view.
6. Lighting is added to make the scene look realistic.
7. A procedural road model is generated using the helper in [Frontend/src/utils/roadGenerator.js](Frontend/src/utils/roadGenerator.js).
8. Each kilometer section is turned into a 3D box mesh.
9. Pavement layers are represented as stacked boxes with different heights and colors.
10. The scene is rendered continuously with a requestAnimationFrame loop.
11. Mouse interaction uses a Raycaster to detect what object the user clicked or hovered.

### How the road geometry is built

The road model is not loaded from a heavy BIM file in this version. Instead, it is procedurally generated.

The helper in [Frontend/src/utils/roadGenerator.js](Frontend/src/utils/roadGenerator.js) creates:
- one 3D box per road layer per kilometer section
- a curved corridor effect using a sine-based path
- color-coded material based on progress status
- kilometer markers as cylindrical posts

### Why Three.js is used here
Three.js is ideal because it provides:
- WebGL-based 3D rendering in the browser
- easy mesh and material creation
- camera and control support
- interaction with object picking and hover events

### What the 3D view shows
The 3D model visually communicates:
- completed, in-progress, delayed, and not-started segments
- different road layers such as subgrade, GSB, WMM, DBM, and BC
- spatial placement of the road corridor
- inspection detail when a user selects a kilometer section

---

## 8. How the 2D Map Works

The 2D GIS view is implemented in [Frontend/src/components/Map2D/GISMapViewer.jsx](Frontend/src/components/Map2D/GISMapViewer.jsx).

It uses Leaflet to:
- create a map container
- load an Esri satellite tile layer
- draw a polyline highway alignment
- place chainage markers every 10 km
- allow users to focus the 3D scene from a selected station

---

## 9. Data Flow

1. User uploads an Excel file or interacts with the dashboard.
2. The frontend sends data to backend controllers.
3. Backend services process the information.
4. The database stores or references the project data.
5. The UI reads the processed data and updates dashboards and 3D visuals.

---

## 10. Setup and Run

### Frontend
```bash
cd Frontend
npm install
npm run dev
```

### Backend
```bash
cd Backend
dotnet restore
dotnet run
```

### API docs
Once the backend is running, Swagger UI can be accessed at:
- http://localhost:5000/swagger
- or the port shown by dotnet run

---

## 11. Architecture Diagram

```text
User Browser
  ├─ React UI
  │   ├─ Executive Dashboard
  │   ├─ 3D BIM Viewer (Three.js)
  │   ├─ 2D GIS Viewer (Leaflet)
  │   └─ Reports / Charts / Excel Import
  │
  ├─ Context State
  │   └─ RoadDataContext
  │
  └─ API Calls
      └─ ASP.NET Core Backend
          ├─ Controllers
          ├─ Services
          └─ EF Core / SQL Database
```

### Visual layer breakdown
- Frontend layer: React components and visual interfaces
- Rendering layer: Three.js for 3D, Leaflet for 2D maps
- Data layer: backend services and database-backed analytics
- Integration layer: Excel import, AI query service, reporting exports

---

## 12. Summary

This project is a modern digital twin prototype for highway infrastructure management.

It uses:
- React + Vite for the frontend experience
- Tailwind CSS for styling
- Three.js for the 3D highway visualization
- Leaflet for the 2D GIS map
- ASP.NET Core + EF Core for the backend
- Swagger for API documentation

The most important visualization library in this project is Three.js, because it powers the interactive 3D view that displays the road corridor and its construction progress.
