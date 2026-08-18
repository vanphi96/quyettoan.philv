/**
 * SHEET SYNC MODULE - ĐỒNG BỘ DỮ LIỆU SẢN PHẨM VỚI GOOGLE SHEET
 * Đồng bộ thủ công khi bấm nút "Lưu lên Sheet" (Không tự động đồng bộ khi gõ phím)
 */

const GOOGLE_APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbz3XjqoNWiFsal8z2bTqRSdMF3mvWYRW4BpsGD89czcL9_yUBmSOvqg6WNUIOw7i25PBA/exec';

let lastSyncTimestamp = null;
let isSyncInProgress = false;

function getGoogleAppsScriptUrl() {
    return GOOGLE_APPS_SCRIPT_URL;
}

function updateSyncBadge(badgeElementOrId, state, customText = '') {
    const el = typeof badgeElementOrId === 'string' ? document.getElementById(badgeElementOrId) : badgeElementOrId;
    if (!el) return;

    el.className = 'sheet-sync-badge';
    
    switch (state) {
        case 'syncing':
            el.classList.add('badge-syncing');
            el.innerHTML = `<span class="sync-spinner"></span> <span>${customText || 'Đang lưu lên Sheet...'}</span>`;
            break;
        case 'synced':
            el.classList.add('badge-synced');
            const time = lastSyncTimestamp ? new Date(lastSyncTimestamp).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
            el.innerHTML = `<span>⚡ Đã lưu lên Sheet ${time ? `(${time})` : ''}</span>`;
            break;
        case 'error':
            el.classList.add('badge-error');
            el.innerHTML = `<span>⚠️ ${customText || 'Lỗi lưu Sheet'}</span>`;
            break;
        case 'ready':
        default:
            el.classList.add('badge-ready');
            el.innerHTML = `<span>☁️ Google Sheet Sẵn sàng</span>`;
            break;
    }
}

function updateAllSyncBadges() {
    document.querySelectorAll('.sheet-sync-badge').forEach(badge => {
        if (isSyncInProgress) {
            updateSyncBadge(badge, 'syncing');
        } else if (lastSyncTimestamp) {
            updateSyncBadge(badge, 'synced');
        } else {
            updateSyncBadge(badge, 'ready');
        }
    });
}

/**
 * Gửi toàn bộ danh sách sản phẩm lên Google Sheet khi bấm nút "Lưu lên Sheet"
 * @param {Array} products Danh sách sản phẩm [{name, aliases, price}]
 * @param {Object} options { isManual: boolean, badgeId: string, source: string, onComplete: function }
 */
async function syncProductsToGoogleSheet(products, options = {}) {
    if (isSyncInProgress) {
        showToast('⏳ Đang có tiến trình lưu, vui lòng chờ trong giây lát...');
        return { success: false, reason: 'in_progress' };
    }

    const badgeId = options.badgeId || 'sheetSyncBadge';
    const webAppUrl = getGoogleAppsScriptUrl();
    const sourceName = options.source || document.title || 'Web App';

    if (!Array.isArray(products) || products.length === 0) {
        showToast('⚠️ Danh sách sản phẩm trống.');
        return { success: false, reason: 'empty_products' };
    }

    // Chuẩn hóa dữ liệu sản phẩm trước khi gửi
    const cleanProducts = products.map(p => {
        const name = String(p.name || '').trim();
        let aliases = [];
        if (Array.isArray(p.aliases)) {
            aliases = p.aliases.map(a => String(a || '').trim()).filter(Boolean);
        } else if (typeof p.aliases === 'string' && p.aliases.trim()) {
            aliases = p.aliases.split(/[\n,;]+/).map(a => a.trim()).filter(Boolean);
        }

        const price = Number(p.price) || 0;
        return {
            name: name,
            aliases: aliases,
            price: price
        };
    }).filter(p => p.name || p.price > 0 || (p.aliases && p.aliases.length > 0));

    // Disable tất cả các nút lưu tạm thời trong lúc gửi
    document.querySelectorAll('.btn-sheet-sync').forEach(btn => {
        btn.disabled = true;
        btn.dataset.originalText = btn.innerHTML;
        btn.innerHTML = '⏳ Đang lưu...';
    });

    isSyncInProgress = true;
    updateSyncBadge(badgeId, 'syncing');

    const resetButtons = () => {
        document.querySelectorAll('.btn-sheet-sync').forEach(btn => {
            btn.disabled = false;
            if (btn.dataset.originalText) {
                btn.innerHTML = btn.dataset.originalText;
            }
        });
    };

    try {
        const payload = {
            action: 'saveProducts',
            products: cleanProducts,
            source: sourceName,
            timestamp: new Date().toISOString()
        };

        const response = await fetch(webAppUrl, {
            method: 'POST',
            mode: 'cors',
            headers: {
                'Content-Type': 'text/plain;charset=utf-8'
            },
            body: JSON.stringify(payload)
        });

        isSyncInProgress = false;
        resetButtons();

        let result = null;
        try {
            result = await response.json();
        } catch (parseErr) {}

        if (response.ok || (result && result.status === 'success')) {
            lastSyncTimestamp = Date.now();
            updateSyncBadge(badgeId, 'synced');
            
            const changesMsg = result && result.changesCount !== undefined ? ` (${result.changesCount} thay đổi được ghi vào lịch sử)` : '';
            showToast(`✅ Đã lưu ${cleanProducts.length} sản phẩm lên Sheet thành công!${changesMsg}`);
            
            if (options.onComplete) options.onComplete(true, result);
            return { success: true, count: cleanProducts.length, result: result };
        } else {
            throw new Error((result && result.message) || `HTTP ${response.status}`);
        }
    } catch (err) {
        console.warn('Đang thử gửi với chế độ fallback no-cors...', err);
        
        try {
            await fetch(webAppUrl, {
                method: 'POST',
                mode: 'no-cors',
                headers: {
                    'Content-Type': 'text/plain;charset=utf-8'
                },
                body: JSON.stringify({
                    action: 'saveProducts',
                    products: cleanProducts,
                    source: sourceName
                })
            });

            isSyncInProgress = false;
            resetButtons();

            lastSyncTimestamp = Date.now();
            updateSyncBadge(badgeId, 'synced');
            showToast(`✅ Đã gửi lệnh lưu ${cleanProducts.length} sản phẩm lên Google Sheet!`);
            
            if (options.onComplete) options.onComplete(true);
            return { success: true, count: cleanProducts.length, note: 'no-cors-fallback' };
        } catch (fallbackErr) {
            isSyncInProgress = false;
            resetButtons();

            console.error('Lỗi khi lưu lên Google Sheet:', fallbackErr);
            updateSyncBadge(badgeId, 'error', 'Lỗi đồng bộ Sheet');
            showToast(`❌ Không thể lưu lên Google Sheet: ${err.message || 'Lỗi kết nối'}`);
            
            if (options.onComplete) options.onComplete(false, err);
            return { success: false, error: err };
        }
    }
}

/**
 * Gửi toàn bộ danh sách báo cáo tháng lên Google Sheet khi bấm nút "Lưu lên Sheet"
 * @param {Array} reports Danh sách báo cáo [{month, revenue, profit, adsCost, materialCost, note}]
 * @param {Object} options { isManual: boolean, badgeId: string, source: string, onComplete: function }
 */
async function syncMonthlyReportsToGoogleSheet(reports, options = {}) {
    if (isSyncInProgress) {
        showToast('⏳ Đang có tiến trình lưu, vui lòng chờ trong giây lát...');
        return { success: false, reason: 'in_progress' };
    }

    const badgeId = options.badgeId || 'sheetSyncBadge';
    const webAppUrl = getGoogleAppsScriptUrl();
    const sourceName = options.source || 'Báo Cáo Doanh Thu Tháng';

    if (!Array.isArray(reports) || reports.length === 0) {
        showToast('⚠️ Danh sách báo cáo tháng trống.');
        return { success: false, reason: 'empty_reports' };
    }

    // Chuẩn hóa dữ liệu báo cáo
    const cleanReports = reports.map(r => ({
        month: String(r.month || '').trim(),
        revenue: Number(r.revenue) || 0,
        profit: Number(r.profit) || 0,
        adsCost: Number(r.adsCost !== undefined ? r.adsCost : r.ads) || 0,
        materialCost: Number(r.materialCost !== undefined ? r.materialCost : r.materials) || 0,
        note: String(r.note || '').trim()
    })).filter(r => r.month);

    // Disable nút bấm
    document.querySelectorAll('.btn-sheet-sync').forEach(btn => {
        btn.disabled = true;
        btn.dataset.originalText = btn.innerHTML;
        btn.innerHTML = '⏳ Đang lưu...';
    });

    isSyncInProgress = true;
    updateSyncBadge(badgeId, 'syncing');

    const resetButtons = () => {
        document.querySelectorAll('.btn-sheet-sync').forEach(btn => {
            btn.disabled = false;
            if (btn.dataset.originalText) {
                btn.innerHTML = btn.dataset.originalText;
            }
        });
    };

    try {
        const payload = {
            action: 'saveMonthlyReports',
            monthlyReports: cleanReports,
            source: sourceName,
            timestamp: new Date().toISOString()
        };

        const response = await fetch(webAppUrl, {
            method: 'POST',
            mode: 'cors',
            headers: {
                'Content-Type': 'text/plain;charset=utf-8'
            },
            body: JSON.stringify(payload)
        });

        isSyncInProgress = false;
        resetButtons();

        let result = null;
        try {
            result = await response.json();
        } catch (parseErr) {}

        if (response.ok || (result && result.status === 'success')) {
            lastSyncTimestamp = Date.now();
            updateSyncBadge(badgeId, 'synced');
            
            const changesMsg = result && result.changesCount !== undefined ? ` (${result.changesCount} thay đổi được ghi vào lịch sử)` : '';
            showToast(`✅ Đã lưu ${cleanReports.length} tháng báo cáo lên Sheet thành công!${changesMsg}`);
            
            if (options.onComplete) options.onComplete(true, result);
            return { success: true, count: cleanReports.length, result: result };
        } else {
            throw new Error((result && result.message) || `HTTP ${response.status}`);
        }
    } catch (err) {
        console.warn('Đang thử gửi với chế độ fallback no-cors...', err);
        
        try {
            await fetch(webAppUrl, {
                method: 'POST',
                mode: 'no-cors',
                headers: {
                    'Content-Type': 'text/plain;charset=utf-8'
                },
                body: JSON.stringify({
                    action: 'saveMonthlyReports',
                    monthlyReports: cleanReports,
                    source: sourceName
                })
            });

            isSyncInProgress = false;
            resetButtons();

            lastSyncTimestamp = Date.now();
            updateSyncBadge(badgeId, 'synced');
            showToast(`✅ Đã gửi lệnh lưu ${cleanReports.length} tháng báo cáo lên Google Sheet!`);
            
            if (options.onComplete) options.onComplete(true);
            return { success: true, count: cleanReports.length, note: 'no-cors-fallback' };
        } catch (fallbackErr) {
            isSyncInProgress = false;
            resetButtons();

            console.error('Lỗi khi lưu báo cáo tháng lên Google Sheet:', fallbackErr);
            updateSyncBadge(badgeId, 'error', 'Lỗi đồng bộ Sheet');
            showToast(`❌ Không thể lưu lên Google Sheet: ${err.message || 'Lỗi kết nối'}`);
            
            if (options.onComplete) options.onComplete(false, err);
            return { success: false, error: err };
        }
    }
}

/**
 * =============================================================================
 * KỲ QUYẾT TOÁN CHI TIẾT (10-15 NGÀY THEO SHOP) - STORAGE & SYNC
 * =============================================================================
 */
const SETTLEMENT_PERIODS_STORAGE_KEY = 'settlement_periods_data';
const KNOWN_SHOPS_STORAGE_KEY = 'known_shop_names';

function getKnownShops(platform = '') {
    let list = ['Shopee Shop 1', 'Shopee Shop 2', 'TikTok Shop 1'];
    try {
        const saved = localStorage.getItem(KNOWN_SHOPS_STORAGE_KEY);
        if (saved) {
            const parsed = JSON.parse(saved);
            if (Array.isArray(parsed) && parsed.length > 0) {
                list = Array.from(new Set([...list, ...parsed]));
            }
        }
    } catch (e) {}

    if (platform === 'Shopee') {
        return list.filter(s => !s.toLowerCase().includes('tiktok'));
    } else if (platform === 'TikTok' || platform === 'TikTok Shop') {
        return list.filter(s => !s.toLowerCase().includes('shopee'));
    }
    return list;
}

function saveKnownShop(shopName) {
    if (!shopName || typeof shopName !== 'string') return;
    const name = shopName.trim();
    if (!name) return;
    try {
        const current = getKnownShops();
        if (!current.includes(name)) {
            current.push(name);
            localStorage.setItem(KNOWN_SHOPS_STORAGE_KEY, JSON.stringify(current));
        }
    } catch (e) {}
}

function getLocalSettlementPeriods() {
    try {
        const saved = localStorage.getItem(SETTLEMENT_PERIODS_STORAGE_KEY);
        if (saved) {
            const parsed = JSON.parse(saved);
            if (Array.isArray(parsed)) return parsed;
        }
    } catch (e) {}
    return [];
}

function saveLocalSettlementPeriods(periods) {
    try {
        localStorage.setItem(SETTLEMENT_PERIODS_STORAGE_KEY, JSON.stringify(periods || []));
    } catch (e) {}
}

/**
 * Lưu 1 kỳ quyết toán lên Google Sheet và LocalStorage
 */
async function syncSingleSettlementPeriod(periodData, options = {}) {
    const webAppUrl = getGoogleAppsScriptUrl();
    const sourceName = options.source || 'Quyết toán';
    const badgeId = options.badgeId || 'sheetSyncBadge';

    // Lưu vào LocalStorage trước
    const periods = getLocalSettlementPeriods();
    const pId = periodData.id || `PERIOD_${Date.now()}`;
    const pIndex = periods.findIndex(p => p.id === pId);

    const cleanItem = {
        id: pId,
        savedAt: periodData.savedAt || new Date().toLocaleString('vi-VN'),
        platform: String(periodData.platform || '').trim(),
        shopName: String(periodData.shopName || '').trim(),
        dateRange: String(periodData.dateRange || '').trim(),
        month: String(periodData.month || '').trim(),
        totalOrders: Number(periodData.totalOrders) || 0,
        returnOrders: Number(periodData.returnOrders) || 0,
        revenue: Number(periodData.revenue) || 0,
        goodsCost: Number(periodData.goodsCost) || 0,
        adsCost: Number(periodData.adsCost) || 0,
        materialCost: Number(periodData.materialCost) || 0,
        otherExpenses: Number(periodData.otherExpenses) || 0,
        profit: Number(periodData.profit) || 0,
        note: String(periodData.note || '').trim()
    };

    saveKnownShop(cleanItem.shopName);

    if (pIndex >= 0) {
        periods[pIndex] = cleanItem;
    } else {
        periods.unshift(cleanItem); // Kỳ mới nhất lên đầu
    }
    saveLocalSettlementPeriods(periods);

    // Đồng bộ lên Google Sheet
    updateSyncBadge(badgeId, 'syncing', 'Đang lưu kỳ lên Sheet...');
    try {
        const payload = {
            action: 'saveSettlementPeriod',
            period: cleanItem,
            source: sourceName,
            timestamp: new Date().toISOString()
        };

        const response = await fetch(webAppUrl, {
            method: 'POST',
            mode: 'cors',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify(payload)
        });

        updateSyncBadge(badgeId, 'synced');
        showToast(`✅ Đã lưu kỳ quyết toán [${cleanItem.shopName}] (${cleanItem.dateRange}) lên Google Sheet!`);
        return { success: true, item: cleanItem };
    } catch (err) {
        console.warn('Lỗi kết nối cors khi lưu kỳ quyết toán, fallback no-cors:', err);
        try {
            await fetch(webAppUrl, {
                method: 'POST',
                mode: 'no-cors',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify({ action: 'saveSettlementPeriod', period: cleanItem, source: sourceName })
            });
            updateSyncBadge(badgeId, 'synced');
            showToast(`✅ Đã gửi lệnh lưu kỳ quyết toán lên Google Sheet!`);
            return { success: true, item: cleanItem, fallback: true };
        } catch (fErr) {
            updateSyncBadge(badgeId, 'ready');
            showToast(`ℹ️ Đã lưu kỳ quyết toán vào bộ nhớ máy (Không kết nối được Google Sheet).`);
            return { success: true, item: cleanItem, localOnly: true };
        }
    }
}

/**
 * Lưu toàn bộ danh sách kỳ quyết toán lên Google Sheet
 */
async function syncAllSettlementPeriodsToGoogleSheet(periodsList, options = {}) {
    const webAppUrl = getGoogleAppsScriptUrl();
    const sourceName = options.source || 'Báo Cáo Tháng';
    const badgeId = options.badgeId || 'sheetSyncBadge';

    if (!Array.isArray(periodsList) || periodsList.length === 0) {
        showToast('⚠️ Không có kỳ quyết toán nào để lưu.');
        return { success: false };
    }

    updateSyncBadge(badgeId, 'syncing', 'Đang lưu các kỳ...');
    try {
        const payload = {
            action: 'saveSettlementPeriods',
            settlementPeriods: periodsList,
            source: sourceName,
            timestamp: new Date().toISOString()
        };

        const response = await fetch(webAppUrl, {
            method: 'POST',
            mode: 'cors',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify(payload)
        });

        updateSyncBadge(badgeId, 'synced');
        showToast(`✅ Đã lưu ${periodsList.length} kỳ quyết toán lên Google Sheet!`);
        return { success: true };
    } catch (err) {
        try {
            await fetch(webAppUrl, {
                method: 'POST',
                mode: 'no-cors',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify({ action: 'saveSettlementPeriods', settlementPeriods: periodsList, source: sourceName })
            });
            updateSyncBadge(badgeId, 'synced');
            showToast(`✅ Đã gửi lệnh lưu ${periodsList.length} kỳ quyết toán lên Google Sheet!`);
            return { success: true, fallback: true };
        } catch (fErr) {
            updateSyncBadge(badgeId, 'error', 'Lỗi đồng bộ');
            showToast(`❌ Không thể lưu lên Sheet: ${err.message}`);
            return { success: false, error: err };
        }
    }
}

/**
 * Tải danh sách kỳ quyết toán từ Google Sheet
 */
async function fetchSettlementPeriodsFromGoogleSheet() {
    const webAppUrl = `${getGoogleAppsScriptUrl()}?action=getSettlementPeriods&_t=${Date.now()}`;
    try {
        const res = await fetch(webAppUrl);
        const data = await res.json();
        if (data && data.status === 'success' && Array.isArray(data.periods)) {
            return data.periods;
        }
    } catch (e) {
        console.warn('Không thể tải kỳ quyết toán qua Web App API:', e);
    }
    return null;
}

// Dialog callback reference
let activeSettlementSaveCallback = null;

function formatSpMoney(num) {
    const n = Number(num) || 0;
    return `${Math.round(n).toLocaleString('vi-VN')} đ`;
}

function parseSpNumber(val) {
    if (typeof val === 'number') return Math.round(val);
    if (!val) return 0;
    const digits = String(val).replace(/[^\d-]/g, '');
    return parseInt(digits, 10) || 0;
}

function prepareSpDialogInput(input) {
    const raw = String(input.value || '').trim();
    const num = parseSpNumber(raw);
    input.value = num === 0 ? '' : String(num);
    input.select();
}

function formatSpDialogInput(input) {
    const num = parseSpNumber(input.value);
    input.value = num.toLocaleString('vi-VN');
}

function calcSpDialogProfit() {
    const rev = parseSpNumber(document.getElementById('spDialogRevenue')?.value);
    const goods = parseSpNumber(document.getElementById('spDialogGoodsCost')?.value);
    const ads = parseSpNumber(document.getElementById('spDialogAdsCost')?.value);
    const mat = parseSpNumber(document.getElementById('spDialogMaterialCost')?.value);
    const other = parseSpNumber(document.getElementById('spDialogOtherExpenses')?.value);

    const profit = rev - goods - ads - mat - other;
    const profitEl = document.getElementById('spDialogProfitDisplay');
    if (profitEl) {
        profitEl.textContent = formatSpMoney(profit);
        profitEl.style.color = profit >= 0 ? '#16a34a' : '#dc2626';
    }
}

function onSpDialogPlatformChange() {
    const plat = document.getElementById('spDialogPlatform')?.value || '';
    populateSpDialogShops(plat);
}

function populateSpDialogShops(platform = '', selectedShop = '') {
    const select = document.getElementById('spDialogShopSelect');
    const custom = document.getElementById('spDialogShopCustom');
    if (!select) return;

    const shops = getKnownShops(platform);
    select.innerHTML = '';
    
    shops.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s;
        opt.textContent = s;
        select.appendChild(opt);
    });

    const otherOpt = document.createElement('option');
    otherOpt.value = '__custom__';
    otherOpt.textContent = '+ Nhập tên shop khác...';
    select.appendChild(otherOpt);

    if (selectedShop && shops.includes(selectedShop)) {
        select.value = selectedShop;
        if (custom) custom.style.display = 'none';
    } else if (selectedShop) {
        select.value = '__custom__';
        if (custom) {
            custom.style.display = 'block';
            custom.value = selectedShop;
        }
    } else {
        if (custom) custom.style.display = 'none';
    }
}

function onSpDialogShopSelectChange(select) {
    const custom = document.getElementById('spDialogShopCustom');
    if (select.value === '__custom__') {
        if (custom) {
            custom.style.display = 'block';
            custom.focus();
        }
    } else {
        if (custom) {
            custom.style.display = 'none';
            custom.value = '';
        }
    }
}

function closeSaveSettlementPeriodDialog() {
    const modal = document.getElementById('settlementPeriodSaveModal');
    if (modal) modal.style.display = 'none';
}

/**
 * Mở modal Lưu Kỳ Quyết Toán vào Báo Cáo Tháng
 * @param {Object} data Dữ liệu quyết toán { platform, shopName, startDate, endDate, totalOrders, returnOrders, revenue, goodsCost, adsCost, materialCost, otherExpenses, profit, note }
 * @param {Function} onSavedCallback Hàm callback khi lưu thành công
 */
function showSaveSettlementPeriodDialog(data = {}, onSavedCallback = null) {
    activeSettlementSaveCallback = onSavedCallback;
    let modalOverlay = document.getElementById('settlementPeriodSaveModal');
    
    if (!modalOverlay) {
        modalOverlay = document.createElement('div');
        modalOverlay.id = 'settlementPeriodSaveModal';
        modalOverlay.className = 'sync-modal-overlay';
        modalOverlay.innerHTML = `
            <div class="sync-modal-card" style="max-width: 580px; max-height: calc(100vh - 32px); display: flex; flex-direction: column;">
                <div class="sync-modal-header">
                    <h3 style="display: flex; align-items: center; gap: 8px;">
                        <span>📌</span> Lưu Kỳ Quyết Toán Vào Báo Cáo Tháng
                    </h3>
                    <button type="button" class="sync-modal-close" onclick="closeSaveSettlementPeriodDialog()">✕</button>
                </div>
                <form id="saveSettlementPeriodForm" style="display: flex; flex-direction: column; flex: 1; min-height: 0; overflow: hidden;" onsubmit="handleSaveSettlementPeriodFormSubmit(event)">
                    <div class="sync-modal-body" style="flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 14px;">
                        
                        <!-- CHỌN SÀN & TÊN SHOP -->
                        <div style="display: grid; grid-template-columns: 1fr 1.6fr; gap: 12px;">
                            <div>
                                <label style="display: block; font-size: 13px; font-weight: 700; color: #334155; margin-bottom: 5px;">Sàn TMĐT:</label>
                                <select id="spDialogPlatform" style="width: 100%; padding: 9px 12px; border: 1px solid #cbd5e1; border-radius: 8px; font-family: inherit; font-size: 14px; font-weight: 600;" onchange="onSpDialogPlatformChange()">
                                    <option value="Shopee">Shopee</option>
                                    <option value="TikTok Shop">TikTok Shop</option>
                                </select>
                            </div>
                            <div>
                                <label style="display: block; font-size: 13px; font-weight: 700; color: #334155; margin-bottom: 5px;">Tên Shop:</label>
                                <div style="display: flex; flex-direction: column; gap: 6px;">
                                    <select id="spDialogShopSelect" style="width: 100%; padding: 9px 12px; border: 1px solid #cbd5e1; border-radius: 8px; font-family: inherit; font-size: 14px; font-weight: 600;" onchange="onSpDialogShopSelectChange(this)">
                                    </select>
                                    <input type="text" id="spDialogShopCustom" style="display: none; width: 100%; padding: 9px 12px; border: 1px solid #cbd5e1; border-radius: 8px; font-family: inherit; font-size: 14px; font-weight: 600;" placeholder="Nhập tên shop mới...">
                                </div>
                            </div>
                        </div>

                        <!-- THỜI GIAN QUYẾT TOÁN (KHOẢNG NGÀY & THÁNG ÁP DỤNG) -->
                        <div style="display: grid; grid-template-columns: 1.2fr 1fr; gap: 12px;">
                            <div>
                                <label style="display: block; font-size: 13px; font-weight: 700; color: #334155; margin-bottom: 5px;">Khoảng ngày quyết toán:</label>
                                <input type="text" id="spDialogDateRange" style="width: 100%; padding: 9px 12px; border: 1px solid #cbd5e1; border-radius: 8px; font-family: inherit; font-size: 14px; font-weight: 600;" placeholder="vd: 01/08 - 15/08/2026" required>
                            </div>
                            <div>
                                <label style="display: block; font-size: 13px; font-weight: 700; color: #334155; margin-bottom: 5px;">Áp dụng cho Tháng:</label>
                                <div style="display: flex; gap: 6px;">
                                    <select id="spDialogMonth" style="flex: 1.3; padding: 9px 6px; border: 1px solid #cbd5e1; border-radius: 8px; font-family: inherit; font-size: 14px; font-weight: 600;">
                                        <option value="01">Tháng 1</option>
                                        <option value="02">Tháng 2</option>
                                        <option value="03">Tháng 3</option>
                                        <option value="04">Tháng 4</option>
                                        <option value="05">Tháng 5</option>
                                        <option value="06">Tháng 6</option>
                                        <option value="07">Tháng 7</option>
                                        <option value="08" selected>Tháng 8</option>
                                        <option value="09">Tháng 9</option>
                                        <option value="10">Tháng 10</option>
                                        <option value="11">Tháng 11</option>
                                        <option value="12">Tháng 12</option>
                                    </select>
                                    <select id="spDialogYear" style="flex: 1; padding: 9px 6px; border: 1px solid #cbd5e1; border-radius: 8px; font-family: inherit; font-size: 14px; font-weight: 600;">
                                        <option value="2024">2024</option>
                                        <option value="2025">2025</option>
                                        <option value="2026" selected>2026</option>
                                        <option value="2027">2027</option>
                                        <option value="2028">2028</option>
                                    </select>
                                </div>
                            </div>
                        </div>

                        <!-- SỐ ĐƠN & HOÀN HỦY -->
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                            <div>
                                <label style="display: block; font-size: 13px; font-weight: 700; color: #334155; margin-bottom: 5px;">📦 Tổng số đơn hàng:</label>
                                <input type="number" id="spDialogTotalOrders" style="width: 100%; padding: 9px 12px; border: 1px solid #cbd5e1; border-radius: 8px; font-family: inherit; font-size: 14px; font-weight: 700; text-align: right;" placeholder="0">
                            </div>
                            <div>
                                <label style="display: block; font-size: 13px; font-weight: 700; color: #334155; margin-bottom: 5px;">🔄 Số đơn hoàn / hủy:</label>
                                <input type="number" id="spDialogReturnOrders" style="width: 100%; padding: 9px 12px; border: 1px solid #cbd5e1; border-radius: 8px; font-family: inherit; font-size: 14px; font-weight: 700; text-align: right;" placeholder="0">
                            </div>
                        </div>

                        <!-- SỐ TIỀN CHI TIẾT -->
                        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 14px; display: flex; flex-direction: column; gap: 10px;">
                            <div style="font-size: 13px; font-weight: 700; color: #1e293b; margin-bottom: 2px;">💰 Chi tiết tài chính kỳ quyết toán:</div>
                            
                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                                <div>
                                    <label style="display: block; font-size: 12px; font-weight: 600; color: #475569; margin-bottom: 4px;">Doanh thu quyết toán (VNĐ):</label>
                                    <input type="text" id="spDialogRevenue" style="width: 100%; padding: 8px 12px; border: 1px solid #cbd5e1; border-radius: 8px; font-family: inherit; font-size: 14px; font-weight: 700; text-align: right; color: #0284c7;" onfocus="prepareSpDialogInput(this)" oninput="calcSpDialogProfit()" onblur="formatSpDialogInput(this)">
                                </div>
                                <div>
                                    <label style="display: block; font-size: 12px; font-weight: 600; color: #475569; margin-bottom: 4px;">Tiền hàng / Giá nhập (VNĐ):</label>
                                    <input type="text" id="spDialogGoodsCost" style="width: 100%; padding: 8px 12px; border: 1px solid #cbd5e1; border-radius: 8px; font-family: inherit; font-size: 14px; font-weight: 700; text-align: right;" onfocus="prepareSpDialogInput(this)" oninput="calcSpDialogProfit()" onblur="formatSpDialogInput(this)">
                                </div>
                            </div>

                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                                <div>
                                    <label style="display: block; font-size: 12px; font-weight: 600; color: #475569; margin-bottom: 4px;">Chi phí Quảng cáo (VNĐ):</label>
                                    <input type="text" id="spDialogAdsCost" style="width: 100%; padding: 8px 12px; border: 1px solid #cbd5e1; border-radius: 8px; font-family: inherit; font-size: 14px; font-weight: 700; text-align: right; color: #d97706;" onfocus="prepareSpDialogInput(this)" oninput="calcSpDialogProfit()" onblur="formatSpDialogInput(this)">
                                </div>
                                <div>
                                    <label style="display: block; font-size: 12px; font-weight: 600; color: #475569; margin-bottom: 4px;">Chi phí Vật tư / Đóng gói (VNĐ):</label>
                                    <input type="text" id="spDialogMaterialCost" style="width: 100%; padding: 8px 12px; border: 1px solid #cbd5e1; border-radius: 8px; font-family: inherit; font-size: 14px; font-weight: 700; text-align: right; color: #7c3aed;" onfocus="prepareSpDialogInput(this)" oninput="calcSpDialogProfit()" onblur="formatSpDialogInput(this)">
                                </div>
                            </div>

                            <div>
                                <label style="display: block; font-size: 12px; font-weight: 600; color: #475569; margin-bottom: 4px;">Chi phí khác (VNĐ):</label>
                                <input type="text" id="spDialogOtherExpenses" style="width: 100%; padding: 8px 12px; border: 1px solid #cbd5e1; border-radius: 8px; font-family: inherit; font-size: 14px; font-weight: 700; text-align: right;" onfocus="prepareSpDialogInput(this)" oninput="calcSpDialogProfit()" onblur="formatSpDialogInput(this)">
                            </div>
                        </div>

                        <!-- LIVE PROFIT PREVIEW -->
                        <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 10px; padding: 12px 16px; display: flex; align-items: center; justify-content: space-between;">
                            <span style="font-size: 13px; font-weight: 700; color: #166534;">💵 Lợi Nhuận Tạm Tính:</span>
                            <span id="spDialogProfitDisplay" style="font-size: 18px; font-weight: 800; color: #16a34a;">0 đ</span>
                        </div>

                        <!-- GHI CHÚ -->
                        <div>
                            <label style="display: block; font-size: 13px; font-weight: 700; color: #334155; margin-bottom: 5px;">Ghi chú (Tùy chọn):</label>
                            <input type="text" id="spDialogNote" style="width: 100%; padding: 9px 12px; border: 1px solid #cbd5e1; border-radius: 8px; font-family: inherit; font-size: 14px;" placeholder="Ghi chú thêm...">
                        </div>
                    </div>
                    
                    <div class="sync-modal-footer">
                        <button type="button" class="btn-sheet-setting" onclick="closeSaveSettlementPeriodDialog()">Hủy</button>
                        <button type="submit" class="btn-sheet-sync" style="padding: 9px 18px; font-size: 14px; background: #2563eb;" id="spDialogSubmitBtn">
                            💾 Lưu Kỳ Quyết Toán
                        </button>
                    </div>
                </form>
            </div>
        `;
        document.body.appendChild(modalOverlay);
    }

    // Điền dữ liệu mặc định vào modal
    const platform = data.platform || (document.title.includes('Shopee') ? 'Shopee' : 'TikTok Shop');
    const platEl = document.getElementById('spDialogPlatform');
    if (platEl) platEl.value = platform;
    
    populateSpDialogShops(platform, data.shopName || (platform === 'Shopee' ? 'Shopee Shop 1' : 'TikTok Shop 1'));

    // Khoảng ngày
    const rangeEl = document.getElementById('spDialogDateRange');
    let dateRangeStr = data.dateRange || '';
    if (!dateRangeStr && data.startDate && data.endDate) {
        dateRangeStr = `${data.startDate} - ${data.endDate}`;
    }
    if (rangeEl) rangeEl.value = dateRangeStr;

    // Tháng áp dụng
    const now = new Date();
    let selM = String(now.getMonth() + 1).padStart(2, '0');
    let selY = String(now.getFullYear());
    if (data.month) {
        const parts = String(data.month).split(/[-/]/);
        if (parts.length === 2) {
            if (parts[0].length === 4) { selY = parts[0]; selM = parts[1].padStart(2, '0'); }
            else if (parts[1].length === 4) { selY = parts[1]; selM = parts[0].padStart(2, '0'); }
        }
    } else if (data.endDate) {
        const endParts = String(data.endDate).split(/[-/]/);
        if (endParts.length === 3) {
            if (endParts[0].length === 4) { selY = endParts[0]; selM = endParts[1].padStart(2, '0'); }
            else if (endParts[2].length === 4) { selY = endParts[2]; selM = endParts[1].padStart(2, '0'); }
        }
    }

    const monthEl = document.getElementById('spDialogMonth');
    const yearEl = document.getElementById('spDialogYear');
    if (monthEl) monthEl.value = selM;
    if (yearEl) yearEl.value = selY;

    // Các số liệu
    document.getElementById('spDialogTotalOrders').value = data.totalOrders || '';
    document.getElementById('spDialogReturnOrders').value = data.returnOrders || '';
    document.getElementById('spDialogRevenue').value = (Number(data.revenue) || 0).toLocaleString('vi-VN');
    document.getElementById('spDialogGoodsCost').value = (Number(data.goodsCost) || 0).toLocaleString('vi-VN');
    document.getElementById('spDialogAdsCost').value = (Number(data.adsCost) || 0).toLocaleString('vi-VN');
    document.getElementById('spDialogMaterialCost').value = (Number(data.materialCost) || 0).toLocaleString('vi-VN');
    document.getElementById('spDialogOtherExpenses').value = (Number(data.otherExpenses) || 0).toLocaleString('vi-VN');
    document.getElementById('spDialogNote').value = data.note || '';

    calcSpDialogProfit();
    modalOverlay.style.display = 'flex';
}

async function handleSaveSettlementPeriodFormSubmit(event) {
    event.preventDefault();
    const plat = document.getElementById('spDialogPlatform')?.value || 'Shopee';
    const shopSelect = document.getElementById('spDialogShopSelect')?.value;
    const customShop = document.getElementById('spDialogShopCustom')?.value?.trim();
    const shopName = (shopSelect === '__custom__' ? customShop : shopSelect) || (plat === 'Shopee' ? 'Shopee Shop 1' : 'TikTok Shop 1');

    const dateRange = document.getElementById('spDialogDateRange')?.value?.trim() || '';
    const m = document.getElementById('spDialogMonth')?.value || '08';
    const y = document.getElementById('spDialogYear')?.value || '2026';
    const month = `${y}-${m}`;

    const totalOrders = parseInt(document.getElementById('spDialogTotalOrders')?.value, 10) || 0;
    const returnOrders = parseInt(document.getElementById('spDialogReturnOrders')?.value, 10) || 0;
    const revenue = parseSpNumber(document.getElementById('spDialogRevenue')?.value);
    const goodsCost = parseSpNumber(document.getElementById('spDialogGoodsCost')?.value);
    const adsCost = parseSpNumber(document.getElementById('spDialogAdsCost')?.value);
    const materialCost = parseSpNumber(document.getElementById('spDialogMaterialCost')?.value);
    const otherExpenses = parseSpNumber(document.getElementById('spDialogOtherExpenses')?.value);
    const profit = revenue - goodsCost - adsCost - materialCost - otherExpenses;
    const note = document.getElementById('spDialogNote')?.value?.trim() || '';

    const periodItem = {
        id: `PERIOD_${Date.now()}`,
        savedAt: new Date().toLocaleString('vi-VN'),
        platform: plat,
        shopName: shopName,
        dateRange: dateRange,
        month: month,
        totalOrders: totalOrders,
        returnOrders: returnOrders,
        revenue: revenue,
        goodsCost: goodsCost,
        adsCost: adsCost,
        materialCost: materialCost,
        otherExpenses: otherExpenses,
        profit: profit,
        note: note
    };

    closeSaveSettlementPeriodDialog();
    const res = await syncSingleSettlementPeriod(periodItem, { source: document.title || 'Quyết toán' });

    if (typeof activeSettlementSaveCallback === 'function') {
        activeSettlementSaveCallback(res);
    }
}

/**
 * Toast thông báo nhanh
 */
function showToast(message, duration = 3500) {
    let toast = document.getElementById('globalAppToast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'globalAppToast';
        toast.className = 'app-toast';
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => {
        toast.classList.remove('show');
    }, duration);
}
