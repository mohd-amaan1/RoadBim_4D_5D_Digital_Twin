-- ============================================================================
-- 4D/5D ROAD BIM DIGITAL TWIN PLATFORM - SQL SERVER DATABASE SCHEMA
-- Target Database Engine: Microsoft SQL Server 2019 / 2022 / SQL Express / Azure SQL
-- ============================================================================

IF NOT EXISTS (SELECT * FROM sys.databases WHERE name = 'RoadBimTwinDb')
BEGIN
    CREATE DATABASE RoadBimTwinDb;
END
GO

USE RoadBimTwinDb;
GO

-- Drop Existing Tables for Clean Re-run
IF OBJECT_ID('dbo.LayerProgress', 'U') IS NOT NULL DROP TABLE dbo.LayerProgress;
IF OBJECT_ID('dbo.SiteHotspots', 'U') IS NOT NULL DROP TABLE dbo.SiteHotspots;
IF OBJECT_ID('dbo.RoadLayers', 'U') IS NOT NULL DROP TABLE dbo.RoadLayers;
IF OBJECT_ID('dbo.RoadChainages', 'U') IS NOT NULL DROP TABLE dbo.RoadChainages;
IF OBJECT_ID('dbo.ProjectMetrics', 'U') IS NOT NULL DROP TABLE dbo.ProjectMetrics;
GO

-- 1. Table: RoadChainages (100 KM Alignment Broken into 1 KM Sections)
CREATE TABLE dbo.RoadChainages (
    Id INT PRIMARY KEY IDENTITY(1,1),
    ChainageStart FLOAT NOT NULL,           -- e.g. 12.0 (KM 12.000)
    ChainageEnd FLOAT NOT NULL,             -- e.g. 13.0 (KM 13.000)
    KmLabel NVARCHAR(50) NOT NULL,          -- e.g. 'KM 12.000 - KM 13.000'
    SectionName NVARCHAR(100) NOT NULL,     -- e.g. 'North Corridor Segment 13'
    Latitude FLOAT NOT NULL,                -- GIS Coordinate Start
    Longitude FLOAT NOT NULL,               -- GIS Coordinate Start
    Elevation FLOAT NOT NULL DEFAULT 120.5, -- Terrain elevation in meters
    TerrainType NVARCHAR(50) DEFAULT 'Cut & Fill'
);
GO

-- 2. Table: RoadLayers (Pavement & Sub-surface Layer Catalog)
CREATE TABLE dbo.RoadLayers (
    Id INT PRIMARY KEY IDENTITY(1,1),
    LayerName NVARCHAR(100) NOT NULL,       -- e.g. 'Subgrade', 'GSB', 'WMM', 'DBM', 'BC'
    Code NVARCHAR(20) NOT NULL UNIQUE,      -- 'SUB', 'GSB', 'WMM', 'DBM', 'BC'
    ThicknessMm INT NOT NULL,               -- Thickness in millimeters
    MaterialType NVARCHAR(100) NOT NULL,    -- e.g. 'Bituminous Concrete', 'Crushed Stone Aggregate'
    DefaultColorHex NVARCHAR(10) NOT NULL,  -- e.g. '#1E293B', '#64748B'
    SortOrder INT NOT NULL                  -- 1=Subgrade (bottom), 5=BC Surface (top)
);
GO

-- 3. Table: LayerProgress (Live Excel Import Data & 4D Progress Records)
CREATE TABLE dbo.LayerProgress (
    Id INT PRIMARY KEY IDENTITY(1,1),
    ChainageId INT NOT NULL FOREIGN KEY REFERENCES dbo.RoadChainages(Id) ON DELETE CASCADE,
    LayerId INT NOT NULL FOREIGN KEY REFERENCES dbo.RoadLayers(Id) ON DELETE CASCADE,
    Status NVARCHAR(30) NOT NULL CHECK (Status IN ('Completed', 'In-Progress', 'Delayed', 'Not Started')),
    ProgressPercent FLOAT NOT NULL CHECK (ProgressPercent >= 0 AND ProgressPercent <= 100),
    DesignThicknessMm INT NULL,                         -- Chainage-specific thickness override in mm
    TopLevelMeters FLOAT NULL,                          -- Calculated Top Elevation (RL) in meters
    BaseLevelMeters FLOAT NULL,                         -- Calculated Base Elevation (RL) in meters
    LevelColorHex NVARCHAR(20) NULL,                    -- Level-wise custom display color hex
    PlannedStartDate DATETIME2 NOT NULL,
    PlannedEndDate DATETIME2 NOT NULL,
    ActualStartDate DATETIME2 NULL,
    ActualEndDate DATETIME2 NULL,
    BudgetCost DECIMAL(18,2) NOT NULL DEFAULT 0.00,
    ActualCost DECIMAL(18,2) NOT NULL DEFAULT 0.00,
    CostVariance DECIMAL(18,2) NOT NULL DEFAULT 0.00, -- ActualCost - BudgetCost
    DelayDays INT NOT NULL DEFAULT 0,
    UpdatedBy NVARCHAR(100) DEFAULT 'System Excel Import',
    UpdatedAt DATETIME2 NOT NULL DEFAULT GETUTCDATE()
);
GO

-- 4. Table: SiteHotspots (Geo-Tagged 360° Site Photos, Drone Inspection Logs & Issues)
CREATE TABLE dbo.SiteHotspots (
    Id INT PRIMARY KEY IDENTITY(1,1),
    ChainageId INT NOT NULL FOREIGN KEY REFERENCES dbo.RoadChainages(Id),
    Title NVARCHAR(200) NOT NULL,
    Description NVARCHAR(MAX) NOT NULL,
    Category NVARCHAR(50) NOT NULL CHECK (Category IN ('Photo360', 'DroneInspection', 'QualityIssue', 'SafetyAudit')),
    ImageUrl NVARCHAR(500) NOT NULL,
    InspectionDate DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
    InspectorName NVARCHAR(100) NOT NULL,
    Status NVARCHAR(30) NOT NULL DEFAULT 'Open'
);
GO

-- 5. Table: ProjectMetrics (Executive Summary Dashboard Cache)
CREATE TABLE dbo.ProjectMetrics (
    Id INT PRIMARY KEY IDENTITY(1,1),
    TotalKmTarget FLOAT NOT NULL DEFAULT 100.0,
    TotalKmCompleted FLOAT NOT NULL,
    OverallProgressPercent FLOAT NOT NULL,
    SchedulePerformanceIndex FLOAT NOT NULL, -- SPI = EV / PV
    CostPerformanceIndex FLOAT NOT NULL,     -- CPI = EV / AC
    TotalBudgetCost DECIMAL(18,2) NOT NULL,
    TotalActualCost DECIMAL(18,2) NOT NULL,
    DelayedSectionsCount INT NOT NULL,
    CalculatedAt DATETIME2 NOT NULL DEFAULT GETUTCDATE()
);
GO

-- Create Indexes for High Performance Queries across 100 KM Dataset
CREATE INDEX IX_LayerProgress_Chainage_Layer ON dbo.LayerProgress(ChainageId, LayerId);
CREATE INDEX IX_LayerProgress_Status ON dbo.LayerProgress(Status);
CREATE INDEX IX_RoadChainages_StartEnd ON dbo.RoadChainages(ChainageStart, ChainageEnd);
GO

-- Seed Basic Road Layers Catalog
INSERT INTO dbo.RoadLayers (LayerName, Code, ThicknessMm, MaterialType, DefaultColorHex, SortOrder) VALUES
('Subgrade Earthwork', 'SUB', 500, 'Compacted Soil / Borrow Material', '#8B5A2B', 1),
('Granular Sub-Base (GSB)', 'GSB', 200, 'Crushed Stone Aggregate', '#94A3B8', 2),
('Wet Mix Macadam (WMM)', 'WMM', 250, 'Graded Aggregate & Soil Binder', '#64748B', 3),
('Dense Bituminous Macadam (DBM)', 'DBM', 100, 'Dense Asphalt Concrete Mixture', '#334155', 4),
('Bituminous Concrete (BC Surface)', 'BC', 50, 'Wearing Course Asphalt', '#0F172A', 5);
GO

-- ============================================================================
-- STORED PROCEDURE 1: dbo.sp_GetChainageLayerDetails
-- Retrieves per-chainage level elevation, dynamic layer thickness, level colors,
-- and supports variable layer counts (4, 5, 6, 7+ layers per chainage section)
-- ============================================================================
IF OBJECT_ID('dbo.sp_GetChainageLayerDetails', 'P') IS NOT NULL DROP PROCEDURE dbo.sp_GetChainageLayerDetails;
GO

CREATE PROCEDURE dbo.sp_GetChainageLayerDetails
    @ChainageKm FLOAT = 42.0
AS
BEGIN
    SET NOCOUNT ON;

    -- Query per-chainage layers from LayerProgress & RoadLayers
    SELECT 
        c.ChainageStart AS ChainageKm,
        c.KmLabel,
        c.SectionName,
        c.Elevation AS BaseTerrainElevation,
        c.TerrainType,
        l.Id AS LayerId,
        l.LayerName,
        l.Code AS LayerCode,
        l.SortOrder,
        COALESCE(lp.DesignThicknessMm, l.ThicknessMm) AS EffectiveThicknessMm,
        l.MaterialType,
        COALESCE(lp.LevelColorHex, l.DefaultColorHex) AS LevelColorHex,
        COALESCE(lp.Status, 'In-Progress') AS Status,
        COALESCE(lp.ProgressPercent, 50) AS ProgressPercent,
        -- Calculated Top Level (RL) and Base Level (RL) in meters
        ROUND(c.Elevation + (
            SELECT SUM(COALESCE(lp_sub.DesignThicknessMm, l_sub.ThicknessMm)) / 1000.0
            FROM dbo.RoadLayers l_sub
            INNER JOIN dbo.LayerProgress lp_sub ON lp_sub.LayerId = l_sub.Id AND lp_sub.ChainageId = c.Id
            WHERE l_sub.SortOrder <= l.SortOrder
        ), 3) AS TopLevelMeters,
        ROUND(c.Elevation + (
            SELECT COALESCE(SUM(COALESCE(lp_sub.DesignThicknessMm, l_sub.ThicknessMm)), 0) / 1000.0
            FROM dbo.RoadLayers l_sub
            INNER JOIN dbo.LayerProgress lp_sub ON lp_sub.LayerId = l_sub.Id AND lp_sub.ChainageId = c.Id
            WHERE l_sub.SortOrder < l.SortOrder
        ), 3) AS BaseLevelMeters
    FROM dbo.RoadChainages c
    INNER JOIN dbo.LayerProgress lp ON lp.ChainageId = c.Id
    INNER JOIN dbo.RoadLayers l ON l.Id = lp.LayerId
    WHERE c.ChainageStart = @ChainageKm OR (@ChainageKm IS NULL AND c.ChainageStart = 0)
    ORDER BY l.SortOrder DESC;
END;
GO

-- ============================================================================
-- STORED PROCEDURE 2: dbo.sp_UpdateChainageLayerLevelAndThickness
-- Updates per-chainage layer thickness, elevation levels, and level display color
-- ============================================================================
IF OBJECT_ID('dbo.sp_UpdateChainageLayerLevelAndThickness', 'P') IS NOT NULL DROP PROCEDURE dbo.sp_UpdateChainageLayerLevelAndThickness;
GO

CREATE PROCEDURE dbo.sp_UpdateChainageLayerLevelAndThickness
    @ChainageKm FLOAT,
    @LayerCode NVARCHAR(20),
    @NewThicknessMm INT,
    @NewColorHex NVARCHAR(20) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @ChainageId INT, @LayerId INT;

    SELECT @ChainageId = Id FROM dbo.RoadChainages WHERE ChainageStart = @ChainageKm;
    SELECT @LayerId = Id FROM dbo.RoadLayers WHERE Code = @LayerCode;

    IF @ChainageId IS NOT NULL AND @LayerId IS NOT NULL
    BEGIN
        IF EXISTS (SELECT 1 FROM dbo.LayerProgress WHERE ChainageId = @ChainageId AND LayerId = @LayerId)
        BEGIN
            UPDATE dbo.LayerProgress
            SET DesignThicknessMm = @NewThicknessMm,
                LevelColorHex = COALESCE(@NewColorHex, LevelColorHex),
                UpdatedAt = GETUTCDATE(),
                UpdatedBy = 'UI Stored Procedure Execution'
            WHERE ChainageId = @ChainageId AND LayerId = @LayerId;
        END
        ELSE
        BEGIN
            INSERT INTO dbo.LayerProgress (ChainageId, LayerId, Status, ProgressPercent, DesignThicknessMm, LevelColorHex, PlannedStartDate, PlannedEndDate)
            VALUES (@ChainageId, @LayerId, 'In-Progress', 50.0, @NewThicknessMm, @NewColorHex, GETUTCDATE(), DATEADD(month, 3, GETUTCDATE()));
        END;

        PRINT 'Chainage ' + CAST(@ChainageKm AS NVARCHAR(10)) + ' Layer ' + @LayerCode + ' Updated Successfully!';
    END;
END;
GO

PRINT 'SQL Server Database Schema, Stored Procedures sp_GetChainageLayerDetails & sp_UpdateChainageLayerLevelAndThickness Created Successfully!';
GO
