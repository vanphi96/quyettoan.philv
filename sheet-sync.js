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
 * QUẢN LÝ SHOP & CẤU HÌNH PHÍ SÀN (SHOPEE & TIKTOK SHOP)
 * =============================================================================
 */
const APP_SHOPS_STORAGE_KEY = 'app_shops_config_v2';
const KNOWN_SHOPS_STORAGE_KEY = 'known_shop_names';

const DEFAULT_APP_SHOPS = [
    { 
        id: 'SHOP_1', 
        name: 'Shopee Shop 1', 
        platform: 'Shopee', 
        feePercent: 14.5, 
        note: 'Shop chính Shopee',
        products: []
    },
    { 
        id: 'SHOP_2', 
        name: 'Shopee Shop 2', 
        platform: 'Shopee', 
        feePercent: 14.5, 
        note: 'Shop phụ Shopee',
        products: []
    },
    { 
        id: 'SHOP_3', 
        name: 'TikTok Shop 1', 
        platform: 'TikTok Shop', 
        feePercent: 14.0, 
        note: 'Shop chính TikTok',
        products: []
    },
    { 
        id: 'SHOP_4', 
        name: 'TikTok Shop 2', 
        platform: 'TikTok Shop', 
        feePercent: 14.0, 
        note: 'Shop phụ TikTok',
        products: []
    }
];

/**
 * Lấy danh sách Shop theo Sàn hoặc tất cả
 */
function getAppShops(platform = '') {
    let list = DEFAULT_APP_SHOPS;
    try {
        const saved = localStorage.getItem(APP_SHOPS_STORAGE_KEY);
        if (saved) {
            const parsed = JSON.parse(saved);
            if (Array.isArray(parsed) && parsed.length > 0) {
                list = parsed;
            }
        } else {
            // Khởi tạo mặc định lần đầu
            localStorage.setItem(APP_SHOPS_STORAGE_KEY, JSON.stringify(DEFAULT_APP_SHOPS));
        }
    } catch (e) {}

    if (!platform || platform === 'all') return list;

    const normP = String(platform).toLowerCase();
    if (normP.includes('shopee')) {
        return list.filter(s => String(s.platform).toLowerCase().includes('shopee'));
    } else if (normP.includes('tiktok')) {
        return list.filter(s => String(s.platform).toLowerCase().includes('tiktok'));
    }
    return list;
}

/**
 * Lưu danh sách Shop vào LocalStorage & Đồng bộ Google Sheet
 */
function saveAppShops(shopsList, syncToSheet = true) {
    if (!Array.isArray(shopsList)) return;
    try {
        localStorage.setItem(APP_SHOPS_STORAGE_KEY, JSON.stringify(shopsList));
    } catch (e) {}
    if (syncToSheet) {
        syncShopsToGoogleSheet(shopsList);
    }
}

/**
 * Thêm hoặc Cập nhật thông tin Shop
 */
function addOrUpdateAppShop(shop) {
    if (!shop || !shop.name) return;
    const shops = getAppShops();
    const cleanShop = {
        id: shop.id || `SHOP_${Date.now()}`,
        name: String(shop.name).trim(),
        platform: String(shop.platform || 'Shopee').trim(),
        feePercent: Number(shop.feePercent) || 0,
        note: String(shop.note || '').trim(),
        products: Array.isArray(shop.products) ? shop.products : []
    };
    const idx = shops.findIndex(s => s.id === cleanShop.id || s.name.toLowerCase() === cleanShop.name.toLowerCase());
    if (idx >= 0) {
        cleanShop.products = Array.isArray(shop.products) ? shop.products : (shops[idx].products || []);
        shops[idx] = { ...shops[idx], ...cleanShop };
    } else {
        shops.push(cleanShop);
    }
    saveAppShops(shops);
    return cleanShop;
}

/**
 * Xóa Shop theo ID
 */
function deleteAppShop(shopId) {
    let shops = getAppShops();
    shops = shops.filter(s => s.id !== shopId && s.name !== shopId);
    saveAppShops(shops);
    return shops;
}

/**
 * Lấy danh sách sản phẩm của 1 Shop
 */
function getShopProducts(shopId) {
    const shops = getAppShops();
    const shop = shops.find(s => s.id === shopId || s.name === shopId);
    return (shop && Array.isArray(shop.products)) ? shop.products : [];
}

/**
 * Thêm hoặc Cập nhật sản phẩm của Shop
 */
function addOrUpdateShopProduct(shopId, productData) {
    if (!shopId || !productData || !productData.name) return null;
    const shops = getAppShops();
    const shop = shops.find(s => s.id === shopId || s.name === shopId);
    if (!shop) return null;

    if (!Array.isArray(shop.products)) shop.products = [];

    const cleanProduct = {
        id: productData.id || `SP_${shop.id}_${Date.now()}`,
        name: String(productData.name).trim(),
        variation: String(productData.variation || 'Mặc định').trim(),
        items: Array.isArray(productData.items) ? productData.items : [],
        deal: productData.deal || { buyQty: 1, giftQty: 0, giftProductId: 'self' },
        price: Number(productData.price) || 0,
        packagingFee: Number(productData.packagingFee) || 0,
        note: String(productData.note || '').trim()
    };

    const pIdx = shop.products.findIndex(p => p.id === cleanProduct.id);
    if (pIdx >= 0) {
        shop.products[pIdx] = { ...shop.products[pIdx], ...cleanProduct };
    } else {
        shop.products.push(cleanProduct);
    }

    saveAppShops(shops);
    return cleanProduct;
}

/**
 * Xóa sản phẩm của Shop
 */
function deleteShopProduct(shopId, productId) {
    const shops = getAppShops();
    const shop = shops.find(s => s.id === shopId || s.name === shopId);
    if (!shop || !Array.isArray(shop.products)) return [];

    shop.products = shop.products.filter(p => p.id !== productId);
    saveAppShops(shops);
    return shop.products;
}

/**
 * Tính toán giá vốn và chi tiết xuất kho của 1 sản phẩm shop
 */
function calcShopProductCost(shopProduct, warehouseProducts = []) {
    if (!shopProduct) {
        return {
            baseCost: 0,
            baseUnits: 0,
            buyQty: 1,
            giftQty: 0,
            giftItems: [],
            giftCost: 0,
            dealCost: 0,
            totalCost: 0,
            totalUnits: 0,
            singlePrice: 0,
            dealPrice: 0,
            partsDesc: '',
            dealDesc: '',
            breakdown: ''
        };
    }

    const wMap = new Map();
    if (Array.isArray(warehouseProducts)) {
        warehouseProducts.forEach(wp => {
            wMap.set(String(wp.id), wp);
            wMap.set(String(wp.name).toLowerCase(), wp);
        });
    }

    let baseCost = 0;
    let baseUnits = 0;
    let parts = [];

    const items = Array.isArray(shopProduct.items) ? shopProduct.items : [];
    items.forEach(it => {
        const wp = wMap.get(String(it.productId)) || wMap.get(String(it.productName || '').toLowerCase());
        const price = wp ? Number(wp.price) || 0 : 0;
        const qty = Number(it.quantity) || 1;
        baseCost += qty * price;
        baseUnits += qty;
        parts.push(`${qty}x ${wp?.name || it.productName || 'SP kho'}`);
    });

    const deal = shopProduct.deal || {};
    const buyQty = Math.max(1, Number(deal.buyQty) || 1);

    // Chuẩn hóa danh sách quà tặng kèm
    let giftItems = [];
    if (Array.isArray(deal.giftItems)) {
        giftItems = deal.giftItems;
    } else if (deal.giftQty > 0) {
        // Tương thích ngược phiên bản cũ
        giftItems = [{
            productId: (deal.giftProductId && deal.giftProductId !== 'self') ? deal.giftProductId : (items[0]?.productId || 1),
            quantity: Number(deal.giftQty) || 1
        }];
    }

    let giftCost = 0;
    let totalGiftUnits = 0;
    let giftParts = [];

    giftItems.forEach(g => {
        const wp = wMap.get(String(g.productId)) || wMap.get(String(g.productName || '').toLowerCase());
        const price = wp ? Number(wp.price) || 0 : 0;
        const qty = Number(g.quantity) || 1;
        giftCost += qty * price;
        totalGiftUnits += qty;
        giftParts.push(`${qty}x ${wp?.name || g.productName || 'Quà'}`);
    });

    const dealCost = (baseCost * buyQty) + giftCost;
    const dealUnits = (baseUnits * buyQty) + totalGiftUnits;

    let dealDesc = '';
    if (giftParts.length > 0) {
        dealDesc = `Mua ${buyQty} tặng ${giftParts.join(' + ')}`;
    } else if (buyQty > 1) {
        dealDesc = `Mua ${buyQty}`;
    }

    const singlePrice = Number(shopProduct.price) || 0;
    const dealPrice = Number(shopProduct.dealPrice) || (singlePrice * buyQty);

    return {
        baseCost,
        baseUnits,
        buyQty,
        giftQty: totalGiftUnits,
        giftItems,
        giftCost,
        dealCost,
        totalCost: dealCost, // Alias for backward compatibility
        totalUnits: dealUnits,
        singlePrice,
        dealPrice,
        partsDesc: parts.join(' + '),
        dealDesc,
        breakdown: giftParts.length > 0 ? `${parts.join(' + ')} (${dealDesc})` : (parts.join(' + ') || `${shopProduct.name}`)
    };
}

/**
 * Lấy danh sách tên Shop tương thích ngược
 */
function getKnownShops(platform = '') {
    const shops = getAppShops(platform);
    return shops.map(s => s.name);
}

function saveKnownShop(shopName, platform = '', feePercent = 0) {
    if (!shopName || typeof shopName !== 'string') return;
    const name = shopName.trim();
    if (!name) return;
    const shops = getAppShops();
    if (!shops.some(s => s.name.toLowerCase() === name.toLowerCase())) {
        const defaultPlat = platform || (name.toLowerCase().includes('tiktok') ? 'TikTok Shop' : 'Shopee');
        addOrUpdateAppShop({
            name: name,
            platform: defaultPlat,
            feePercent: feePercent || (defaultPlat === 'Shopee' ? 14.5 : 14.0),
            note: '',
            products: []
        });
    }
}

/**
 * Tải danh sách Shop từ Google Sheet (CORS-free qua JSONP)
 */
async function fetchShopsFromGoogleSheet() {
    try {
        const data = await fetchGvizJsonp('shops');
        if (data && data.status === 'ok' && data.table && data.table.rows) {
            const parsed = [];
            data.table.rows.forEach(r => {
                const c = r.c || [];
                if (!c[0] && !c[1]) return;
                const id = c[0] ? String(c[0].v || '').trim() : '';
                const name = c[1] ? String(c[1].v || '').trim() : '';
                if (!name) return;
                const platform = c[2] ? String(c[2].v || '').trim() : 'Shopee';
                const feePercent = c[3] && c[3].v !== undefined ? Number(c[3].v) || 0 : 0;
                let note = '';
                if (c[4] && c[4].v !== undefined && c[4].v !== null) {
                    const rawN = String(c[4].v).trim();
                    if (rawN !== 'null' && rawN !== 'undefined') note = rawN;
                }
                let products = [];
                if (c[5] && c[5].v !== undefined && c[5].v !== null) {
                    const rawP = String(c[5].v).trim();
                    if (rawP.startsWith('[') || rawP.startsWith('{')) {
                        try { products = JSON.parse(rawP); } catch(pe) {}
                    }
                }
                parsed.push({
                    id: id || `SHOP_${Date.now()}_${Math.floor(Math.random()*1000)}`,
                    name,
                    platform,
                    feePercent,
                    note,
                    products: Array.isArray(products) ? products : []
                });
            });
            if (parsed.length > 0) {
                // Bảo toàn danh sách sản phẩm local nếu trên sheet cột JSON chưa có dữ liệu
                const existingShops = getAppShops();
                const existMap = new Map();
                existingShops.forEach(s => {
                    if (s.id) existMap.set(String(s.id), s);
                    if (s.name) existMap.set(String(s.name).toLowerCase(), s);
                });

                parsed.forEach(p => {
                    if (!p.products || p.products.length === 0) {
                        const local = existMap.get(String(p.id)) || existMap.get(String(p.name).toLowerCase());
                        if (local && Array.isArray(local.products) && local.products.length > 0) {
                            p.products = local.products;
                        }
                    }
                });

                saveAppShops(parsed, false);
                return parsed;
            }
        }
    } catch (e) {
        console.warn('Không thể tải danh sách shop qua JSONP:', e);
    }
    return getAppShops();
}

/**
 * Đồng bộ toàn bộ danh sách Shop lên Google Sheet
 */
async function syncShopsToGoogleSheet(shops) {
    const webAppUrl = getGoogleAppsScriptUrl();
    if (!webAppUrl) return;
    try {
        const payload = {
            action: 'saveShops',
            shops: shops || getAppShops(),
            timestamp: new Date().toISOString()
        };
        await fetch(webAppUrl, {
            method: 'POST',
            mode: 'no-cors',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify(payload)
        });
    } catch (e) {
        console.warn('Lỗi khi gửi danh sách shop lên Google Sheet:', e);
    }
}

/**
 * =============================================================================
 * KỲ QUYẾT TOÁN CHI TIẾT (10-15 NGÀY THEO SHOP) - STORAGE & SYNC
 * =============================================================================
 */
const SETTLEMENT_PERIODS_STORAGE_KEY = 'settlement_periods_data';

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
 * Tải dữ liệu từ Google Sheet qua JSONP (Hoàn toàn không bị chặn CORS bởi trình duyệt)
 * @param {string} sheetName Tên sheet (ví dụ: 'settlement_periods', 'monthly_reports')
 * @param {string} spreadsheetId ID của Google Sheet
 * @returns {Promise<Object>} Object data của google.visualization
 */
function fetchGvizJsonp(sheetName = 'settlement_periods', spreadsheetId = '1ZKWhdX5k8sXYUMJEL9ao4meJZhqGCBqg_zmHakMM8xc') {
    return new Promise((resolve, reject) => {
        const callbackName = 'gvizCallback_' + Date.now() + '_' + Math.floor(Math.random() * 100000);
        const script = document.createElement('script');
        let timeoutId = null;

        const cleanup = () => {
            if (timeoutId) clearTimeout(timeoutId);
            try { delete window[callbackName]; } catch (e) { window[callbackName] = undefined; }
            if (script.parentNode) {
                script.parentNode.removeChild(script);
            }
        };

        timeoutId = setTimeout(() => {
            cleanup();
            reject(new Error('GViz JSONP timeout'));
        }, 12000);

        window[callbackName] = function(data) {
            cleanup();
            resolve(data);
        };

        script.onerror = function(err) {
            cleanup();
            reject(new Error('Lỗi tải script GViz JSONP'));
        };

        script.src = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=responseHandler:${callbackName}&sheet=${encodeURIComponent(sheetName)}&_t=${Date.now()}`;
        document.head.appendChild(script);
    });
}

/**
 * Tải danh sách kỳ quyết toán từ Google Sheet (CORS-free)
 */
async function fetchSettlementPeriodsFromGoogleSheet() {
    try {
        // 1. Thử tải qua Google Visualization API bằng JSONP (CORS-free, nhanh)
        const data = await fetchGvizJsonp('settlement_periods');
        if (data && data.status === 'ok' && data.table && data.table.rows) {
            const parsed = [];
            data.table.rows.forEach(r => {
                const c = r.c || [];
                if (!c[0]) return;
                const id = String(c[0].v || '').trim();
                if (!id) return;

                const savedAt = c[1] ? (c[1].f || (c[1].v !== undefined ? String(c[1].v) : '')) : '';
                const platform = c[2] && c[2].v !== undefined ? String(c[2].v).trim() : '';
                const shopName = c[3] && c[3].v !== undefined ? String(c[3].v).trim() : '';
                const dateRange = c[4] && c[4].v !== undefined ? String(c[4].v).trim() : '';
                
                let monthVal = '';
                if (c[5]) {
                    monthVal = c[5].f || (c[5].v !== undefined ? String(c[5].v) : '');
                    const dateM = String(monthVal).match(/^Date\((\d{4}),\s*(\d{1,2}),\s*(\d{1,2})\)/);
                    if (dateM) {
                        const y = dateM[1];
                        const m = String(parseInt(dateM[2], 10) + 1).padStart(2, '0');
                        monthVal = `${y}-${m}`;
                    }
                }

                const totalOrders = c[6] && c[6].v !== undefined ? Number(c[6].v) || 0 : 0;
                const returnOrders = c[7] && c[7].v !== undefined ? Number(c[7].v) || 0 : 0;
                const revenue = c[8] && c[8].v !== undefined ? Number(c[8].v) || 0 : 0;
                const goodsCost = c[9] && c[9].v !== undefined ? Number(c[9].v) || 0 : 0;
                const adsCost = c[10] && c[10].v !== undefined ? Number(c[10].v) || 0 : 0;
                const materialCost = c[11] && c[11].v !== undefined ? Number(c[11].v) || 0 : 0;
                const otherExpenses = c[12] && c[12].v !== undefined ? Number(c[12].v) || 0 : 0;
                const profit = c[13] && c[13].v !== undefined ? Number(c[13].v) || 0 : 0;
                
                let note = '';
                if (c[14] && c[14].v !== undefined && c[14].v !== null) {
                    const rawN = String(c[14].v).trim();
                    if (rawN !== 'null' && rawN !== 'undefined') note = rawN;
                }

                parsed.push({
                    id,
                    savedAt,
                    platform,
                    shopName,
                    dateRange,
                    month: monthVal,
                    totalOrders,
                    returnOrders,
                    revenue,
                    goodsCost,
                    adsCost,
                    materialCost,
                    otherExpenses,
                    profit,
                    note
                });
            });

            if (parsed.length > 0) {
                return parsed;
            }
        }
    } catch (gvizErr) {
        console.warn('Không thể tải kỳ quyết toán qua JSONP, thử qua Web App API:', gvizErr);
    }

    // 2. Fallback Web App API
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
    const expTotal = getSpDialogExpensesTotal();

    const profit = rev - goods - ads - expTotal;
    const profitEl = document.getElementById('spDialogProfitDisplay');
    if (profitEl) {
        profitEl.textContent = formatSpMoney(profit);
        profitEl.style.color = profit >= 0 ? '#16a34a' : '#dc2626';
    }
}

function getSpDialogExpensesTotal() {
    let total = 0;
    const rows = document.querySelectorAll('#spDialogExpensesList .sp-expense-row');
    rows.forEach(r => {
        const amtInput = r.querySelector('.sp-expense-amount');
        if (amtInput) {
            total += parseSpNumber(amtInput.value);
        }
    });
    return total;
}

function onSpDialogExpenseRowChange() {
    const total = getSpDialogExpensesTotal();
    const totalEl = document.getElementById('spDialogExpenseTotalDisplay');
    if (totalEl) {
        totalEl.textContent = formatSpMoney(total);
    }
    calcSpDialogProfit();
}

function renderSpDialogExpenses(expensesList = []) {
    const container = document.getElementById('spDialogExpensesList');
    if (!container) return;

    let list = [];
    if (Array.isArray(expensesList) && expensesList.length > 0) {
        list = expensesList;
    } else {
        list = [{ name: 'Chi phí khác 1', amount: 0 }];
    }

    container.innerHTML = '';
    list.forEach((exp, idx) => {
        const defaultName = `Chi phí khác ${idx + 1}`;
        const nameVal = (exp.name && exp.name.trim()) ? exp.name.trim() : defaultName;
        addSpDialogExpenseRow(nameVal, exp.amount || 0, false);
    });
    onSpDialogExpenseRowChange();
}

function addSpDialogExpenseRow(name = '', amount = 0, triggerChange = true) {
    const container = document.getElementById('spDialogExpensesList');
    if (!container) return;

    const rowIdx = container.children.length + 1;
    const defaultPlaceholder = `Chi phí khác ${rowIdx}`;
    const nameVal = (name && name.trim()) ? name.trim() : defaultPlaceholder;

    const row = document.createElement('div');
    row.className = 'sp-expense-row';
    row.style.cssText = 'display: flex; gap: 8px; align-items: center;';

    const amtStr = (Number(amount) || 0) > 0 ? (Number(amount) || 0).toLocaleString('vi-VN') : (amount === 0 ? '0' : '');

    row.innerHTML = `
        <input type="text" class="sp-expense-name" value="${escapeSpAttr(nameVal)}" placeholder="${defaultPlaceholder}" style="flex: 1.4; padding: 7px 10px; border: 1px solid #cbd5e1; border-radius: 6px; font-family: inherit; font-size: 13px; font-weight: 500;">
        <input type="text" class="sp-expense-amount" value="${amtStr}" placeholder="0" style="flex: 1; padding: 7px 10px; border: 1px solid #cbd5e1; border-radius: 6px; font-family: inherit; font-size: 13px; font-weight: 700; text-align: right; color: #7c3aed;" onfocus="prepareSpDialogInput(this)" oninput="onSpDialogExpenseRowChange()" onblur="formatSpDialogInput(this)">
        <button type="button" class="sp-expense-del-btn" onclick="removeSpDialogExpenseRow(this)" style="background: #f1f5f9; border: 1px solid #cbd5e1; color: #64748b; border-radius: 6px; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; font-size: 13px; cursor: pointer; transition: all 0.15s ease;" title="Xóa dòng chi phí" onmouseenter="this.style.background='#fee2e2'; this.style.color='#dc2626'; this.style.borderColor='#fca5a5';" onmouseleave="this.style.background='#f1f5f9'; this.style.color='#64748b'; this.style.borderColor='#cbd5e1';">✕</button>
    `;

    container.appendChild(row);
    if (triggerChange) {
        onSpDialogExpenseRowChange();
    }
}

function removeSpDialogExpenseRow(btn) {
    const row = btn.closest('.sp-expense-row');
    if (row) {
        row.remove();
    }
    const container = document.getElementById('spDialogExpensesList');
    if (container && container.children.length === 0) {
        addSpDialogExpenseRow('', 0, false);
    }
    onSpDialogExpenseRowChange();
}

function escapeSpAttr(str) {
    return String(str || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function onSpDialogPlatformChange() {
    const plat = document.getElementById('spDialogPlatform')?.value || '';
    populateSpDialogShops(plat);
}

function populateSpDialogShops(platform = '', selectedShop = '') {
    const select = document.getElementById('spDialogShopSelect');
    const custom = document.getElementById('spDialogShopCustom');
    if (!select) return;

    const shops = getAppShops(platform);
    select.innerHTML = '';
    
    shops.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.name;
        opt.dataset.fee = s.feePercent || 0;
        opt.dataset.platform = s.platform || '';
        opt.textContent = `${s.name} (Phí sàn ${s.feePercent}%)`;
        select.appendChild(opt);
    });

    const otherOpt = document.createElement('option');
    otherOpt.value = '__custom__';
    otherOpt.textContent = '+ Nhập tên shop khác...';
    select.appendChild(otherOpt);

    const shopNames = shops.map(s => s.name);
    if (selectedShop && shopNames.includes(selectedShop)) {
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
    closeSpDatePicker();
}

// ============================================================
// BỘ CHỌN KHOẢNG NGÀY QUYẾT TOÁN (DATE RANGE PICKER)
// ============================================================

const spCalState = {
    currentYear: new Date().getFullYear(),
    currentMonth: new Date().getMonth(), // 0-indexed (0 - 11)
    startDate: null,                     // Date object
    endDate: null,                       // Date object
    hoverDate: null,                     // Date object
    isSelecting: false                   // true khi đang đợi chọn ngày thứ 2
};

function parseSpDateString(dateStr) {
    if (!dateStr) return null;
    dateStr = String(dateStr).trim();
    // YYYY-MM-DD
    const isoMatch = dateStr.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (isoMatch) {
        return new Date(parseInt(isoMatch[1], 10), parseInt(isoMatch[2], 10) - 1, parseInt(isoMatch[3], 10));
    }
    // DD/MM/YYYY
    const dmyMatch = dateStr.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
    if (dmyMatch) {
        return new Date(parseInt(dmyMatch[3], 10), parseInt(dmyMatch[2], 10) - 1, parseInt(dmyMatch[1], 10));
    }
    // DD/MM (không năm)
    const dmMatch = dateStr.match(/^(\d{1,2})[-/.](\d{1,2})$/);
    if (dmMatch) {
        return { day: parseInt(dmMatch[1], 10), month: parseInt(dmMatch[2], 10) - 1 };
    }
    return null;
}

function parseSpDateRangeText(rangeStr) {
    if (!rangeStr || typeof rangeStr !== 'string') return { start: null, end: null };
    rangeStr = rangeStr.trim();
    const parts = rangeStr.split(/\s*(?:-|–|—|đến|to)\s*/i);
    if (parts.length >= 2) {
        let p1 = parseSpDateString(parts[0]);
        let p2 = parseSpDateString(parts[1]);

        if (p2 instanceof Date) {
            if (p1 instanceof Date) {
                return { start: p1, end: p2 };
            } else if (p1 && typeof p1.day === 'number') {
                const start = new Date(p2.getFullYear(), p1.month, p1.day);
                return { start: start, end: p2 };
            }
        } else if (p1 instanceof Date) {
            return { start: p1, end: p1 };
        }
    } else if (parts.length === 1 && parts[0]) {
        const p1 = parseSpDateString(parts[0]);
        if (p1 instanceof Date) {
            return { start: p1, end: p1 };
        }
    }
    return { start: null, end: null };
}

function formatSpDate(d) {
    if (!d || !(d instanceof Date) || isNaN(d.getTime())) return '';
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
}

function formatSpDateRange(start, end) {
    if (!start) return '';
    if (!end) return formatSpDate(start);
    return `${formatSpDate(start)} - ${formatSpDate(end)}`;
}

function initSpDatePickerFromValue(rangeStr) {
    const { start, end } = parseSpDateRangeText(rangeStr);
    if (start) start.setHours(0, 0, 0, 0);
    if (end) end.setHours(0, 0, 0, 0);

    spCalState.startDate = start;
    spCalState.endDate = end;
    spCalState.hoverDate = null;
    spCalState.isSelecting = false;

    if (end) {
        spCalState.currentMonth = end.getMonth();
        spCalState.currentYear = end.getFullYear();
    } else if (start) {
        spCalState.currentMonth = start.getMonth();
        spCalState.currentYear = start.getFullYear();
    } else {
        const now = new Date();
        spCalState.currentMonth = now.getMonth();
        spCalState.currentYear = now.getFullYear();
    }
    renderSpCalendar();
}

function renderSpCalendar() {
    const container = document.getElementById('spCalendarContainer');
    if (!container) return;

    const year = spCalState.currentYear;
    const month = spCalState.currentMonth;

    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const numDays = lastDay.getDate();

    let startDayOfWeek = firstDay.getDay() - 1;
    if (startDayOfWeek === -1) startDayOfWeek = 6; // Thứ 2 là cột đầu tiên (0 = T2 ... 6 = CN)

    const prevMonthLastDay = new Date(year, month, 0).getDate();

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayTime = today.getTime();

    let sTime = spCalState.startDate ? new Date(spCalState.startDate).setHours(0, 0, 0, 0) : null;
    let eTime = spCalState.endDate ? new Date(spCalState.endDate).setHours(0, 0, 0, 0) : null;

    let hoverStart = null;
    let hoverEnd = null;

    if (spCalState.isSelecting && spCalState.startDate && spCalState.hoverDate) {
        const hTime = new Date(spCalState.hoverDate).setHours(0, 0, 0, 0);
        hoverStart = Math.min(sTime, hTime);
        hoverEnd = Math.max(sTime, hTime);
    } else if (sTime && eTime) {
        hoverStart = Math.min(sTime, eTime);
        hoverEnd = Math.max(sTime, eTime);
    } else if (sTime) {
        hoverStart = sTime;
        hoverEnd = sTime;
    }

    const monthNames = [
        "Tháng 1", "Tháng 2", "Tháng 3", "Tháng 4", "Tháng 5", "Tháng 6",
        "Tháng 7", "Tháng 8", "Tháng 9", "Tháng 10", "Tháng 11", "Tháng 12"
    ];

    let monthOptions = '';
    for (let m = 0; m < 12; m++) {
        monthOptions += `<option value="${m}" ${m === month ? 'selected' : ''}>${monthNames[m]}</option>`;
    }

    let yearOptions = '';
    const nowY = new Date().getFullYear();
    for (let y = nowY - 4; y <= nowY + 3; y++) {
        yearOptions += `<option value="${y}" ${y === year ? 'selected' : ''}>${y}</option>`;
    }

    let html = `
        <div class="sp-presets-bar">
            <button type="button" class="sp-preset-btn" onclick="applySpPreset('firstHalf')">Kỳ 1 (1 - 15)</button>
            <button type="button" class="sp-preset-btn" onclick="applySpPreset('secondHalf')">Kỳ 2 (16 - Hết)</button>
            <button type="button" class="sp-preset-btn" onclick="applySpPreset('fullMonth')">Cả tháng này</button>
            <button type="button" class="sp-preset-btn" onclick="applySpPreset('prevMonth')">Tháng trước</button>
            <button type="button" class="sp-preset-btn" onclick="applySpPreset('last7')">7 ngày qua</button>
        </div>

        <div class="sp-calendar-header">
            <button type="button" class="sp-cal-nav-btn" onclick="changeSpCalMonth(-1)" title="Tháng trước">‹</button>
            <div class="sp-cal-title-selects">
                <select class="sp-cal-month-select" onchange="onSpCalMonthSelect(this.value)">
                    ${monthOptions}
                </select>
                <select class="sp-cal-year-select" onchange="onSpCalYearSelect(this.value)">
                    ${yearOptions}
                </select>
            </div>
            <button type="button" class="sp-cal-nav-btn" onclick="changeSpCalMonth(1)" title="Tháng sau">›</button>
        </div>

        <div class="sp-calendar-weekdays">
            <span>T2</span><span>T3</span><span>T4</span><span>T5</span><span>T6</span><span>T7</span><span>CN</span>
        </div>

        <div class="sp-calendar-grid" id="spCalendarGrid" onmouseleave="handleSpGridMouseLeave()">
    `;

    // 1. Ngày của tháng trước (overflow)
    for (let i = startDayOfWeek - 1; i >= 0; i--) {
        const dNum = prevMonthLastDay - i;
        const dObj = new Date(year, month - 1, dNum);
        dObj.setHours(0, 0, 0, 0);
        const dTime = dObj.getTime();
        const cellClasses = getSpCellClasses(dTime, hoverStart, hoverEnd, todayTime);

        html += `
            <div class="sp-day-cell other-month ${cellClasses}" data-time="${dTime}" data-y="${dObj.getFullYear()}" data-m="${dObj.getMonth()}" data-d="${dNum}"
                 onclick="handleSpDayClick(${dObj.getFullYear()}, ${dObj.getMonth()}, ${dNum})"
                 onmouseenter="handleSpDayHover(${dObj.getFullYear()}, ${dObj.getMonth()}, ${dNum})">
                <span class="sp-day-num">${dNum}</span>
            </div>
        `;
    }

    // 2. Ngày của tháng hiện tại
    for (let d = 1; d <= numDays; d++) {
        const dObj = new Date(year, month, d);
        dObj.setHours(0, 0, 0, 0);
        const dTime = dObj.getTime();
        const cellClasses = getSpCellClasses(dTime, hoverStart, hoverEnd, todayTime);

        html += `
            <div class="sp-day-cell ${cellClasses}" data-time="${dTime}" data-y="${year}" data-m="${month}" data-d="${d}"
                 onclick="handleSpDayClick(${year}, ${month}, ${d})"
                 onmouseenter="handleSpDayHover(${year}, ${month}, ${d})">
                <span class="sp-day-num">${d}</span>
            </div>
        `;
    }

    // 3. Ngày của tháng sau (overflow)
    const totalCellsSoFar = startDayOfWeek + numDays;
    const nextMonthCells = (7 - (totalCellsSoFar % 7)) % 7;
    for (let n = 1; n <= nextMonthCells; n++) {
        const dObj = new Date(year, month + 1, n);
        dObj.setHours(0, 0, 0, 0);
        const dTime = dObj.getTime();
        const cellClasses = getSpCellClasses(dTime, hoverStart, hoverEnd, todayTime);

        html += `
            <div class="sp-day-cell other-month ${cellClasses}" data-time="${dTime}" data-y="${dObj.getFullYear()}" data-m="${dObj.getMonth()}" data-d="${n}"
                 onclick="handleSpDayClick(${dObj.getFullYear()}, ${dObj.getMonth()}, ${n})"
                 onmouseenter="handleSpDayHover(${dObj.getFullYear()}, ${dObj.getMonth()}, ${n})">
                <span class="sp-day-num">${n}</span>
            </div>
        `;
    }

    html += `</div>`;

    // Footer summary
    let infoText = '💡 Chọn <strong>ngày bắt đầu</strong> rồi chọn <strong>ngày kết thúc</strong>';
    if (spCalState.startDate && spCalState.endDate) {
        const daysCount = Math.round((spCalState.endDate.getTime() - spCalState.startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
        infoText = `✨ Đã chọn: <strong>${formatSpDate(spCalState.startDate)} - ${formatSpDate(spCalState.endDate)}</strong> (${daysCount} ngày)`;
    } else if (spCalState.startDate) {
        infoText = `📌 Bắt đầu: <strong>${formatSpDate(spCalState.startDate)}</strong> (Chọn ngày kết thúc...)`;
    }

    html += `
        <div class="sp-calendar-footer">
            <div class="sp-cal-info-text" id="spCalInfoText">${infoText}</div>
            <div class="sp-cal-btn-group">
                <button type="button" class="sp-cal-action-btn sp-cal-btn-clear" onclick="clearSpDatePicker()">Xóa</button>
                <button type="button" class="sp-cal-action-btn sp-cal-btn-apply" onclick="closeSpDatePicker()">Xong</button>
            </div>
        </div>
    `;

    container.innerHTML = html;
}

function updateSpCalendarRangeVisuals() {
    let sTime = spCalState.startDate ? new Date(spCalState.startDate).setHours(0, 0, 0, 0) : null;
    let eTime = spCalState.endDate ? new Date(spCalState.endDate).setHours(0, 0, 0, 0) : null;

    let hoverStart = null;
    let hoverEnd = null;

    if (spCalState.isSelecting && spCalState.startDate && spCalState.hoverDate) {
        const hTime = new Date(spCalState.hoverDate).setHours(0, 0, 0, 0);
        hoverStart = Math.min(sTime, hTime);
        hoverEnd = Math.max(sTime, hTime);
    } else if (sTime && eTime) {
        hoverStart = Math.min(sTime, eTime);
        hoverEnd = Math.max(sTime, eTime);
    } else if (sTime) {
        hoverStart = sTime;
        hoverEnd = sTime;
    }

    const cells = document.querySelectorAll('#spCalendarGrid .sp-day-cell');
    cells.forEach(cell => {
        const dTimeStr = cell.getAttribute('data-time');
        if (!dTimeStr) return;
        const dTime = parseInt(dTimeStr, 10);

        cell.classList.remove('range-start', 'range-end', 'range-single', 'in-range');

        if (hoverStart !== null && hoverEnd !== null) {
            if (dTime === hoverStart && dTime === hoverEnd) {
                cell.classList.add('range-start', 'range-end', 'range-single');
            } else if (dTime === hoverStart) {
                cell.classList.add('range-start');
            } else if (dTime === hoverEnd) {
                cell.classList.add('range-end');
            } else if (dTime > hoverStart && dTime < hoverEnd) {
                cell.classList.add('in-range');
            }
        }
    });

    const infoEl = document.getElementById('spCalInfoText');
    if (infoEl) {
        let infoText = '💡 Chọn <strong>ngày bắt đầu</strong> rồi chọn <strong>ngày kết thúc</strong>';
        if (spCalState.startDate && spCalState.endDate) {
            const daysCount = Math.round((spCalState.endDate.getTime() - spCalState.startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
            infoText = `✨ Đã chọn: <strong>${formatSpDate(spCalState.startDate)} - ${formatSpDate(spCalState.endDate)}</strong> (${daysCount} ngày)`;
        } else if (spCalState.startDate) {
            infoText = `📌 Bắt đầu: <strong>${formatSpDate(spCalState.startDate)}</strong> (Chọn ngày kết thúc...)`;
        }
        infoEl.innerHTML = infoText;
    }
}

function getSpCellClasses(dTime, rangeStart, rangeEnd, todayTime) {
    const classes = [];
    if (dTime === todayTime) classes.push('today');

    if (rangeStart !== null && rangeEnd !== null) {
        if (dTime === rangeStart && dTime === rangeEnd) {
            classes.push('range-start', 'range-end', 'range-single');
        } else if (dTime === rangeStart) {
            classes.push('range-start');
        } else if (dTime === rangeEnd) {
            classes.push('range-end');
        } else if (dTime > rangeStart && dTime < rangeEnd) {
            classes.push('in-range');
        }
    }
    return classes.join(' ');
}

function handleSpDayClick(year, month, day) {
    const clickedDate = new Date(year, month, day);
    clickedDate.setHours(0, 0, 0, 0);

    const isDifferentMonth = (month !== spCalState.currentMonth || year !== spCalState.currentYear);

    if (!spCalState.isSelecting) {
        // Bắt đầu chọn range
        spCalState.startDate = clickedDate;
        spCalState.endDate = null;
        spCalState.hoverDate = null;
        spCalState.isSelecting = true;

        if (isDifferentMonth) {
            spCalState.currentYear = year;
            spCalState.currentMonth = month;
            renderSpCalendar();
        } else {
            updateSpCalendarRangeVisuals();
        }

        const input = document.getElementById('spDialogDateRange');
        if (input) input.value = formatSpDate(clickedDate);
    } else {
        // Đã chọn xong ngày thứ hai
        if (clickedDate.getTime() < spCalState.startDate.getTime()) {
            spCalState.endDate = new Date(spCalState.startDate);
            spCalState.startDate = clickedDate;
        } else {
            spCalState.endDate = clickedDate;
        }
        spCalState.isSelecting = false;
        spCalState.hoverDate = null;
        applySpSelectedRange();

        if (isDifferentMonth) {
            spCalState.currentYear = year;
            spCalState.currentMonth = month;
            renderSpCalendar();
        } else {
            updateSpCalendarRangeVisuals();
        }
    }
}

function handleSpDayHover(year, month, day) {
    if (!spCalState.isSelecting || !spCalState.startDate) return;
    const hovered = new Date(year, month, day);
    hovered.setHours(0, 0, 0, 0);
    spCalState.hoverDate = hovered;
    updateSpCalendarRangeVisuals();
}

function handleSpGridMouseLeave() {
    if (spCalState.isSelecting) {
        spCalState.hoverDate = null;
        updateSpCalendarRangeVisuals();
    }
}

function changeSpCalMonth(delta) {
    let newM = spCalState.currentMonth + delta;
    let newY = spCalState.currentYear;
    if (newM < 0) {
        newM = 11;
        newY--;
    } else if (newM > 11) {
        newM = 0;
        newY++;
    }
    spCalState.currentMonth = newM;
    spCalState.currentYear = newY;
    renderSpCalendar();
}

function onSpCalMonthSelect(val) {
    spCalState.currentMonth = parseInt(val, 10);
    renderSpCalendar();
}

function onSpCalYearSelect(val) {
    spCalState.currentYear = parseInt(val, 10);
    renderSpCalendar();
}

function applySpPreset(presetType) {
    const year = spCalState.currentYear;
    const month = spCalState.currentMonth;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let needsFullRender = false;

    if (presetType === 'firstHalf') {
        spCalState.startDate = new Date(year, month, 1);
        spCalState.endDate = new Date(year, month, 15);
    } else if (presetType === 'secondHalf') {
        spCalState.startDate = new Date(year, month, 16);
        spCalState.endDate = new Date(year, month + 1, 0);
    } else if (presetType === 'fullMonth') {
        spCalState.startDate = new Date(year, month, 1);
        spCalState.endDate = new Date(year, month + 1, 0);
    } else if (presetType === 'prevMonth') {
        const prevM = new Date(year, month - 1, 1);
        spCalState.currentYear = prevM.getFullYear();
        spCalState.currentMonth = prevM.getMonth();
        spCalState.startDate = new Date(spCalState.currentYear, spCalState.currentMonth, 1);
        spCalState.endDate = new Date(spCalState.currentYear, spCalState.currentMonth + 1, 0);
        needsFullRender = true;
    } else if (presetType === 'last7') {
        const end = new Date(today);
        const start = new Date(today);
        start.setDate(today.getDate() - 6);
        if (spCalState.currentYear !== end.getFullYear() || spCalState.currentMonth !== end.getMonth()) {
            spCalState.currentYear = end.getFullYear();
            spCalState.currentMonth = end.getMonth();
            needsFullRender = true;
        }
        spCalState.startDate = start;
        spCalState.endDate = end;
    }

    spCalState.isSelecting = false;
    spCalState.hoverDate = null;
    applySpSelectedRange();

    if (needsFullRender) {
        renderSpCalendar();
    } else {
        updateSpCalendarRangeVisuals();
    }
}

function applySpSelectedRange() {
    const input = document.getElementById('spDialogDateRange');
    if (!input) return;

    if (spCalState.startDate && spCalState.endDate) {
        input.value = formatSpDateRange(spCalState.startDate, spCalState.endDate);

        // Tự động đồng bộ Tháng và Năm áp dụng cho kỳ quyết toán
        const targetDate = spCalState.endDate || spCalState.startDate;
        const m = String(targetDate.getMonth() + 1).padStart(2, '0');
        const y = String(targetDate.getFullYear());

        const monthEl = document.getElementById('spDialogMonth');
        const yearEl = document.getElementById('spDialogYear');
        if (monthEl) monthEl.value = m;
        if (yearEl) yearEl.value = y;
    } else if (spCalState.startDate) {
        input.value = formatSpDate(spCalState.startDate);
    }
}

function clearSpDatePicker() {
    spCalState.startDate = null;
    spCalState.endDate = null;
    spCalState.hoverDate = null;
    spCalState.isSelecting = false;
    const input = document.getElementById('spDialogDateRange');
    if (input) input.value = '';
    updateSpCalendarRangeVisuals();
}

function closeSpDatePicker() {
    const popup = document.getElementById('spCalendarPopup');
    if (popup) popup.classList.remove('show');
}

function toggleSpDatePicker(event) {
    if (event) event.stopPropagation();
    const popup = document.getElementById('spCalendarPopup');
    if (!popup) return;

    if (popup.classList.contains('show')) {
        popup.classList.remove('show');
    } else {
        const input = document.getElementById('spDialogDateRange');
        if (input && input.value) {
            initSpDatePickerFromValue(input.value);
        } else {
            renderSpCalendar();
        }
        popup.classList.add('show');
    }
}

function onSpDialogDateRangeManualInput(val) {
    const { start, end } = parseSpDateRangeText(val);
    if (start) {
        spCalState.startDate = start;
        spCalState.endDate = end;
        spCalState.hoverDate = null;
        spCalState.isSelecting = false;
        if (end) {
            spCalState.currentMonth = end.getMonth();
            spCalState.currentYear = end.getFullYear();
        } else {
            spCalState.currentMonth = start.getMonth();
            spCalState.currentYear = start.getFullYear();
        }
        renderSpCalendar();
    }
}

// Đóng lịch khi bấm ra ngoài
if (!window._spCalClickListenerAttached) {
    window._spCalClickListenerAttached = true;
    document.addEventListener('click', (e) => {
        const popup = document.getElementById('spCalendarPopup');
        const wrapper = document.querySelector('.sp-date-picker-wrapper');
        if (popup && popup.classList.contains('show')) {
            if (wrapper && !wrapper.contains(e.target)) {
                closeSpDatePicker();
            }
        }
    });
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
                            <div class="sp-date-picker-wrapper">
                                <label style="display: block; font-size: 13px; font-weight: 700; color: #334155; margin-bottom: 5px;">Khoảng ngày quyết toán:</label>
                                <div class="sp-date-input-container">
                                    <input type="text" id="spDialogDateRange" class="sp-date-input" placeholder="vd: 01/08/2026 - 15/08/2026" onclick="toggleSpDatePicker(event)" oninput="onSpDialogDateRangeManualInput(this.value)" autocomplete="off" required>
                                    <button type="button" class="sp-date-icon-btn" onclick="toggleSpDatePicker(event)" title="Mở lịch chọn khoảng ngày">📅</button>
                                </div>
                                <div id="spCalendarPopup" class="sp-calendar-popup" onclick="event.stopPropagation()">
                                    <div id="spCalendarContainer"></div>
                                </div>
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

                            <div>
                                <label style="display: block; font-size: 12px; font-weight: 600; color: #475569; margin-bottom: 4px;">Chi phí Quảng cáo (VNĐ):</label>
                                <input type="text" id="spDialogAdsCost" style="width: 100%; padding: 8px 12px; border: 1px solid #cbd5e1; border-radius: 8px; font-family: inherit; font-size: 14px; font-weight: 700; text-align: right; color: #d97706;" onfocus="prepareSpDialogInput(this)" oninput="calcSpDialogProfit()" onblur="formatSpDialogInput(this)">
                            </div>

                            <!-- DANH SÁCH CHI PHÍ KHÁC (VẬT TƯ, ĐÓNG GÓI, VẬN HÀNH...) -->
                            <div style="border-top: 1px dashed #cbd5e1; padding-top: 8px; display: flex; flex-direction: column; gap: 6px;">
                                <div style="display: flex; align-items: center; justify-content: space-between;">
                                    <label style="font-size: 12px; font-weight: 700; color: #475569;">Chi phí khác (Vật tư, đóng gói, vận hành...):</label>
                                    <button type="button" onclick="addSpDialogExpenseRow('', 0)" style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 6px; padding: 3px 8px; font-size: 11px; font-weight: 700; color: #2563eb; cursor: pointer; transition: all 0.15s ease;">+ Thêm chi phí</button>
                                </div>
                                <div id="spDialogExpensesList" style="display: flex; flex-direction: column; gap: 6px; max-height: 160px; overflow-y: auto; padding-right: 2px;"></div>
                                <div style="display: flex; justify-content: flex-end; align-items: center; gap: 6px; font-size: 12px; color: #475569; padding-top: 2px;">
                                    <span>Tổng chi phí khác:</span>
                                    <strong id="spDialogExpenseTotalDisplay" style="color: #7c3aed; font-size: 13.5px; font-weight: 800;">0 đ</strong>
                                </div>
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

    // Ghi nhận ID nếu đang chỉnh sửa kỳ có sẵn
    window._currentSpEditingId = data.id || null;

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

    // Khởi tạo bộ chọn ngày với dải ngày hiện tại
    initSpDatePickerFromValue(dateRangeStr);

    // Tháng áp dụng
    const now = new Date();
    let selM = String(now.getMonth() + 1).padStart(2, '0');
    let selY = String(now.getFullYear());
    if (data.month) {
        const norm = typeof normalizeMonthKey === 'function' ? normalizeMonthKey(data.month) : String(data.month);
        const parts = norm.split('-');
        if (parts.length === 2) {
            selY = parts[0];
            selM = parts[1].padStart(2, '0');
        }
    } else if (dateRangeStr) {
        // Tự động trích xuất tháng và năm từ khoảng ngày quyết toán (ví dụ: 01/08/2026 - 15/08/2026 -> Tháng 08, Năm 2026)
        const dateMatches = String(dateRangeStr).match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/g);
        if (dateMatches && dateMatches.length > 0) {
            const lastDate = dateMatches[dateMatches.length - 1];
            const parts = lastDate.split(/[\/\-]/);
            if (parts.length === 3) {
                selM = parts[1].padStart(2, '0');
                selY = parts[2];
            }
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
    const dialogNoteVal = data.note && String(data.note).trim() !== 'null' && String(data.note).trim() !== 'undefined' ? String(data.note).trim() : '';
    document.getElementById('spDialogNote').value = dialogNoteVal;

    // Chuẩn bị danh sách chi phí khác (expenses)
    let initExpenses = [];
    if (Array.isArray(data.expenses) && data.expenses.length > 0) {
        initExpenses = JSON.parse(JSON.stringify(data.expenses));
    } else if (data.expenseDetails) {
        initExpenses = String(data.expenseDetails).split(';').map(item => {
            const parts = item.split(':');
            if (parts.length === 2) {
                return { name: parts[0].trim(), amount: parseSpNumber(parts[1]) };
            }
            return { name: item.trim(), amount: 0 };
        }).filter(e => e.name);
    } else if (data.materialCost || data.otherExpenses) {
        if (data.materialCost) initExpenses.push({ name: 'Vật tư', amount: data.materialCost });
        if (data.otherExpenses) initExpenses.push({ name: 'Chi phí khác', amount: data.otherExpenses });
    }
    if (initExpenses.length === 0) {
        initExpenses = [{ name: 'Vật tư', amount: 0 }];
    }

    renderSpDialogExpenses(initExpenses);

    calcSpDialogProfit();
    modalOverlay.style.display = 'flex';
}

async function handleSaveSettlementPeriodFormSubmit(event) {
    event.preventDefault();
    const submitBtn = document.getElementById('spDialogSubmitBtn');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '⏳ Đang lưu...';
    }

    // Hiển thị màn hình Loading chuyên nghiệp
    showGlobalLoading(
        '⏳ Đang lưu kỳ quyết toán...',
        'Đang xử lý số liệu và đồng bộ vào Báo Cáo Tháng trên Google Sheet...'
    );

    try {
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

        // Lấy toàn bộ danh sách chi phí khác đã nhập
        const expenseRows = document.querySelectorAll('#spDialogExpensesList .sp-expense-row');
        const expensesList = [];
        let totalExpAmount = 0;
        let fallbackCounter = 1;

        expenseRows.forEach(row => {
            let name = row.querySelector('.sp-expense-name')?.value?.trim() || '';
            const amt = parseSpNumber(row.querySelector('.sp-expense-amount')?.value);
            if (!name) {
                name = `Chi phí khác ${fallbackCounter}`;
            }
            fallbackCounter++;

            if (name || amt > 0) {
                expensesList.push({ name: name, amount: amt });
                totalExpAmount += amt;
            }
        });
        if (expensesList.length === 0) {
            expensesList.push({ name: 'Chi phí khác 1', amount: 0 });
        }

        const expenseDetails = expensesList
            .filter(e => e.amount > 0 || (e.name && e.name.trim()))
            .map(e => `${e.name}: ${(Number(e.amount) || 0).toLocaleString('vi-VN')} đ`)
            .join('; ');

        const profit = revenue - goodsCost - adsCost - totalExpAmount;
        const rawNote = document.getElementById('spDialogNote')?.value?.trim() || '';
        const note = (rawNote === 'null' || rawNote === 'undefined') ? '' : rawNote;

        const periodItem = {
            id: window._currentSpEditingId || `PERIOD_${Date.now()}`,
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
            materialCost: totalExpAmount,
            otherExpenses: 0,
            expenses: expensesList,
            expenseDetails: expenseDetails,
            profit: profit,
            note: note
        };

        const res = await syncSingleSettlementPeriod(periodItem, { source: document.title || 'Quyết toán' });

        closeSaveSettlementPeriodDialog();

        if (typeof activeSettlementSaveCallback === 'function') {
            activeSettlementSaveCallback(res);
        }
    } catch (err) {
        console.error('Lỗi khi lưu kỳ quyết toán:', err);
        showToast('❌ Đã xảy ra lỗi khi lưu kỳ quyết toán.');
    } finally {
        hideGlobalLoading();
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '💾 Lưu kỳ quyết toán';
        }
    }
}

/**
 * Hiển thị màn hình Loading khi thực hiện lưu / đồng bộ
 */
function showGlobalLoading(title = 'Đang lưu kỳ quyết toán...', subtext = 'Đang xử lý dữ liệu và đồng bộ lên Google Sheet...') {
    let overlay = document.getElementById('globalAppLoadingOverlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'globalAppLoadingOverlay';
        overlay.className = 'global-loading-overlay';
        overlay.innerHTML = `
            <div class="global-loading-card">
                <div class="global-loading-spinner-box">
                    <div class="global-loading-spinner"></div>
                    <div class="global-loading-icon">💾</div>
                </div>
                <div style="display: flex; flex-direction: column; gap: 4px;">
                    <div id="globalLoadingTitle" class="global-loading-title">Đang lưu kỳ quyết toán...</div>
                    <div id="globalLoadingSubtext" class="global-loading-subtext">Đang đồng bộ dữ liệu...</div>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
    }
    const tEl = document.getElementById('globalLoadingTitle');
    const sEl = document.getElementById('globalLoadingSubtext');
    if (tEl) tEl.textContent = title;
    if (sEl) sEl.textContent = subtext;

    requestAnimationFrame(() => {
        overlay.classList.add('active');
    });
}

/**
 * Ẩn màn hình Loading
 */
function hideGlobalLoading() {
    const overlay = document.getElementById('globalAppLoadingOverlay');
    if (overlay) {
        overlay.classList.remove('active');
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


