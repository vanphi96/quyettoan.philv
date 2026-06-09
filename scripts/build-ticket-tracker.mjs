import fs from "node:fs/promises";
import path from "node:path";
import { Workbook, SpreadsheetFile } from "@oai/artifact-tool";

const outputDir = path.resolve("outputs/ticket-tracker");
const outputPath = path.join(outputDir, "ticket-tracker.xlsx");

const tickets = [
  "TNBD1-959 MB - New screen displays transaction content and warning message for mobile authentication of a request initiated from OLB",
  "TNBD1-960 MB - New screen display result after mobile authentication of a request initiated from OLB",
  "TNBD1-964 MB - New confirmation screen when approve or reject transaction from MB",
  "TNBD1-965 MB - Improve UI of pending approval list screen",
  "TNBD1-966 MB - Improve UI of approval detail screen",
  "TNBD1-967 MB - Improve UI of approval result screen when approve or reject transaction from MB",
  "TNBD1-847 OLB & MB - Approval notification not coming through of multi-approval of payments",
  "TNBD1-853 Target Currency Amount incorrect in EUR to GBP payment confirmation screen",
  "TNBD1-621 Account Summary - The header disappears when the user selects Menu and navigates back to the Account Summary screen",
  "TNBD1-722 OLB - After users deny the security alerts on app, OLB shows empty screen",
  "TNBD1-854 OLB - Displays a blank screen after denying a single transaction on the Approval Detail page",
  "TNBD1-891 MB - Resend Activation Code | Improve error message when data not match",
  "TNBD1-983 IB - Approvals - Display a wrong format screen when approved successful and back to Approval list",
  "TNBD1-988 OLB - Remove 'Add new beneficiary' in Transfer screen",
  "TNBD1-991 OLB - Make a payment - Unable to add a new beneficiary",
  "TNBD1-241 Menu glitch when selecting Make a Payment or Transfer Money",
  "TNBD1-510 OLB - FE change: display YTD performance on dashboard",
  "TNBD1-511 MB - FE change: display YTD performance on dashboard",
  "TNBD1-597 OLB | Sort code tab/cursor bug",
  "TNBD1-867 OLB | Bulk - Inconsistent UI/UX in bulk upload",
  "TNBD1-889 MB - Menu bar - Inconsistent menu options displayed after login",
  "TNBD1-892 Bulk | Incorrect cursor on downloadable template link",
  "TNBD1-893 Bulk | Currency field missing currency code",
  "TNBD1-895 Bulk | Payment reference auto-capitalised (Adding beneficiary)",
  "TNBD1-897 Bulk | Payment template breaks after completion",
  "TNBD1-1008 Add new beneficiary - Redundant 'Add New Beneficiary' button displayed in the right-side menu",
  "TNBD1-1014 MB | Menu glitches all features to check deposits and show my bills in the tab",
  "TNBD1-1015 MB - Error display is inconsistent and unclear when transaction amount exceeds account balance"
];

const assignees = ["KhiemNguyen", "PhiLV", "KhoaPham"];
const statuses = [
  "todo",
  "ready to deploy dev",
  "ready to test dev",
  "ready to deploy uat",
  "ready to test uat",
];

const workbook = Workbook.create();
const tracker = workbook.worksheets.add("Ticket Tracker");
const lists = workbook.worksheets.add("Lists");

tracker.getRange("A1:C1").values = [["Tên ticket", "Assign", "Status"]];
tracker.getRange(`A2:A${tickets.length + 1}`).values = tickets.map((ticket) => [ticket]);
tracker.getRange(`B2:C${tickets.length + 1}`).values = tickets.map(() => ["", ""]);

lists.getRange("A1:A3").values = assignees.map((value) => [value]);
lists.getRange("B1:B5").values = statuses.map((value) => [value]);

tracker.getRange("A1:C1").format.fill = "#1F4E78";
tracker.getRange("A1:C1").format.font = { bold: true, color: "#FFFFFF", size: 12 };
tracker.getRange("A1:C1").format.horizontalAlignment = "center";
tracker.getRange(`A2:C${tickets.length + 1}`).format.font = { size: 11 };
tracker.getRange(`A2:C${tickets.length + 1}`).format.verticalAlignment = "middle";
tracker.getRange(`A2:A${tickets.length + 1}`).format.wrapText = true;

tracker.getRange("A:A").format.columnWidthPx = 680;
tracker.getRange("B:B").format.columnWidthPx = 170;
tracker.getRange("C:C").format.columnWidthPx = 230;
tracker.getRange(`1:${tickets.length + 1}`).format.rowHeightPx = 28;
tracker.getRange(`A2:A${tickets.length + 1}`).format.rowHeightPx = 40;
tracker.freezePanes.freezeRows(1);
tracker.getRange(`A1:C${tickets.length + 1}`).format.borders = {
  preset: "all",
  color: "#D9E2F3",
  style: "thin",
};

tracker.getRange(`B2:B${tickets.length + 1}`).dataValidation = {
  allowBlank: true,
  list: {
    inCellDropDown: true,
    source: assignees,
  },
};
tracker.getRange(`C2:C${tickets.length + 1}`).dataValidation = {
  allowBlank: true,
  list: {
    inCellDropDown: true,
    source: statuses,
  },
};

await fs.mkdir(outputDir, { recursive: true });
const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);

console.log(outputPath);
