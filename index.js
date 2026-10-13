import {
    db, auth,
    getAllStores, getSellerProfile, getProductsBySeller,
    getCart, saveCart, placeOrder, getUnreadCountForCustomer, getAddresses
} from "./db.js";

import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
    collection, query, where, getDocs,
    doc, getDoc, updateDoc, serverTimestamp, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

/* ══════════════════════════════════════════════════════════════
   VIEW SWITCHING
   ══════════════════════════════════════════════════════════════ */
/* ── View history stack, drives the single header back-button beside
   the "K.S" logo. Every showView() call (except a plain "go back") pushes
   the PREVIOUS view onto the stack, so clicking the header back button
   always returns to wherever the person actually came from — home, the
   seller list, or a shop — instead of jumping to one fixed screen. ── */
let viewHistory = [];
let currentViewId = "view-home";
const headerBackBtn = document.getElementById("headerBackBtn");

/* ── Match the back button's size to the "Home"/"About" nav links'
   ACTUAL rendered size (from user.css/seller.css/shop.css), instead of
   guessing pixel values here. Copies the real computed padding/
   font-size/height, so it always matches those nav links exactly. */
function matchBackBtnSizeToLoginBtn() {
    const navHome = document.getElementById("navHome");
    if (!navHome || !headerBackBtn) return;
    const cs = getComputedStyle(navHome);
    headerBackBtn.style.padding       = cs.padding;
    headerBackBtn.style.fontSize      = cs.fontSize;
    headerBackBtn.style.fontWeight    = cs.fontWeight;
    headerBackBtn.style.borderRadius  = "20px";
    headerBackBtn.style.height        = cs.height !== "auto" ? cs.height : "";
    headerBackBtn.style.lineHeight    = cs.lineHeight;
}
matchBackBtnSizeToLoginBtn();
window.addEventListener("resize", matchBackBtnSizeToLoginBtn);

function showView(id, { isBack = false } = {}) {
    if (!isBack && id !== currentViewId) {
        viewHistory.push(currentViewId);
    }
    currentViewId = id;

    document.querySelectorAll(".app-view").forEach(v => v.classList.remove("active"));
    document.getElementById(id).classList.add("active");
    window.scrollTo(0, 0);

    headerBackBtn.classList.toggle("show", viewHistory.length > 0);
}

function goToHome() { viewHistory = []; showView("view-home"); }

function goToSellerList() {
    showView("view-seller");
    loadSellerStores();
}

function goToShop(store) {
    showView("view-shop");
    initShopView(store);
}

function goBackOneView() {
    const prevId = viewHistory.pop() || "view-home";
    if (prevId === "view-seller") loadSellerStores();
    else if (prevId === "view-shop") { /* re-entering an already-loaded shop, no reload needed */ }
    showView(prevId, { isBack: true });
}

document.getElementById("navHome").addEventListener("click", e => { e.preventDefault(); goToHome(); });
document.getElementById("navAbout").addEventListener("click", e => {
    e.preventDefault();
    goToHome();
    setTimeout(() => document.getElementById("about")?.scrollIntoView({ behavior: "smooth" }), 50);
});
document.getElementById("shopNowBtn").addEventListener("click", goToSellerList);
headerBackBtn.addEventListener("click", goBackOneView);

/* ══════════════════════════════════════════════════════════════
   SHARED HELPERS
   ══════════════════════════════════════════════════════════════ */
function escapeHTML(str) {
    if (!str) return "";
    return str.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
              .replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}
function timeAgo(date) {
    const diff = (Date.now() - date.getTime()) / 1000;
    if (diff < 60)    return "just now";
    if (diff < 3600)  return `${Math.floor(diff/60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
    if (diff < 604800) return `${Math.floor(diff/86400)}d ago`;
    return date.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
}
function showToast(msg) {
    const t = document.getElementById("toast");
    t.innerText = msg;
    t.classList.add("show");
    setTimeout(() => t.classList.remove("show"), 2500);
}

/* ══════════════════════════════════════════════════════════════
   AUTH + HEADER (runs once, shared across all views)
   ══════════════════════════════════════════════════════════════ */
const placeholder = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ccircle cx='50' cy='50' r='50' fill='%23555'/%3E%3C/svg%3E";

/* ── GUEST-BY-DEFAULT (race-condition-proof) ─────────────────────
   PROBLEMA sa dating approach: si signOut(auth) ay ASYNC — hindi
   agad tapos. Kung mabilis mag-fire ang onAuthStateChanged (may
   cached session pa si Firebase sa IndexedDB), pwedeng ma-set muna
   ang currentUID sa LUMANG account BAGO pa matapos ang signOut,
   kaya lumalabas pa rin yung dating profile/name, at pag na-click
   agad ang "Buy Now" bago pa "settle" ang state, nakakalusot ito
   papasok sa checkout kahit hindi pa ito dapat pinapayagan.

   AYOS: (1) I-paint agad nang SYNCHRONOUS ang UI bilang GUEST bago
   pa man tumakbo ang anumang Firebase call — walang flash ng lumang
   data kahit sandali. (2) HINTAYIN (await) munang matapos NANG
   TULUYAN ang signOut() bago pa i-register ang onAuthStateChanged
   listener — sa ganito, ang unang beses na tatakbo ang listener,
   GUARANTEED na wala nang session, kaya laging currentUID = null
   sa simula, at hindi na makakalusot ang Buy Now papunta sa
   payment.html nang walang login. ── */

let currentCustomer = null;
let currentUID      = null;

function setPlaceholderPic() {
    // Ang bilog na profile picture ay tinanggal na sa header at home page,
    // kaya wala nang larawan na kailangang i-reset dito. Naka-iwan lang
    // ang function na ito para hindi masira ang ibang tumatawag dito.
}

function paintGuestUI() {
    currentCustomer = null;
    currentUID      = null;
    setPlaceholderPic();
    document.getElementById("welcomeName").innerText = "Welcome";
}

function applyCustomerData(data, username) {
    const displayName = data.customerName || data?.fullName || username;
    document.getElementById("welcomeName").innerText = "Welcome, " + displayName.toUpperCase() + "!";
}

// STEP 1 — Paint guest IMMEDIATELY, walang hihintayin, walang flash.
paintGuestUI();
localStorage.removeItem("currentCustomer");
localStorage.removeItem("currentCustomerUID");

// STEP 2 — Force-sign-out muna nang TULUYAN (awaited), saka lang
// i-attach ang listener, para guaranteed guest ang unang state nito.
(async () => {
    try {
        await signOut(auth);
    } catch (e) {
        // wala namang session dati, okay lang — guest pa rin tayo
    }

    onAuthStateChanged(auth, async (user) => {
        if (!user) {
            // Walang totoong naka-login na Firebase session -> GUEST palagi.
            paintGuestUI();
            return;
        }
        try {
            const snap = await getDoc(doc(db, "customers", user.uid));
            if (snap.exists()) {
                const data = snap.data();
                currentCustomer = data.username;
                currentUID      = user.uid;
                localStorage.setItem("currentCustomer", data.username);
                localStorage.setItem("currentCustomerUID", user.uid);
                applyCustomerData(data, data.username);
            }
        } catch (e) {
            // Kung nabigo ang pagkuha ng profile, huwag na rin mag-fallback
            // sa stale localStorage — panatilihin na lang na guest.
            paintGuestUI();
        }
    });
})();

window.goToProfile = function() { window.location.href = "customer-profile.html"; };

document.getElementById("loginBtn").addEventListener("click", () => {
    window.location.href = "login.html";
});

/* ══════════════════════════════════════════════════════════════
   VIEW 2: SELLER STORES
   ══════════════════════════════════════════════════════════════ */
let allStores   = [];
let allProducts = [];
let sellerStoresLoaded = false;

async function loadSellerStores() {
    const storeList = document.getElementById("storeList");
    const noResults = document.getElementById("noResults");
    document.getElementById("searchInput").value = "";
    noResults.style.display = "none";
    storeList.innerHTML = "<p class='loading-msg'>Loading stores...</p>";

    try {
        const storeSnap  = await getDocs(collection(db, "stores"));
        const sellerSnap = await getDocs(collection(db, "sellers"));
        const productSnap = await getDocs(collection(db, "products"));

        const sellerPicMap = {};
        sellerSnap.forEach(d => {
            const data = d.data();
            if (data.username) sellerPicMap[data.username] = data.profilePic || "";
        });

        allProducts = productSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        allStores = storeSnap.docs.map(d => {
            const data = d.data();
            const photo = data.photo || sellerPicMap[data.seller] || "";
            return { ...data, photo };
        }).filter(s => s.name && s.seller);

        sellerStoresLoaded = true;

        if (allStores.length === 0) {
            storeList.innerHTML = "<p class='empty'>No stores available yet.</p>";
        } else {
            renderStores(allStores, "");
        }
    } catch (err) {
        console.error("Failed to load from Firestore:", err);
        storeList.innerHTML = "<p class='empty'>Could not load stores. Please check your connection.</p>";
    }
}

function renderStores(filteredStores, searchQuery) {
    const storeList = document.getElementById("storeList");
    const noResults = document.getElementById("noResults");
    storeList.innerHTML = "";

    if (filteredStores.length === 0) {
        noResults.style.display = "block";
        return;
    }
    noResults.style.display = "none";

    filteredStores.forEach(store => {
        const sellerUsername = store.seller || store.name;

        const matchingProducts = searchQuery
            ? allProducts.filter(p =>
                p.seller === sellerUsername &&
                p.name.toLowerCase().includes(searchQuery.toLowerCase())
              )
            : [];

        const matchBadge = matchingProducts.length > 0
            ? `<span class="product-match">Has "${escapeHTML(searchQuery)}" (${matchingProducts.length} product${matchingProducts.length > 1 ? 's' : ''})</span>`
            : "";

        const card = document.createElement("div");
        card.className = "store-card";
        card.onclick = function() {
            // No more page navigation — go straight to the shop view.
            goToShop(store);
        };
        card.innerHTML = `
            <div class="store-img-wrap">
                <img src="${store.photo || ''}" alt="${escapeHTML(store.name)}" onerror="this.style.display='none'">
                <div class="store-overlay"><span>Visit Store</span></div>
            </div>
            <div class="store-info">
                <h3>${escapeHTML(store.name)}</h3>
                <p>${escapeHTML(store.location || "Local Store")}</p>
                ${matchBadge}
            </div>
        `;
        storeList.appendChild(card);
    });
}

window.filterStores = function() {
    const q = document.getElementById("searchInput").value.trim();
    if (!q) { renderStores(allStores, ""); return; }
    const ql = q.toLowerCase();
    const filtered = allStores.filter(store => {
        const sellerUsername = store.seller || store.name;
        const storeMatch = store.name.toLowerCase().includes(ql) ||
                           (store.location && store.location.toLowerCase().includes(ql));
        const productMatch = allProducts.some(p =>
            p.seller === sellerUsername && p.name.toLowerCase().includes(ql)
        );
        return storeMatch || productMatch;
    });
    renderStores(filtered, q);
};

/* ══════════════════════════════════════════════════════════════
   VIEW 3: SHOP (product view)
   ══════════════════════════════════════════════════════════════ */
function showLoading(msg) {
    document.getElementById("loadingMsg").textContent = msg || "Loading...";
    document.getElementById("loadingOverlay").classList.add("show");
}
function hideLoading() {
    document.getElementById("loadingOverlay").classList.remove("show");
}
function showStockAlert(message, soldOut = false) {
    document.getElementById("stockAlertIcon").textContent  = soldOut ? "🚫" : "⚠️";
    document.getElementById("stockAlertTitle").textContent = soldOut ? "Sold Out for Today" : "Limited Stock";
    document.getElementById("stockAlertMsg").textContent   = message;
    document.getElementById("stockAlertCard").classList.toggle("sold-out", soldOut);
    document.getElementById("stockAlertOverlay").classList.add("open");
}
function showRequirementAlert(message, icon = "📎", title = "Almost there!") {
    document.getElementById("reqAlertIcon").textContent  = icon;
    document.getElementById("reqAlertTitle").textContent = title;
    document.getElementById("reqAlertMsg").textContent   = message;
    document.getElementById("reqAlertOverlay").classList.add("open");
}
function showLoginRequired() {
    document.getElementById("loginRequiredOverlay").classList.add("open");
}

// ── Shop state (reset every time initShopView runs) ──
let shopSellerUsername = "";
let shopStoreName      = "";
let storeProducts      = [];
let currentMode         = "buy";
let currentProduct      = null;
let quantity             = 1;
let gcashData            = null;
let currentRemainingStock = null;
let shopReviewsUnsub    = null;
let allPublicReviews    = [];
let revFilter            = "all";
const REV_PAGE_SIZE      = 5;
let revShownCount        = REV_PAGE_SIZE;
let carouselIdx          = 0;
let shopPhotos           = [];

async function initShopView(store) {
    shopSellerUsername = (store && (store.seller || store.name)) || "";
    shopStoreName       = shopSellerUsername;

    // Reset per-visit state
    storeProducts = [];
    currentMode = "buy"; currentProduct = null; quantity = 1; gcashData = null;
    currentRemainingStock = null;
    allPublicReviews = []; revFilter = "all"; revShownCount = REV_PAGE_SIZE;
    carouselIdx = 0; shopPhotos = [];
    if (shopReviewsUnsub) { shopReviewsUnsub(); shopReviewsUnsub = null; }

    document.getElementById("storeName").innerText = "Loading...";
    document.getElementById("storeMotto").innerText = "";
    document.getElementById("productGrid").innerHTML = "<p class='empty'>Loading products...</p>";
    document.getElementById("shopCarouselSection").style.display = "none";
    document.getElementById("shopCarouselTrack").innerHTML = "";
    document.getElementById("shopCarouselDots").innerHTML = "";
    document.getElementById("shopLocationCard").style.display = "none";
    document.querySelectorAll(".rev-chip").forEach((c,i) => c.classList.toggle("active", i === 0));
    document.getElementById("reviewsList").innerHTML =
        `<div class="reviews-empty"><span class="reviews-empty-icon">⭐</span>Loading reviews…</div>`;

    showLoading("Loading store...");

    try {
        const stores = await getAllStores();
        const found  = stores.find(s => s.name === store.name) || stores.find(s => s.seller === shopSellerUsername);
        if (found) {
            shopSellerUsername = found.seller || shopSellerUsername;
            document.getElementById("storeName").innerText = found.name;
            if (found.photo) {
                document.getElementById("storeLogo").src = found.photo;
                document.getElementById("bannerBg").style.backgroundImage = `url('${found.photo}')`;
            }
        }
    } catch (e) {
        console.error("Store load failed:", e);
    }

    let profile = {};
    try {
        profile = await getSellerProfile(shopSellerUsername);
    } catch (e) { console.error("Profile load failed:", e); }

    shopStoreName = profile.storeName || shopSellerUsername;

    document.getElementById("storeMotto").innerText = profile.storeMotto || "";
    document.getElementById("infoOwner").innerText  = profile.ownerName   || "—";
    document.getElementById("infoAbout").innerText  = profile.aboutShop   || "—";
    document.getElementById("infoPhone").innerText  = profile.phoneNumber || "—";
    document.getElementById("infoGcash").innerText  = profile.gcashNumber || "—";
    document.getElementById("shopGcash").innerText  = profile.gcashNumber || profile.phoneNumber || "—";

    const fb = document.getElementById("infoFacebook");
    const ig = document.getElementById("infoInstagram");
    fb.innerText = ""; ig.innerText = "";
    if (profile.facebookLink && profile.facebookLink !== "Facebook link") {
        fb.href = profile.facebookLink; fb.innerText = profile.facebookLink;
    } else { fb.innerText = "—"; }
    if (profile.instagramLink && profile.instagramLink !== "Instagram Link") {
        ig.href = profile.instagramLink; ig.innerText = profile.instagramLink;
    }

    // Carousel
    shopPhotos = Array.isArray(profile.storePhotos) ? profile.storePhotos : [];
    if (shopPhotos.length > 0) {
        document.getElementById("shopCarouselSection").style.display = "block";
        const track = document.getElementById("shopCarouselTrack");
        const dots  = document.getElementById("shopCarouselDots");
        shopPhotos.forEach((p, i) => {
            const slide = document.createElement("div");
            slide.className = "shop-carousel-slide";
            const imgSrc = typeof p === "string" ? p : (p.url || p.dataUrl || "");
            slide.innerHTML = `<img src="${imgSrc}" alt="Store photo" onerror="this.parentElement.style.display='none'">`;
            track.appendChild(slide);
            const dot = document.createElement("div");
            dot.className = "shop-carousel-dot" + (i === 0 ? " active" : "");
            dot.addEventListener("click", () => goToSlide(i));
            dots.appendChild(dot);
        });
        const showNavBtns = shopPhotos.length > 1;
        document.getElementById("shopPrevBtn").style.display = showNavBtns ? "flex" : "none";
        document.getElementById("shopNextBtn").style.display = showNavBtns ? "flex" : "none";
    }

    // Location
    if (profile.location) {
        document.getElementById("shopLocationCard").style.display = "block";
        document.getElementById("shopLocationText").innerText = profile.location;
        const frame = document.getElementById("shopMapFrame");
        frame.src = `https://maps.google.com/maps?q=${encodeURIComponent(profile.location)}&output=embed&z=15`;
        frame.style.display = "block";
    }

    // Products
    try {
        storeProducts = await getProductsBySeller(shopSellerUsername);
    } catch (e) {
        console.error("Products load failed:", e);
        storeProducts = [];
    }

    const grid = document.getElementById("productGrid");
    if (storeProducts.length === 0) {
        grid.innerHTML = "<p class='empty'>No products yet.</p>";
    } else {
        grid.innerHTML = "";
        storeProducts.forEach((p, index) => {
            const isAvail = p.available !== false;
            const hasDailyLimit = isAvail && p.dailyStock > 0;
            const card = document.createElement("div");
            card.className = "product-card" + (isAvail ? "" : " unavailable");
            card.innerHTML = `
                <img src="${p.image}" alt="${escapeHTML(p.name)}" onerror="this.style.display='none'">
                <h4>${escapeHTML(p.name)}</h4>
                <p>₱${p.price}</p>
                <span class="availability-badge ${isAvail ? 'avail' : 'unavail'}" id="availBadge-${index}">${isAvail ? 'Available' : 'Not Available'}</span>
                ${hasDailyLimit ? `<span class="stock-badge" id="stockBadge-${index}">Checking stock…</span>` : ""}
                ${isAvail ? `
                <div class="card-actions" id="cardActionsB-${index}" style="padding-top:8px;">
                    <button class="btn-buy" data-idx="${index}" data-mode="buy">Buy Now</button>
                </div>` : ""}
            `;
            grid.appendChild(card);
        });

        grid.querySelectorAll("[data-mode]").forEach(btn => {
            btn.addEventListener("click", () => openModal(
                parseInt(btn.dataset.idx), btn.dataset.mode
            ));
        });

        storeProducts.forEach((p, index) => {
            const isAvail = p.available !== false;
            if (!isAvail || !(p.dailyStock > 0)) return;
            getRemainingStockForProduct(p).then(remaining => {
                const badge = document.getElementById(`stockBadge-${index}`);
                if (!badge) return;
                if (remaining === null) { badge.style.display = "none"; return; }
                if (remaining <= 0) {
                    markProductSoldOut(index);
                } else {
                    badge.textContent = `${remaining} left today`;
                    if (remaining <= 3) badge.classList.add("stock-low");
                }
            });
        });
    }

    hideLoading();

    listenPublicReviews();
}

function goToSlide(idx) {
    carouselIdx = idx;
    document.getElementById("shopCarouselTrack").style.transform = `translateX(-${idx * 100}%)`;
    document.querySelectorAll(".shop-carousel-dot").forEach((d, i) => d.classList.toggle("active", i === idx));
}
document.getElementById("shopPrevBtn").addEventListener("click", () => goToSlide((carouselIdx - 1 + shopPhotos.length) % shopPhotos.length));
document.getElementById("shopNextBtn").addEventListener("click", () => goToSlide((carouselIdx + 1) % shopPhotos.length));
const shopCarouselWrapEl = document.getElementById("shopCarouselWrap");
let touchX = 0;
shopCarouselWrapEl.addEventListener("touchstart", e => { touchX = e.touches[0].clientX; });
shopCarouselWrapEl.addEventListener("touchend",   e => {
    const d = touchX - e.changedTouches[0].clientX;
    if (Math.abs(d) > 40) goToSlide(d > 0 ? (carouselIdx+1)%shopPhotos.length : (carouselIdx-1+shopPhotos.length)%shopPhotos.length);
});

async function getRemainingStockForProduct(product) {
    if (!(product.dailyStock > 0)) return null;
    try {
        const ordersSnap = await getDocs(query(
            collection(db, "orders"),
            where("productId", "==", product.id),
            where("sellerUsername", "==", product.seller || shopSellerUsername)
        ));
        const today = new Date().toISOString().slice(0, 10);
        let soldToday = 0;
        ordersSnap.docs.forEach(d => {
            const data = d.data();
            if (data.status === "cancelled" || data.status === "rejected") return;
            const created = data.createdAt?.seconds
                ? new Date(data.createdAt.seconds * 1000)
                : data.createdAt ? new Date(data.createdAt) : null;
            if (created && created.toISOString().slice(0, 10) === today) {
                soldToday += (data.qty || 1);
            }
        });
        return Math.max(product.dailyStock - soldToday, 0);
    } catch (e) {
        console.error("Stock check failed:", e);
        return null;
    }
}

function markProductSoldOut(index) {
    const stockBadge = document.getElementById(`stockBadge-${index}`);
    if (stockBadge) {
        stockBadge.textContent = "Sold out today";
        stockBadge.classList.add("stock-out");
    }
    const availBadge = document.getElementById(`availBadge-${index}`);
    if (availBadge) {
        availBadge.textContent = "Sold Out";
        availBadge.classList.remove("avail");
        availBadge.classList.add("unavail");
    }
    const actionsB = document.getElementById(`cardActionsB-${index}`);
    if (actionsB) actionsB.style.display = "none";
    const card = stockBadge?.closest(".product-card") || availBadge?.closest(".product-card");
    if (card) card.classList.add("unavailable");
    if (storeProducts[index]) storeProducts[index]._soldOut = true;
}

/* ── Reviews ── */
function listenPublicReviews() {
    const q = query(
        collection(db, "ratings"),
        where("sellerUsername", "==", shopSellerUsername)
    );
    shopReviewsUnsub = onSnapshot(q, async (snap) => {
        allPublicReviews = snap.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .sort((a, b) => (b.ratedAt?.seconds || 0) - (a.ratedAt?.seconds || 0));
        renderReviewSummary();
        renderReviewList();
    }, err => { console.warn("Reviews snapshot error:", err); });
}

function renderReviewSummary() {
    const scores = allPublicReviews.map(r => r.rating || 0);
    const avgEl  = document.getElementById("revAvgScore");
    const starsEl = document.getElementById("revAvgStars");
    const labelEl = document.getElementById("revTotalLabel");

    if (!scores.length) {
        avgEl.textContent  = "—";
        starsEl.innerHTML  = "";
        labelEl.textContent = "No reviews yet";
        return;
    }
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    avgEl.textContent = avg.toFixed(1);
    labelEl.textContent = `${scores.length} review${scores.length !== 1 ? "s" : ""}`;

    starsEl.innerHTML = "";
    for (let i = 1; i <= 5; i++) {
        const s = document.createElement("span");
        s.textContent = "★";
        s.className = "rev-star" + (i <= Math.round(avg) ? " lit" : "");
        starsEl.appendChild(s);
    }
}

function renderReviewList() {
    const listEl = document.getElementById("reviewsList");
    const loadMoreBtn = document.getElementById("revLoadMoreBtn");

    let filtered = [...allPublicReviews];
    if (revFilter === "5")           filtered = filtered.filter(r => r.rating === 5);
    else if (revFilter === "4")      filtered = filtered.filter(r => r.rating === 4);
    else if (revFilter === "low")    filtered = filtered.filter(r => r.rating <= 3);
    else if (revFilter === "withcomment") filtered = filtered.filter(r => {
        const txt = r.review || r.comment || r.ratingComment || "";
        return txt.trim().length > 0;
    });

    if (!filtered.length) {
        listEl.innerHTML = `
            <div class="reviews-empty">
                <span class="reviews-empty-icon">⭐</span>
                No reviews here yet. Be the first to rate this store!
            </div>`;
        loadMoreBtn.style.display = "none";
        return;
    }

    const shown = filtered.slice(0, revShownCount);
    listEl.innerHTML = shown.map((r, i) => buildPublicReviewCard(r, i)).join("");

    shown.forEach(r => {
        const btn = document.getElementById(`pub-reply-btn-${r.id}`);
        if (btn) btn.addEventListener("click", () => openCustReplyBox(r.id));
        const cancelBtn = document.getElementById(`pub-cancel-reply-${r.id}`);
        if (cancelBtn) cancelBtn.addEventListener("click", () => closeCustReplyBox(r.id));
        const sendBtn = document.getElementById(`pub-send-reply-${r.id}`);
        if (sendBtn) sendBtn.addEventListener("click", () => submitCustReply(r.id));
    });

    loadMoreBtn.style.display = filtered.length > revShownCount ? "block" : "none";
}

function buildPublicReviewCard(r, animIdx) {
    const name     = r.customerName || r.customerUsername || "Customer";
    const initials = name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();
    const rating   = r.rating || 0;
    const comment  = r.review || r.comment || r.ratingComment || "";
    const time     = r.ratedAt?.toDate ? timeAgo(r.ratedAt.toDate()) : "recently";

    const productName  = r.productName  || r.name  || "";
    const productImage = r.productImage || r.image || "";
    const productSize  = r.size  ? `Size: ${r.size}` : "";
    const productQty   = r.qty   ? `×${r.qty}`        : "";
    const productPrice = r.price ? `₱${r.price}`      : "";

    const productPreviewHTML = productName ? `
        <div style="display:flex;align-items:center;gap:10px;padding:9px 12px;background:#fff8f0;border:1px solid #ffe0b2;border-radius:10px;margin-bottom:10px;">
            ${productImage
                ? `<img src="${escapeHTML(productImage)}" alt="${escapeHTML(productName)}"
                       style="width:48px;height:48px;border-radius:8px;object-fit:cover;border:1px solid #ffd5a0;flex-shrink:0;"
                       onerror="this.style.display='none'">`
                : `<div style="width:48px;height:48px;border-radius:8px;background:#ffe5c2;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:20px;">🛍️</div>`}
            <div style="flex:1;min-width:0;">
                <div style="font-size:12px;font-weight:700;color:#b35000;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHTML(productName)}</div>
                <div style="font-size:11px;color:#c47a30;margin-top:2px;display:flex;gap:6px;flex-wrap:wrap;">
                    ${productSize  ? `<span>${escapeHTML(productSize)}</span>`  : ""}
                    ${productQty   ? `<span>${escapeHTML(productQty)}</span>`   : ""}
                    ${productPrice ? `<span style="font-weight:700;">${escapeHTML(productPrice)}</span>` : ""}
                </div>
            </div>
            <div style="font-size:10px;color:#f5a623;font-weight:700;white-space:nowrap;">⭐ Rated</div>
        </div>` : "";

    let cardClass = "";
    if (rating === 5) cardClass = "five-star";
    else if (rating <= 2) cardClass = "low-star";

    const starsHTML = [1,2,3,4,5].map(i =>
        `<span class="${i <= rating ? "lit" : ""}">★</span>`
    ).join("");

    const commentHTML = comment.trim()
        ? `<div class="pub-rev-comment">"${escapeHTML(comment)}"</div>`
        : `<div class="pub-rev-no-comment">No written comment.</div>`;

    let sellerReplyHTML = "";
    if (r.sellerReply) {
        const replyTime = r.sellerReplyAt?.toDate ? timeAgo(r.sellerReplyAt.toDate()) : "";
        const custReplies = Array.isArray(r.customerReplies) ? r.customerReplies : [];
        const custRepliesHTML = custReplies.length
            ? `<div class="pub-customer-replies">
                ${custReplies.map(cr => {
                    const crName     = cr.customerName || cr.customerUsername || "Customer";
                    const crInitials = crName.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();
                    const crTime     = cr.repliedAt?.toDate ? timeAgo(cr.repliedAt.toDate())
                                     : cr.repliedAt ? timeAgo(new Date(cr.repliedAt)) : "";
                    return `
                        <div class="pub-cust-reply-bubble">
                            <div class="pub-cust-reply-initials">${escapeHTML(crInitials)}</div>
                            <div class="pub-cust-reply-inner">
                                <div class="pub-cust-reply-name">${escapeHTML(crName)}</div>
                                <div class="pub-cust-reply-text">${escapeHTML(cr.text)}</div>
                                <div class="pub-cust-reply-time">${crTime}</div>
                            </div>
                        </div>`;
                }).join("")}
               </div>`
            : "";

        const isOriginalReviewer = r.customerUID === currentUID;
        const replyBtnHTML = isOriginalReviewer
            ? `<button class="pub-reply-to-seller-btn" id="pub-reply-btn-${r.id}">
                 💬 Reply to seller
               </button>`
            : "";

        const replyInputHTML = isOriginalReviewer ? `
            <div class="pub-cust-reply-input-wrap" id="pub-reply-box-${r.id}">
                <div class="pub-cust-reply-label">💬 Reply to seller's response</div>
                <textarea class="pub-cust-reply-textarea"
                    id="pub-reply-ta-${r.id}"
                    placeholder="Write your reply to the seller…"
                    maxlength="300"></textarea>
                <div class="pub-cust-reply-actions">
                    <button class="pub-cancel-reply" id="pub-cancel-reply-${r.id}">Cancel</button>
                    <button class="pub-send-reply" id="pub-send-reply-${r.id}">
                        ➤ Send
                    </button>
                </div>
            </div>` : "";

        sellerReplyHTML = `
            <div class="pub-seller-reply">
                <div class="pub-seller-avatar">🏪</div>
                <div class="pub-seller-reply-content">
                    <div class="pub-seller-reply-header">
                        <span class="pub-seller-label">${escapeHTML(shopStoreName)}</span>
                        <span class="pub-seller-badge">Seller</span>
                        <span class="pub-seller-reply-time">${replyTime}</span>
                    </div>
                    <div class="pub-seller-reply-text">${escapeHTML(r.sellerReply)}</div>
                    ${replyBtnHTML}
                </div>
            </div>
            ${custRepliesHTML}
            ${replyInputHTML}`;
    }

    return `
        <div class="pub-review-card ${cardClass}" style="animation-delay:${animIdx * 0.05}s">
            <div class="pub-rev-header">
                <div class="pub-rev-initials">${escapeHTML(initials)}</div>
                <div class="pub-rev-meta">
                    <div class="pub-rev-name">${escapeHTML(name)}</div>
                    <div class="pub-rev-time">${time}</div>
                </div>
                <div class="pub-rev-stars">
                    ${starsHTML}
                    <span class="pub-rev-rating-num">${rating}.0</span>
                </div>
            </div>
            ${productPreviewHTML}
            ${commentHTML}
            ${sellerReplyHTML}
        </div>`;
}

function openCustReplyBox(ratingId) {
    const box = document.getElementById(`pub-reply-box-${ratingId}`);
    if (!box) return;
    box.classList.add("open");
    const ta = document.getElementById(`pub-reply-ta-${ratingId}`);
    if (ta) { ta.focus(); }
    box.scrollIntoView({ behavior: "smooth", block: "nearest" });
}
function closeCustReplyBox(ratingId) {
    const box = document.getElementById(`pub-reply-box-${ratingId}`);
    if (box) box.classList.remove("open");
}
async function submitCustReply(ratingId) {
    const ta  = document.getElementById(`pub-reply-ta-${ratingId}`);
    const btn = document.getElementById(`pub-send-reply-${ratingId}`);
    if (!ta) return;

    const text = ta.value.trim();
    if (!text) { showToast("⚠️ Please write something first."); ta.focus(); return; }

    btn.disabled = true;
    btn.textContent = "Sending…";

    try {
        const ratingRef = doc(db, "ratings", ratingId);
        const snap = await getDoc(ratingRef);
        const existing = snap.exists() ? (snap.data().customerReplies || []) : [];

        const newReply = {
            customerUID:      currentUID,
            customerUsername: currentCustomer,
            customerName:     currentCustomer,
            text,
            repliedAt:        new Date().toISOString()
        };

        await updateDoc(ratingRef, {
            customerReplies: [...existing, newReply]
        });

        showToast("✅ Reply sent!");
        closeCustReplyBox(ratingId);
        ta.value = "";
    } catch (err) {
        console.error(err);
        showToast("❌ Failed to send reply.");
        btn.disabled = false;
        btn.textContent = "➤ Send";
    }
}

window.filterReviews = function(filter, btn) {
    revFilter    = filter;
    revShownCount = REV_PAGE_SIZE;
    document.querySelectorAll(".rev-chip").forEach(c => c.classList.remove("active"));
    btn.classList.add("active");
    renderReviewList();
};
window.loadMoreReviews = function() {
    revShownCount += REV_PAGE_SIZE;
    renderReviewList();
};

/* ── Order modal ── */
function openModal(index, mode) {
    if (!currentUID) {
        showLoginRequired();
        return;
    }

    currentProduct = storeProducts[index];
    currentMode    = mode;
    quantity       = 1;
    gcashData      = null;
    currentRemainingStock = null;

    if (currentProduct?._soldOut) {
        markProductSoldOut(index);
        showStockAlert("Sorry, this product is sold out for today! Please check back tomorrow.", true);
        return;
    }

    document.getElementById("modalImg").src        = currentProduct.image;
    document.getElementById("modalName").innerText = currentProduct.name;
    document.getElementById("qtyNum").value = 1;

    const stockHint = document.getElementById("stockHint");
    stockHint.style.display = "none";
    stockHint.classList.remove("hint-low", "hint-out");
    if (currentProduct.dailyStock > 0) {
        getRemainingStockForProduct(currentProduct).then(remaining => {
            currentRemainingStock = remaining;
            if (remaining === null) return;
            stockHint.style.display = "block";
            if (remaining <= 0) {
                stockHint.textContent = "🚫 Sold out for today.";
                stockHint.classList.add("hint-out");
            } else {
                stockHint.textContent = `⚠️ Only ${remaining} left today.`;
                if (remaining <= 3) stockHint.classList.add("hint-low");
            }
        });
    }

    const hasSizes = currentProduct.prices &&
        typeof currentProduct.prices === 'object' &&
        (currentProduct.prices['Small'] || currentProduct.prices['Medium'] || currentProduct.prices['Large']);
    document.getElementById("sizeLabel").style.display  = hasSizes ? "block" : "none";
    document.getElementById("sizeOptions").style.display = hasSizes ? "flex"  : "none";

    document.querySelectorAll(".size-btn").forEach((b, i) => b.classList.toggle("selected", i === 0));
    updateModalPrice();

    document.getElementById("gcashUpload").value = "";
    document.getElementById("gcashPreview").style.display = "none";

    document.getElementById("reserveSection").style.display = "none";

    const btn = document.getElementById("modalActionBtn");
    btn.textContent = "Buy Now — Go to Payment";
    btn.className   = "modal-action-btn buy-confirm";

    document.getElementById("modalOverlay").classList.add("open");
}

function getSelectedSize() {
    const sel = document.querySelector(".size-btn.selected");
    return sel ? sel.innerText : "Small";
}
function getPrice() {
    const prices = currentProduct?.prices;
    if (prices && Object.keys(prices).length > 0) {
        const size = getSelectedSize();
        return prices[size] || currentProduct.price;
    }
    return currentProduct?.price || "0";
}
function updateModalPrice() {
    if (!currentProduct) return;
    document.getElementById("modalPrice").innerText = "₱" + getPrice();
}

document.querySelectorAll(".size-btn").forEach(btn => {
    btn.addEventListener("click", () => {
        document.querySelectorAll(".size-btn").forEach(b => b.classList.remove("selected"));
        btn.classList.add("selected");
        updateModalPrice();
    });
});

document.getElementById("qtyNum").addEventListener("input", function() {
    const val = parseInt(this.value);
    if (!isNaN(val) && val >= 1) {
        if (currentRemainingStock !== null && val > currentRemainingStock) {
            quantity = currentRemainingStock > 0 ? currentRemainingStock : 1;
            this.value = quantity;
            showStockAlert(
                currentRemainingStock > 0
                    ? `Only ${currentRemainingStock} left today! Quantity has been adjusted.`
                    : "Sorry, this product is sold out for today!",
                currentRemainingStock <= 0
            );
        } else {
            quantity = val;
        }
    } else {
        quantity = 1;
    }
});

document.getElementById("qtyMinus").addEventListener("click", () => {
    if (quantity > 1) {
        quantity--;
        document.getElementById("qtyNum").value = quantity;
    }
});
document.getElementById("qtyPlus").addEventListener("click", () => {
    if (currentRemainingStock !== null && quantity >= currentRemainingStock) {
        showStockAlert(
            currentRemainingStock > 0
                ? `Only ${currentRemainingStock} left today! You can't add more than that.`
                : "Sorry, this product is sold out for today!",
            currentRemainingStock <= 0
        );
        return;
    }
    quantity++;
    document.getElementById("qtyNum").value = quantity;
});

document.getElementById("modalCloseBtn").addEventListener("click", () => {
    document.getElementById("modalOverlay").classList.remove("open");
});
document.getElementById("modalBackBtn").addEventListener("click", () => {
    document.getElementById("modalOverlay").classList.remove("open");
});
document.getElementById("modalOverlay").addEventListener("click", e => {
    if (e.target === document.getElementById("modalOverlay"))
        document.getElementById("modalOverlay").classList.remove("open");
});

document.getElementById("gcashUpload").addEventListener("change", function() {
    const file = this.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
        gcashData = e.target.result;
        const prev = document.getElementById("gcashPreview");
        prev.src = gcashData; prev.style.display = "block";
    };
    reader.readAsDataURL(file);
});

document.getElementById("modalActionBtn").addEventListener("click", async () => {
    if (!currentUID) {
        document.getElementById("modalOverlay").classList.remove("open");
        showLoginRequired();
        return;
    }

    const size  = getSelectedSize();
    const price = getPrice();

    if (currentProduct.dailyStock > 0) {
        showLoading("Checking stock...");
        try {
            const ordersSnap = await getDocs(query(
                collection(db, "orders"),
                where("productId", "==", currentProduct.id),
                where("sellerUsername", "==", currentProduct.seller || shopSellerUsername)
            ));
            const today = new Date().toISOString().slice(0, 10);
            let soldToday = 0;
            ordersSnap.docs.forEach(d => {
                const data = d.data();
                if (data.status === "cancelled" || data.status === "rejected") return;
                const created = data.createdAt?.seconds
                    ? new Date(data.createdAt.seconds * 1000)
                    : data.createdAt ? new Date(data.createdAt) : null;
                if (created && created.toISOString().slice(0, 10) === today) {
                    soldToday += (data.qty || 1);
                }
            });
            const remaining = currentProduct.dailyStock - soldToday;
            currentRemainingStock = remaining;
            if (remaining <= 0) {
                hideLoading();
                const soldOutIdx = storeProducts.indexOf(currentProduct);
                if (soldOutIdx > -1) markProductSoldOut(soldOutIdx);
                showStockAlert("Sorry, this product is sold out for today! Please check back tomorrow.", true);
                document.getElementById("modalOverlay").classList.remove("open");
                return;
            }
            if (quantity > remaining) {
                hideLoading();
                showStockAlert(`Only ${remaining} left today! Please reduce your quantity to ${remaining} or less.`, false);
                return;
            }
        } catch (e) {
            hideLoading();
        }
        hideLoading();
    }

    localStorage.setItem("buynow_" + currentCustomer, JSON.stringify({
        name: currentProduct.name, price, image: currentProduct.image,
        seller: currentProduct.seller || shopSellerUsername, size, qty: quantity,
        productId: currentProduct.id
    }));
    localStorage.removeItem("checkoutItems_" + currentCustomer);
    document.getElementById("modalOverlay").classList.remove("open");
    window.location.href = "payment.html";
});

/* ── Stock / requirement / login modal chrome (static, wired once) ── */
document.getElementById("stockAlertBtn").addEventListener("click", () => {
    document.getElementById("stockAlertOverlay").classList.remove("open");
});
document.getElementById("stockAlertOverlay").addEventListener("click", e => {
    if (e.target === document.getElementById("stockAlertOverlay"))
        document.getElementById("stockAlertOverlay").classList.remove("open");
});
document.getElementById("reqAlertBtn").addEventListener("click", () => {
    document.getElementById("reqAlertOverlay").classList.remove("open");
});
document.getElementById("reqAlertOverlay").addEventListener("click", e => {
    if (e.target === document.getElementById("reqAlertOverlay"))
        document.getElementById("reqAlertOverlay").classList.remove("open");
});
document.getElementById("loginRequiredBtn").addEventListener("click", () => {
    window.location.href = "login.html";
});
document.getElementById("loginRequiredOverlay").addEventListener("click", e => {
    if (e.target === document.getElementById("loginRequiredOverlay"))
        document.getElementById("loginRequiredOverlay").classList.remove("open");
});

/* ══════════════════════════════════════════════════════════════
   START ON HOME VIEW
   ══════════════════════════════════════════════════════════════ */
showView("view-home");
