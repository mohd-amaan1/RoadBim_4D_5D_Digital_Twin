# Match Report — `Road.ifc` × `LayerProgress (2).xlsx`

**Verdict: 12 / 12 rows resolved (100%). 15 / 15 IFC elements covered. Nothing unmatched.**

| | |
|---|---|
| `LayerProgress` rows | 12 |
| Resolved directly to an `IfcBuildingElementProxy` | 9 |
| Resolved through an `IfcGroup` (Revit model group) | 3 |
| Unresolved | **0** |
| IFC elements covered | 15 / 15 |
| Chainage → segment | `ch1 → C`, `ch2 → B`, `ch3 → A` — each chainage maps to exactly one 20 m segment |

`Road.ifc` and `Road 60M v02 (1).ifc` carry **identical GlobalIds** — 15/15 elements, 3/3 groups — so this mapping holds for both files.

---

## Resolution table

| ch | layer | `LayerId` | kind | IFC element(s) | segment |
|---|---|---|---|---|---|
| 1 | SUB | `1qG2$uZQDCJQNmYAadLbsB` | element | `Floor:Subgrade:1676685` | C · 40–60 m |
| 1 | GSB | `1qG2$uZQDCJQNmYAadLbsJ` | element | `Floor:Sub base:1676693` | C |
| 1 | BC | `1qG2$uZQDCJQNmYAadLbsR` | element | `Floor:Base Course:1676701` | C |
| 1 | SC | `0MMizBrBTEeeb43cp8iy30` | **group** *Model Group: Group 1* | `Floor:Surface:1676982` + `Floor:Surface:1676990` | C |
| 2 | SUB | `1qG2$uZQDCJQNmYAadLbrS` | element | `Floor:Subgrade:1676634` | B · 20–40 m |
| 2 | GSB | `1qG2$uZQDCJQNmYAadLbra` | element | `Floor:Sub base:1676642` | B |
| 2 | BC | `1qG2$uZQDCJQNmYAadLbri` | element | `Floor:Base Course:1676650` | B |
| 2 | SC | `0MMizBrBTEeeb43cp8iy2v` | **group** *Model Group: Group 2* | `Floor:Surface:1677028` + `Floor:Surface:1677036` | B |
| 3 | SUB | `1_DMN54lT1qO3bzzCENSBK` | element | `Floor:Subgrade:1675281` | A · 0–20 m |
| 3 | GSB | `1_DMN54lT1qO3bzzCENSA2` | element | `Floor:Sub base:1675335` | A |
| 3 | BC | `1_DMN54lT1qO3bzzCENS9Y` | element | `Floor:Base Course:1675431` | A |
| 3 | SC | `0MMizBrBTEeeb43cp8iy3h` | **group** *Model Group: Group 3* | `Floor:Surface:1675750` + `Floor:Surface:1676251` | A |

### The three group references

```
#483 = IFCGROUP('0MMizBrBTEeeb43cp8iy3h', #6, 'Model Group:Group 3:1676901', $, 'Model Group:Group 3');
#484 = IFCGROUP('0MMizBrBTEeeb43cp8iy30', #6, 'Model Group:Group 1:1676878', $, 'Model Group:Group 1');
#490 = IFCGROUP('0MMizBrBTEeeb43cp8iy2v', #6, 'Model Group:Group 2:1676855', $, 'Model Group:Group 2');

#491 = IFCRELASSIGNSTOGROUP(..., (#205,#247), $, #483);   -- segment A surface lanes
#492 = IFCRELASSIGNSTOGROUP(..., (#381,#413), $, #484);   -- segment C surface lanes
#493 = IFCRELASSIGNSTOGROUP(..., (#445,#477), $, #490);   -- segment B surface lanes
```

The surface course is two lane slabs per segment, so there is no single element to reference. The spreadsheet points at the Revit model group containing both. **The fan-out is declared in the IFC**, not inferred.

---

## Progress data carried by each row

| ch | layer | status | % | delay | budget | actual | variance | planned | actual dates |
|---|---|---|---|---|---|---|---|---|---|
| 1 | SUB | Completed | 100 | 0 d | 75 000 | 77 500 | +2 500 | 2025-01-11 → 01-26 | 2025-01-11 → 01-26 |
| 1 | GSB | Completed | 100 | 0 d | 30 000 | 29 000 | −1 000 | 2025-01-21 → 02-05 | 2025-01-21 → 02-05 |
| 1 | BC | Completed | 100 | 0 d | 37 500 | 36 250 | −1 250 | 2025-01-31 → 02-15 | 2025-01-31 → 02-15 |
| 1 | SC | Completed | 100 | 0 d | 15 000 | 14 500 | −500 | 2025-02-10 → 02-25 | 2025-02-10 → 02-25 |
| 2 | SUB | In Progress | 80 | 0 d | 75 000 | 72 500 | −2 500 | 2025-01-11 → 01-26 | 2025-01-11 → — |
| 2 | GSB | Delayed | 20 | 15 d | 30 000 | 29 000 | −1 000 | 2025-01-21 → 02-05 | 2025-01-26 → — |
| 2 | BC | Delayed | 2 | 5 d | 37 500 | 36 250 | −1 250 | 2025-01-31 → 02-15 | — |
| 2 | SC | Not started | 0 | 0 d | 15 000 | 14 500 | −500 | 2025-02-10 → 02-25 | — |
| 3 | SUB | In Progress | 60 | 0 d | 75 000 | 40 000 | −35 000 | 2025-01-11 → 01-26 | — |
| 3 | GSB | Delayed | 5 | 10 d | 30 000 | 10 000 | −20 000 | 2025-01-21 → 02-05 | — |
| 3 | BC | Not started | 0 | 0 d | 37 500 | 0 | −37 500 | 2025-01-31 → 02-15 | — |
| 3 | SC | Not started | 0 | 0 d | 15 000 | 0 | −15 000 | 2025-02-10 → 02-25 | — |

Totals: budget **472 500**, actual **359 500** — reconciles exactly with `ProjectMetric (1).xlsx`.

---

## Issues found

### 1. Chainage direction contradicts the site coordinate — blocking

`IfcSite` carries `(28,37,26,106719)` / `(77,14,1,415405)` = **28.623918533, 77.233726501**, which is `Road_chainage` row 1 to nine decimal places (0.000 m offset). That site sits at the model origin — the **west end**, segment A. `TrueNorth` is `(0,1)`, so model +X is east, and the chainage coordinates run east from ch1.

The spreadsheet puts ch1 on segment **C**, the east end. **The order is inverted.** One of the two is wrong, and it decides which end of the model turns green first.

### 2. Every `DesignThicknessMm` disagrees with the model

| layer | IFC `IfcMaterialLayerSet` | `DesignThicknessMm` | delta |
|---|---|---|---|
| SUB | 300 mm | 500 | **+200** |
| GSB | 300 mm | 200 | −100 |
| BC | 350 mm | 250 | −100 |
| SC | 150 mm | 100 | −50 |

Not one row agrees. A precedence rule is required, and the winning source must be visible in the UI.

### 3. Status vocabulary violates the database CHECK constraint

Excel writes `In Progress` and `Not started`; the constraint requires `In-Progress` and `Not Started`. A raw insert fails. Normalise on import.

### 4. Dates are Excel serials, with `"NULL"` as a literal string

`45668` → 2025-01-11 via the 1899-12-30 epoch. `ActualStartDate` / `ActualEndDate` contain the four-character text `NULL` where a real null belongs — fourteen of the forty-eight date cells.

### 5. `Id` is not unique

The `Id` column runs 1–4 within each chainage, so `(1,2,3,4)` repeats three times. It is a layer ordinal, not a primary key. Key on `(ChainageId, LayerCode)`.

### 6. `LayerName` is inconsistent with `RoadLayer.xlsx`

`"Granular Sub-Base"` vs `"Granular Sub-Base (GSB)"`, `"Base Course"` vs `"Base cource"`, `"surface course"` vs `"Surface cource"`. Join on `Code`, never on name.
