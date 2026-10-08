import * as XLSX from 'xlsx';

/**
 * Sample progress sheet.
 *
 * Layer_Code must match the codes derived from the IFC layer names
 * (SUB / GSB / WMM / DBM / BC) so uploaded rows bind to the modelled layers.
 * Budget_Cost and Actual_Cost are optional — supply them and the dashboard can
 * compute PV / EV / AC / CV / CPI; leave them out and those stay "—".
 */
export function downloadSampleExcelTemplate() {
  const sampleRows = [
    { Chainage_Start: 0, Chainage_End: 10, Layer_Code: 'SUB', Status: 'Completed', Progress_Percent: 100, Target_Date: '2026-02-15', Budget_Cost: 750000, Actual_Cost: 725000 },
    { Chainage_Start: 0, Chainage_End: 10, Layer_Code: 'GSB', Status: 'Completed', Progress_Percent: 100, Target_Date: '2026-03-01', Budget_Cost: 300000, Actual_Cost: 291000 },
    { Chainage_Start: 0, Chainage_End: 10, Layer_Code: 'WMM', Status: 'Completed', Progress_Percent: 100, Target_Date: '2026-03-20', Budget_Cost: 375000, Actual_Cost: 362000 },
    { Chainage_Start: 0, Chainage_End: 10, Layer_Code: 'DBM', Status: 'Completed', Progress_Percent: 100, Target_Date: '2026-04-05', Budget_Cost: 150000, Actual_Cost: 148500 },
    { Chainage_Start: 0, Chainage_End: 10, Layer_Code: 'BC', Status: 'In-Progress', Progress_Percent: 80, Target_Date: '2026-05-10', Budget_Cost: 75000, Actual_Cost: 60000 },

    { Chainage_Start: 40, Chainage_End: 50, Layer_Code: 'DBM', Status: 'Delayed', Progress_Percent: 30, Target_Date: '2026-04-01', Budget_Cost: 150000, Actual_Cost: 190000 },
    { Chainage_Start: 40, Chainage_End: 50, Layer_Code: 'BC', Status: 'Delayed', Progress_Percent: 10, Target_Date: '2026-04-15', Budget_Cost: 75000, Actual_Cost: 96000 },

    { Chainage_Start: 70, Chainage_End: 85, Layer_Code: 'SUB', Status: 'In-Progress', Progress_Percent: 60, Target_Date: '2026-06-01', Budget_Cost: 1125000, Actual_Cost: 700000 },
    { Chainage_Start: 85, Chainage_End: 100, Layer_Code: 'SUB', Status: 'Not Started', Progress_Percent: 0, Target_Date: '2026-07-15', Budget_Cost: 1125000, Actual_Cost: 0 }
  ];

  const worksheet = XLSX.utils.json_to_sheet(sampleRows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'RoadProgress');

  XLSX.writeFile(workbook, '100KM_Highway_Progress_Report.xlsx');
}
