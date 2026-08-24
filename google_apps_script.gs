/**
 * ==============================================================================
 * GOOGLE APPS SCRIPT - ĐỒNG BỘ DỮ LIỆU & GHI LỊCH SỬ VÀO GOOGLE SHEET
 * ==============================================================================
 * Cấu trúc Sheets:
 * 1. Sheet 'products' (hoặc 'poducts'): Bảng cấu hình sản phẩm & giá nhập.
 * 2. Sheet 'monthly_reports' (hoặc 'doanh_thu_thang'): Báo cáo doanh thu, lợi nhuận, chi phí theo tháng.
 * 3. Sheet 'history' (hoặc 'Lịch sử'): Lưu lại toàn bộ lịch sử thay đổi:
 *    - Thời gian (Ngày, giờ)
 *    - Loại thay đổi (Thêm sản phẩm / Sửa sản phẩm / Xóa sản phẩm / Thêm tháng / Sửa tháng / Xóa tháng)
 *    - Tên đối tượng (Tên sản phẩm hoặc Tháng báo cáo)
 *    - Chi tiết thay đổi (Giá cũ -> Giá mới, Doanh thu cũ -> mới, v.v.)
 *    - Nguồn thao tác (TikTok, Shopee, Lợi nhuận giá bán, Báo cáo tháng)
 * ==============================================================================
 */

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    // Chờ tối đa 15 giây
    lock.waitLock(15000);

    var rawContents = (e && e.postData && e.postData.contents) ? e.postData.contents : "";
    if (!rawContents) {
      return ContentService.createTextOutput(JSON.stringify({
        status: "error",
        message: "Không nhận được dữ liệu (Empty payload)"
      })).setMimeType(ContentService.MimeType.JSON);
    }

    var data = JSON.parse(rawContents);
    var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();

    // 1. Tìm hoặc tạo sheet lịch sử thay đổi ("history")
    var historySheet = spreadsheet.getSheetByName("history") || 
                       spreadsheet.getSheetByName("Lịch sử") || 
                       spreadsheet.getSheetByName("logs");
    if (!historySheet) {
      historySheet = spreadsheet.insertSheet("history");
    }

    // Đảm bảo historySheet có header chuẩn
    var historyHeaders = ["Thời gian", "Loại thay đổi", "Tên đối tượng", "Chi tiết thay đổi", "Nguồn thao tác"];
    if (historySheet.getLastRow() === 0) {
      historySheet.appendRow(historyHeaders);
      var hRange = historySheet.getRange(1, 1, 1, historyHeaders.length);
      hRange.setFontWeight("bold");
      hRange.setBackground("#f1f5f9");
      historySheet.setFrozenRows(1);
      historySheet.setColumnWidth(1, 160); // Thời gian
      historySheet.setColumnWidth(2, 170); // Loại thay đổi
      historySheet.setColumnWidth(3, 200); // Tên đối tượng
      historySheet.setColumnWidth(4, 340); // Chi tiết thay đổi
      historySheet.setColumnWidth(5, 180); // Nguồn thao tác
    }

    var now = new Date();
    var timeStr = Utilities.formatDate(now, "Asia/Ho_Chi_Minh", "dd/MM/yyyy HH:mm:ss");
    var sourceName = data.source || "Web App";

    // =========================================================================
    // XỬ LÝ: LƯU KỲ QUYẾT TOÁN CHI TIẾT THEO SHOP (settlement_periods)
    // =========================================================================
    if (data.action === "saveSettlementPeriods" || data.action === "saveSettlementPeriod" || Array.isArray(data.settlementPeriods)) {
      var periodSheet = spreadsheet.getSheetByName("settlement_periods") || 
                        spreadsheet.getSheetByName("ky_quyet_toan") ||
                        spreadsheet.getSheetByName("chi_tiet_quyet_toan");
      if (!periodSheet) {
        periodSheet = spreadsheet.insertSheet("settlement_periods");
      }

      var periodHeaders = [
        "ID", "Thời gian lưu", "Sàn", "Tên Shop", "Khoảng ngày", "Tháng",
        "Tổng đơn", "Đơn hoàn/hủy", "Doanh thu (VNĐ)", "Tiền hàng (VNĐ)",
        "Chi phí Ads (VNĐ)", "Chi phí Vật tư (VNĐ)", "Chi phí khác (VNĐ)", "Lợi nhuận (VNĐ)", "Ghi chú"
      ];

      // Đảm bảo header chuẩn
      if (periodSheet.getLastRow() === 0) {
        periodSheet.appendRow(periodHeaders);
        var pHeaderRange = periodSheet.getRange(1, 1, 1, periodHeaders.length);
        pHeaderRange.setFontWeight("bold").setBackground("#f8fafc");
        periodSheet.setFrozenRows(1);
        periodSheet.setColumnWidth(1, 110); // ID
        periodSheet.setColumnWidth(2, 160); // Thời gian lưu
        periodSheet.setColumnWidth(3, 110); // Sàn
        periodSheet.setColumnWidth(4, 160); // Tên Shop
        periodSheet.setColumnWidth(5, 180); // Khoảng ngày
        periodSheet.setColumnWidth(6, 110); // Tháng
        periodSheet.setColumnWidth(7, 90);  // Tổng đơn
        periodSheet.setColumnWidth(8, 110); // Đơn hoàn/hủy
        periodSheet.setColumnWidth(9, 160); // Doanh thu
        periodSheet.setColumnWidth(10, 150); // Tiền hàng
        periodSheet.setColumnWidth(11, 150); // Chi phí Ads
        periodSheet.setColumnWidth(12, 150); // Chi phí Vật tư
        periodSheet.setColumnWidth(13, 140); // Chi phí khác
        periodSheet.setColumnWidth(14, 160); // Lợi nhuận
        periodSheet.setColumnWidth(15, 200); // Ghi chú
      }

      var pLogRows = [];
      var periodsList = [];
      if (Array.isArray(data.settlementPeriods)) {
        periodsList = data.settlementPeriods;
      } else if (data.period) {
        periodsList = [data.period];
      }

      if (data.action === "saveSettlementPeriods") {
        // Ghi đè toàn bộ danh sách
        var cleanPeriodRows = [periodHeaders];
        for (var pi = 0; pi < periodsList.length; pi++) {
          var p = periodsList[pi];
          if (!p) continue;
          var pid = String(p.id || ("PERIOD_" + Date.now() + "_" + pi)).trim();
          var pTime = String(p.savedAt || timeStr).trim();
          var pPlatform = String(p.platform || p.source || "").trim();
          var pShop = String(p.shopName || "").trim();
          var pDateRange = String(p.dateRange || "").trim();
          var pMonth = String(p.month || "").trim();
          var pTotalOrders = Number(p.totalOrders) || 0;
          var pReturnOrders = Number(p.returnOrders) || 0;
          var pRevenue = Number(p.revenue) || 0;
          var pGoodsCost = Number(p.goodsCost) || 0;
          var pAdsCost = Number(p.adsCost) || 0;
          var pMaterialCost = Number(p.materialCost) || 0;
          var pOtherExpenses = Number(p.otherExpenses) || 0;
          var pProfit = Number(p.profit) || 0;
          var rawNote = String(p.note || "").trim();
          var pNote = (rawNote === "null" || rawNote === "undefined") ? "" : rawNote;

          cleanPeriodRows.push([
            pid, pTime, pPlatform, pShop, pDateRange, pMonth,
            pTotalOrders, pReturnOrders, pRevenue, pGoodsCost,
            pAdsCost, pMaterialCost, pOtherExpenses, pProfit, pNote
          ]);
        }

        periodSheet.clearContents();
        if (cleanPeriodRows.length > 0) {
          var prange = periodSheet.getRange(1, 1, cleanPeriodRows.length, periodHeaders.length);
          prange.setValues(cleanPeriodRows);
          periodSheet.getRange(1, 1, 1, periodHeaders.length).setFontWeight("bold").setBackground("#f8fafc");
          periodSheet.setFrozenRows(1);
          if (cleanPeriodRows.length > 1) {
            periodSheet.getRange(2, 7, cleanPeriodRows.length - 1, 2).setNumberFormat("#,##0");
            periodSheet.getRange(2, 9, cleanPeriodRows.length - 1, 6).setNumberFormat("#,##0");
          }
        }

        pLogRows.push([
          timeStr,
          "Đồng bộ kỳ quyết toán",
          "Kỳ quyết toán (" + (cleanPeriodRows.length - 1) + " kỳ)",
          "Đã lưu danh sách " + (cleanPeriodRows.length - 1) + " kỳ quyết toán các shop",
          sourceName
        ]);
      } else {
        // Thêm 1 kỳ hoặc cập nhật 1 kỳ
        var pItem = periodsList[0];
        if (pItem) {
          var pId = String(pItem.id || ("PERIOD_" + Date.now())).trim();
          var pRowData = [
            pId,
            timeStr,
            String(pItem.platform || pItem.source || "").trim(),
            String(pItem.shopName || "").trim(),
            String(pItem.dateRange || "").trim(),
            String(pItem.month || "").trim(),
            Number(pItem.totalOrders) || 0,
            Number(pItem.returnOrders) || 0,
            Number(pItem.revenue) || 0,
            Number(pItem.goodsCost) || 0,
            Number(pItem.adsCost) || 0,
            Number(pItem.materialCost) || 0,
            Number(pItem.otherExpenses) || 0,
            Number(pItem.profit) || 0,
            (String(pItem.note || "").trim() === "null" || String(pItem.note || "").trim() === "undefined") ? "" : String(pItem.note || "").trim()
          ];

          // Kiểm tra xem ID đã tồn tại chưa để update hay append
          var pLastRow = periodSheet.getLastRow();
          var foundRowIdx = -1;
          if (pLastRow > 1) {
            var existingIds = periodSheet.getRange(2, 1, pLastRow - 1, 1).getValues();
            for (var ei = 0; ei < existingIds.length; ei++) {
              if (String(existingIds[ei][0]).trim() === pId) {
                foundRowIdx = ei + 2;
                break;
              }
            }
          }

          if (foundRowIdx > 0) {
            periodSheet.getRange(foundRowIdx, 1, 1, periodHeaders.length).setValues([pRowData]);
            pLogRows.push([
              timeStr,
              "Cập nhật kỳ quyết toán",
              pItem.shopName + " (" + pItem.dateRange + ")",
              "Cập nhật: DT " + Number(pItem.revenue).toLocaleString("vi-VN") + " đ | LN " + Number(pItem.profit).toLocaleString("vi-VN") + " đ | " + pItem.totalOrders + " đơn",
              sourceName
            ]);
          } else {
            periodSheet.appendRow(pRowData);
            var newRowIdx = periodSheet.getLastRow();
            periodSheet.getRange(newRowIdx, 7, 1, 2).setNumberFormat("#,##0");
            periodSheet.getRange(newRowIdx, 9, 1, 6).setNumberFormat("#,##0");
            pLogRows.push([
              timeStr,
              "Lưu kỳ quyết toán mới",
              pItem.shopName + " (" + pItem.dateRange + ")",
              "Lưu kỳ quyết toán: DT " + Number(pItem.revenue).toLocaleString("vi-VN") + " đ | LN " + Number(pItem.profit).toLocaleString("vi-VN") + " đ | " + pItem.totalOrders + " đơn (Hoàn/hủy: " + pItem.returnOrders + ")",
              sourceName
            ]);
          }
        }
      }

      // Ghi log lịch sử
      if (pLogRows.length > 0) {
        historySheet.getRange(historySheet.getLastRow() + 1, 1, pLogRows.length, historyHeaders.length).setValues(pLogRows);
      }

      return ContentService.createTextOutput(JSON.stringify({
        status: "success",
        message: "Đã lưu kỳ quyết toán thành công vào sheet settlement_periods",
        timestamp: timeStr
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // =========================================================================
    // XỬ LÝ: QUẢN LÝ DANH SÁCH SHOP & PHÍ SÀN & SẢN PHẨM SHOP (shops & shop_products)
    // =========================================================================
    if (data.action === "saveShops" || Array.isArray(data.shops)) {
      var shops = data.shops || [];
      var shopSheet = spreadsheet.getSheetByName("shops") || 
                      spreadsheet.getSheetByName("danh_sach_shop") ||
                      spreadsheet.getSheetByName("Shop");
      if (!shopSheet) {
        shopSheet = spreadsheet.insertSheet("shops");
      }

      var shopHeaders = ["ID", "Tên Shop", "Sàn", "% Phí sàn", "Ghi chú", "Dữ liệu sản phẩm (JSON)", "Thời gian cập nhật"];
      if (shopSheet.getLastRow() === 0) {
        shopSheet.appendRow(shopHeaders);
        var sHeaderRange = shopSheet.getRange(1, 1, 1, shopHeaders.length);
        sHeaderRange.setFontWeight("bold").setBackground("#f8fafc");
        shopSheet.setFrozenRows(1);
        shopSheet.setColumnWidth(1, 110);
        shopSheet.setColumnWidth(2, 180);
        shopSheet.setColumnWidth(3, 130);
        shopSheet.setColumnWidth(4, 120);
        shopSheet.setColumnWidth(5, 180);
        shopSheet.setColumnWidth(6, 250);
        shopSheet.setColumnWidth(7, 160);
      }

      // Ghi đè toàn bộ danh sách shop
      if (shopSheet.getLastRow() > 1) {
        shopSheet.getRange(2, 1, shopSheet.getLastRow() - 1, Math.max(shopSheet.getLastColumn(), shopHeaders.length)).clearContent();
      }

      var shopRows = [];
      var allShopProductRows = [];

      for (var si = 0; si < shops.length; si++) {
        var s = shops[si];
        var sName = String(s.name || "").trim();
        if (!sName) continue;
        var sId = String(s.id || "SHOP_" + (si + 1)).trim();
        var sPlatform = String(s.platform || (sName.toLowerCase().indexOf("tiktok") >= 0 ? "TikTok Shop" : "Shopee")).trim();
        var sFee = Number(s.feePercent) || 0;
        var sNote = (s.note && String(s.note).trim() !== "null" && String(s.note).trim() !== "undefined") ? String(s.note).trim() : "";
        var sProducts = Array.isArray(s.products) ? s.products : [];
        var sProductsJson = JSON.stringify(sProducts);

        shopRows.push([sId, sName, sPlatform, sFee, sNote, sProductsJson, timeStr]);

        // Trích xuất từng sản phẩm cho sheet shop_products
        for (var pi = 0; pi < sProducts.length; pi++) {
          var p = sProducts[pi];
          var pId = String(p.id || sId + "_P" + (pi + 1));
          var pName = String(p.name || "");
          var pVar = String(p.variation || "Mặc định");
          var pItems = Array.isArray(p.items) ? p.items : [];
          var pItemsStr = pItems.map(function(it) {
            return (it.quantity || 1) + "x " + (it.productName || "SP Kho #" + it.productId);
          }).join(" + ");
          
          var pDeal = p.deal || {};
          var pDealStr = "";
          if (pDeal.buyQty && pDeal.giftQty) {
            pDealStr = "Mua " + pDeal.buyQty + " tặng " + pDeal.giftQty;
          } else {
            pDealStr = "Không khuyến mãi";
          }

          var pPrice = Number(p.price) || 0;
          var pPkg = Number(p.packagingFee) || 0;
          var pNote = String(p.note || "");

          allShopProductRows.push([
            sId, sName, sPlatform, pId, pName, pVar, pItemsStr, pDealStr, pPrice, pPkg, pNote, timeStr
          ]);
        }
      }

      if (shopRows.length > 0) {
        shopSheet.getRange(2, 1, shopRows.length, shopHeaders.length).setValues(shopRows);
        shopSheet.getRange(2, 4, shopRows.length, 1).setNumberFormat("0.0\"%\"");
      }

      // Cập nhật tab chi tiết shop_products (nếu có)
      var shopProdSheet = spreadsheet.getSheetByName("shop_products") || spreadsheet.getSheetByName("san_pham_shop");
      if (!shopProdSheet) {
        shopProdSheet = spreadsheet.insertSheet("shop_products");
      }
      var spHeaders = ["Shop ID", "Tên Shop", "Sàn", "Mã SP", "Tên Sản Phẩm Shop", "Phân Loại", "Thành Phần Kho", "Deal Khuyến Mãi", "Giá Bán", "Phí Đóng Gói", "Ghi Chú", "Thời Gian Cập Nhật"];
      if (shopProdSheet.getLastRow() === 0) {
        shopProdSheet.appendRow(spHeaders);
        shopProdSheet.getRange(1, 1, 1, spHeaders.length).setFontWeight("bold").setBackground("#f0fdf4");
        shopProdSheet.setFrozenRows(1);
      }
      if (shopProdSheet.getLastRow() > 1) {
        shopProdSheet.getRange(2, 1, shopProdSheet.getLastRow() - 1, Math.max(shopProdSheet.getLastColumn(), spHeaders.length)).clearContent();
      }
      if (allShopProductRows.length > 0) {
        shopProdSheet.getRange(2, 1, allShopProductRows.length, spHeaders.length).setValues(allShopProductRows);
      }

      historySheet.appendRow([
        timeStr,
        "Cập nhật danh sách Shop & Sản phẩm Shop",
        shopRows.length + " shop (" + allShopProductRows.length + " SP)",
        "Lưu cấu hình " + shopRows.length + " shop và " + allShopProductRows.length + " sản phẩm/deal",
        sourceName
      ]);

      return ContentService.createTextOutput(JSON.stringify({
        status: "success",
        message: "Đã lưu danh sách shop và sản phẩm shop thành công!",
        shopCount: shopRows.length,
        productCount: allShopProductRows.length,
        timestamp: timeStr
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // =========================================================================
    // XỬ LÝ 1: LƯU BÁO CÁO DOANH THU THÁNG (monthly_reports)
    // =========================================================================
    if (data.action === "saveMonthlyReports" || Array.isArray(data.monthlyReports)) {
      var monthlyReports = data.monthlyReports || data.reports || [];
      var monthlySheet = spreadsheet.getSheetByName("monthly_reports") || 
                         spreadsheet.getSheetByName("doanh_thu_thang") ||
                         spreadsheet.getSheetByName("monthly");
      
      if (!monthlySheet) {
        monthlySheet = spreadsheet.insertSheet("monthly_reports");
      }

      // Đọc dữ liệu cũ để so sánh lịch sử
      var oldReportsMap = {};
      var mLastRow = monthlySheet.getLastRow();
      if (mLastRow > 1) {
        var mOldValues = monthlySheet.getRange(2, 1, mLastRow - 1, 6).getValues();
        for (var mi = 0; mi < mOldValues.length; mi++) {
          var mRow = mOldValues[mi];
          var mMonth = String(mRow[0] || "").trim();
          if (!mMonth) continue;
          oldReportsMap[mMonth] = {
            month: mMonth,
            revenue: Number(mRow[1]) || 0,
            profit: Number(mRow[2]) || 0,
            adsCost: Number(mRow[3]) || 0,
            materialCost: Number(mRow[4]) || 0,
            note: String(mRow[5] || "").trim()
          };
        }
      }

      // Chuẩn bị danh sách mới
      var newReportsMap = {};
      var monthlyHeader = ["Tháng", "Doanh thu (VNĐ)", "Lợi nhuận (VNĐ)", "Chi phí quảng cáo (VNĐ)", "Chi phí vật tư (VNĐ)", "Ghi chú"];
      var cleanMonthlyRows = [monthlyHeader];

      for (var mj = 0; mj < monthlyReports.length; mj++) {
        var rep = monthlyReports[mj];
        if (!rep) continue;
        var rMonth = String(rep.month || "").trim();
        if (!rMonth) continue;

        var rRevenue = Number(rep.revenue) || 0;
        var rProfit = Number(rep.profit) || 0;
        var rAdsCost = Number(rep.adsCost !== undefined ? rep.adsCost : rep.ads) || 0;
        var rMaterialCost = Number(rep.materialCost !== undefined ? rep.materialCost : rep.materials) || 0;
        var rNote = String(rep.note || "").trim();

        cleanMonthlyRows.push([rMonth, rRevenue, rProfit, rAdsCost, rMaterialCost, rNote]);
        newReportsMap[rMonth] = {
          month: rMonth,
          revenue: rRevenue,
          profit: rProfit,
          adsCost: rAdsCost,
          materialCost: rMaterialCost,
          note: rNote
        };
      }

      // So sánh để ghi log vào sheet history
      var mLogRows = [];

      // 1. Thêm mới
      for (var nMonth in newReportsMap) {
        if (!oldReportsMap[nMonth]) {
          var addedM = newReportsMap[nMonth];
          var detailStr = "Thêm mới: DT " + addedM.revenue.toLocaleString("vi-VN") + " đ | LN " + addedM.profit.toLocaleString("vi-VN") + " đ | Ads " + addedM.adsCost.toLocaleString("vi-VN") + " đ | Vật tư " + addedM.materialCost.toLocaleString("vi-VN") + " đ";
          mLogRows.push([
            timeStr,
            "Thêm báo cáo tháng",
            "Tháng " + addedM.month,
            detailStr,
            sourceName
          ]);
        }
      }

      // 2. Xóa
      for (var oMonth in oldReportsMap) {
        if (!newReportsMap[oMonth]) {
          var deletedM = oldReportsMap[oMonth];
          mLogRows.push([
            timeStr,
            "Xóa báo cáo tháng",
            "Tháng " + deletedM.month,
            "Đã xóa dữ liệu tháng (DT cũ: " + deletedM.revenue.toLocaleString("vi-VN") + " đ)",
            sourceName
          ]);
        }
      }

      // 3. Chỉnh sửa
      for (var cMonth in newReportsMap) {
        if (oldReportsMap[cMonth]) {
          var oldM = oldReportsMap[cMonth];
          var newM = newReportsMap[cMonth];
          var mChanges = [];

          if (oldM.revenue !== newM.revenue) {
            mChanges.push("DT: " + oldM.revenue.toLocaleString("vi-VN") + " -> " + newM.revenue.toLocaleString("vi-VN") + " đ");
          }
          if (oldM.profit !== newM.profit) {
            mChanges.push("LN: " + oldM.profit.toLocaleString("vi-VN") + " -> " + newM.profit.toLocaleString("vi-VN") + " đ");
          }
          if (oldM.adsCost !== newM.adsCost) {
            mChanges.push("Ads: " + oldM.adsCost.toLocaleString("vi-VN") + " -> " + newM.adsCost.toLocaleString("vi-VN") + " đ");
          }
          if (oldM.materialCost !== newM.materialCost) {
            mChanges.push("Vật tư: " + oldM.materialCost.toLocaleString("vi-VN") + " -> " + newM.materialCost.toLocaleString("vi-VN") + " đ");
          }
          if (oldM.note !== newM.note) {
            mChanges.push("Ghi chú: " + oldM.note + " -> " + newM.note);
          }

          if (mChanges.length > 0) {
            mLogRows.push([
              timeStr,
              "Chỉnh sửa báo cáo tháng",
              "Tháng " + newM.month,
              mChanges.join(" | "),
              sourceName
            ]);
          }
        }
      }

      // Ghi đè vào monthlySheet
      monthlySheet.clearContents();
      if (cleanMonthlyRows.length > 0) {
        var mRange = monthlySheet.getRange(1, 1, cleanMonthlyRows.length, monthlyHeader.length);
        mRange.setValues(cleanMonthlyRows);
        monthlySheet.getRange(1, 1, 1, monthlyHeader.length).setFontWeight("bold").setBackground("#f8fafc");
        monthlySheet.setFrozenRows(1);
        if (cleanMonthlyRows.length > 1) {
          monthlySheet.getRange(2, 2, cleanMonthlyRows.length - 1, 4).setNumberFormat("#,##0");
        }
        monthlySheet.setColumnWidth(1, 120); // Tháng
        monthlySheet.setColumnWidth(2, 170); // Doanh thu
        monthlySheet.setColumnWidth(3, 170); // Lợi nhuận
        monthlySheet.setColumnWidth(4, 180); // Ads
        monthlySheet.setColumnWidth(5, 180); // Vật tư
        monthlySheet.setColumnWidth(6, 200); // Ghi chú
      }

      // Ghi lịch sử
      if (mLogRows.length > 0) {
        historySheet.getRange(historySheet.getLastRow() + 1, 1, mLogRows.length, historyHeaders.length).setValues(mLogRows);
      }

      return ContentService.createTextOutput(JSON.stringify({
        status: "success",
        message: "Đã lưu " + (cleanMonthlyRows.length - 1) + " tháng báo cáo lên sheet và ghi " + mLogRows.length + " lịch sử.",
        changesCount: mLogRows.length,
        count: cleanMonthlyRows.length - 1,
        timestamp: timeStr
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // =========================================================================
    // XỬ LÝ 2: LƯU DANH SÁCH SẢN PHẨM (products)
    // =========================================================================
    if (data.action === "saveProducts" || Array.isArray(data.products)) {
      var newProducts = data.products || [];

      // 1. Tìm hoặc tạo sheet sản phẩm
      var productSheet = spreadsheet.getSheetByName("products") || 
                         spreadsheet.getSheetByName("poducts") || 
                         spreadsheet.getSheets()[0];

      if (productSheet.getName() !== "products" && productSheet.getName() !== "poducts") {
        try { productSheet.setName("products"); } catch(e) {}
      }

      // Đọc dữ liệu cũ
      var oldProductsMap = {};
      var lastRow = productSheet.getLastRow();
      
      if (lastRow > 1) {
        var oldValues = productSheet.getRange(2, 1, lastRow - 1, 3).getValues();
        for (var i = 0; i < oldValues.length; i++) {
          var row = oldValues[i];
          var oldName = String(row[0] || "").trim();
          if (!oldName) continue;
          var oldAliases = String(row[1] || "").trim();
          var oldPrice = Number(row[2]) || 0;
          
          oldProductsMap[oldName] = { name: oldName, aliases: oldAliases, price: oldPrice };
        }
      }

      // Chuẩn bị danh sách mới
      var newProductsMap = {};
      var cleanNewRows = [["Tên sản phẩm (Dùng để nhận diện)", "Từ khóa / Tên phụ nhận diện", "Giá nhập (VNĐ)"]];
      
      for (var j = 0; j < newProducts.length; j++) {
        var np = newProducts[j];
        if (!np) continue;
        var nName = String(np.name || "").trim();
        var nAliases = "";
        if (Array.isArray(np.aliases)) {
          nAliases = np.aliases.filter(Boolean).map(function(s) { return String(s).trim(); }).join("\n");
        } else if (np.aliases) {
          nAliases = String(np.aliases).trim();
        } else {
          nAliases = "";
        }
        var nPrice = Number(np.price) || 0;

        if (nName || nAliases || nPrice > 0) {
          cleanNewRows.push([nName, nAliases, nPrice]);
          if (nName) {
            newProductsMap[nName] = { name: nName, aliases: nAliases, price: nPrice };
          }
        }
      }

      // Log lịch sử
      var logRows = [];

      // 1. Thêm mới
      for (var name in newProductsMap) {
        if (!oldProductsMap[name]) {
          var addedP = newProductsMap[name];
          var aliasDetail = addedP.aliases ? " | Từ khóa: " + addedP.aliases.replace(/\n/g, ", ") : "";
          logRows.push([
            timeStr,
            "Thêm sản phẩm",
            addedP.name,
            "Thêm mới: Giá nhập " + addedP.price.toLocaleString("vi-VN") + " đ" + aliasDetail,
            sourceName
          ]);
        }
      }

      // 2. Xóa
      for (var oName in oldProductsMap) {
        if (!newProductsMap[oName]) {
          var deletedP = oldProductsMap[oName];
          logRows.push([
            timeStr,
            "Xóa sản phẩm",
            deletedP.name,
            "Đã xóa khỏi danh sách (Giá cũ: " + deletedP.price.toLocaleString("vi-VN") + " đ)",
            sourceName
          ]);
        }
      }

      // 3. Chỉnh sửa
      for (var n in newProductsMap) {
        if (oldProductsMap[n]) {
          var oldP = oldProductsMap[n];
          var newP = newProductsMap[n];
          var changes = [];

          if (oldP.price !== newP.price) {
            changes.push("Đổi giá nhập: " + oldP.price.toLocaleString("vi-VN") + " đ -> " + newP.price.toLocaleString("vi-VN") + " đ");
          }
          if (oldP.aliases !== newP.aliases) {
            changes.push("Đổi từ khóa nhận diện: [" + oldP.aliases.replace(/\n/g, ", ") + "] -> [" + newP.aliases.replace(/\n/g, ", ") + "]");
          }

          if (changes.length > 0) {
            logRows.push([
              timeStr,
              "Chỉnh sửa sản phẩm",
              newP.name,
              changes.join(" | "),
              sourceName
            ]);
          }
        }
      }

      // Cập nhật lại productSheet
      productSheet.clearContents();
      if (cleanNewRows.length > 0) {
        var range = productSheet.getRange(1, 1, cleanNewRows.length, 3);
        range.setValues(cleanNewRows);
        productSheet.getRange(1, 1, 1, 3).setFontWeight("bold");
        if (cleanNewRows.length > 1) {
          productSheet.getRange(2, 3, cleanNewRows.length - 1, 1).setNumberFormat("#,##0");
        }
      }

      // Ghi log vào historySheet
      if (logRows.length > 0) {
        historySheet.getRange(historySheet.getLastRow() + 1, 1, logRows.length, historyHeaders.length).setValues(logRows);
      }

      return ContentService.createTextOutput(JSON.stringify({
        status: "success",
        message: "Đã lưu " + (cleanNewRows.length - 1) + " sản phẩm lên sheet và ghi " + logRows.length + " lịch sử thay đổi.",
        changesCount: logRows.length,
        productCount: cleanNewRows.length - 1,
        timestamp: timeStr
      })).setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService.createTextOutput(JSON.stringify({
      status: "error",
      message: "Action không hợp lệ"
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      status: "error",
      message: "Lỗi Apps Script: " + err.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  } finally {
    try {
      lock.releaseLock();
    } catch(e) {}
  }
}

// Xử lý đọc dữ liệu hoặc ping
function doGet(e) {
  try {
    var action = (e && e.parameter && e.parameter.action) ? e.parameter.action : "";
    var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();

    if (action === "getSettlementPeriods") {
      var periodSheet = spreadsheet.getSheetByName("settlement_periods") || 
                        spreadsheet.getSheetByName("ky_quyet_toan") ||
                        spreadsheet.getSheetByName("chi_tiet_quyet_toan");
      var periods = [];
      if (periodSheet && periodSheet.getLastRow() > 1) {
        var pValues = periodSheet.getRange(2, 1, periodSheet.getLastRow() - 1, 15).getValues();
        for (var pi = 0; pi < pValues.length; pi++) {
          var pRow = pValues[pi];
          var pId = String(pRow[0] || "").trim();
          if (!pId) continue;
          periods.push({
            id: pId,
            savedAt: String(pRow[1] || "").trim(),
            platform: String(pRow[2] || "").trim(),
            shopName: String(pRow[3] || "").trim(),
            dateRange: String(pRow[4] || "").trim(),
            month: String(pRow[5] || "").trim(),
            totalOrders: Number(pRow[6]) || 0,
            returnOrders: Number(pRow[7]) || 0,
            revenue: Number(pRow[8]) || 0,
            goodsCost: Number(pRow[9]) || 0,
            adsCost: Number(pRow[10]) || 0,
            materialCost: Number(pRow[11]) || 0,
            otherExpenses: Number(pRow[12]) || 0,
            profit: Number(pRow[13]) || 0,
            note: (pRow[14] && String(pRow[14]).trim() !== "null" && String(pRow[14]).trim() !== "undefined") ? String(pRow[14]).trim() : ""
          });
        }
      }
      return ContentService.createTextOutput(JSON.stringify({
        status: "success",
        periods: periods
      })).setMimeType(ContentService.MimeType.JSON);
    }

    if (action === "getMonthlyReports") {
      var monthlySheet = spreadsheet.getSheetByName("monthly_reports") || 
                         spreadsheet.getSheetByName("doanh_thu_thang") ||
                         spreadsheet.getSheetByName("monthly");
      var reports = [];
      if (monthlySheet && monthlySheet.getLastRow() > 1) {
        var values = monthlySheet.getRange(2, 1, monthlySheet.getLastRow() - 1, 6).getValues();
        for (var i = 0; i < values.length; i++) {
          var row = values[i];
          var month = String(row[0] || "").trim();
          if (!month) continue;
          reports.push({
            month: month,
            revenue: Number(row[1]) || 0,
            profit: Number(row[2]) || 0,
            adsCost: Number(row[3]) || 0,
            materialCost: Number(row[4]) || 0,
            note: String(row[5] || "").trim()
          });
        }
      }
      return ContentService.createTextOutput(JSON.stringify({
        status: "success",
        reports: reports
      })).setMimeType(ContentService.MimeType.JSON);
    }

    if (action === "getShops") {
      var shopSheet = spreadsheet.getSheetByName("shops") || 
                      spreadsheet.getSheetByName("danh_sach_shop") ||
                      spreadsheet.getSheetByName("Shop");
      var shops = [];
      if (shopSheet && shopSheet.getLastRow() > 1) {
        var sValues = shopSheet.getRange(2, 1, shopSheet.getLastRow() - 1, Math.max(shopSheet.getLastColumn(), 6)).getValues();
        for (var si = 0; si < sValues.length; si++) {
          var sRow = sValues[si];
          var sName = String(sRow[1] || "").trim();
          if (!sName) continue;
          var prodJson = sRow[5] ? String(sRow[5]).trim() : "";
          var prods = [];
          if (prodJson) {
            try { prods = JSON.parse(prodJson); } catch (pe) {}
          }
          shops.push({
            id: String(sRow[0] || "").trim(),
            name: sName,
            platform: String(sRow[2] || "").trim(),
            feePercent: Number(sRow[3]) || 0,
            note: (sRow[4] && String(sRow[4]).trim() !== "null" && String(sRow[4]).trim() !== "undefined") ? String(sRow[4]).trim() : "",
            products: Array.isArray(prods) ? prods : []
          });
        }
      }
      return ContentService.createTextOutput(JSON.stringify({
        status: "success",
        shops: shops
      })).setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService.createTextOutput(JSON.stringify({
      status: "success",
      message: "Google Apps Script Sync & Logger is ready!"
    })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      status: "error",
      message: err.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}
