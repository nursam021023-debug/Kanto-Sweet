/**
 * db.js  —  Central Firestore data layer for DA LOCAL
 *
 * ============================================================================
 * SUMMARY (para malinaw): Walang binago sa file na ito.
 * Ang orihinal mong code ay TAMA NA at KUMPLETO NA para sa feature na:
 * "Makikita ni customer kung sino ang mag-de-deliver kapag in-accept ni
 *  rider ang booking."
 *
 * Paano gumagana ang buong flow (walang kailangang idagdag pa):
 *
 * 1. Seller nag-send ng request sa isang rider
 *       -> requestRiderForOrder(orderId, riderUID, riderUsername)
 *       -> nagse-set: requestedRiderUID, requestedRiderUsername,
 *          requestStatus = "pending"
 *
 * 2. Rider tumatanggap (Accept) sa rider-dashboard.html
 *       -> acceptRiderRequest(orderId, riderUID, riderUsername)
 *       -> nagse-set: assignedRider (PANGALAN), assignedRiderUID,
 *          requestStatus = "accepted", status = "to-receive"
 *       (Ito yung function sa baba — TAMA NA, walang binago.)
 *
 * 3. Sa to-receive.html (view ni customer):
 *       -> kinukuha lahat ng order kung saan status === "to-receive"
 *       -> kapag may assignedRiderUID, ipinapakita ang live-track-box
 *          gamit ang assignedRider bilang pangalan ng rider, at
 *          sinusundan ang live GPS location niya via
 *          subscribeToRiderLocation()
 *
 * Kaya sa sandaling mag-"Accept" ang rider sa request, automatic na:
 *   - lumilipat ang order sa "To Receive" tab ni customer
 *   - lumalabas ang pangalan ng rider (hindi na generic na "Rider")
 *   - lumalabas ang live map na sumusubaybay sa kanyang GPS
 *
 * ============================================================================
 * UPDATE (bago): idinagdag ang DISTANCE-BASED DELIVERY FEE section sa
 * ibaba (see "DELIVERY FEE / DISTANCE"). Ito ay ginagamit ni payment.html
 * para kwentahin ang extra delivery charge base sa layo ng address ng
 * customer mula sa store ng seller, gamit ang Haversine formula (straight
 * -line distance — walang kailangang external Maps API key).
 *
 * IMPORTANTE: Para gumana ito nang tama, kailangang may `lat` at `lng`
 * fields ang:
 *   - stores/{sellerUID}   (store.lat, store.lng)
 *   - addresses/{addressId} (address.lat, address.lng)
 * Kung wala pang coordinates ang alinman dito (hal. hindi pa na-uupdate
 * ang add-new-address.html para mag-capture ng GPS), gagamit na lang ito
 * ng FLAT FALLBACK FEE (see DELIVERY_FLAT_FALLBACK below) at ma-la-label
 * ang fee bilang "flat-fallback" sa order document, para malinaw sa UI na
 * estimate lang ito hanggang ma-set up ang coordinates.
 *
 * UPDATE 2 (bago): idinagdag ang CHATS section (see "CHATS (rider <->
 * customer)"). Ito ang function na TALAGANG gumagawa ng "chats/{chatId}"
 * document — dati, wala nito kahit saan sa buong project, kaya kahit
 * tama na ang chat.html (customer) at rider-message.html (rider), walang
 * laman/walang koneksyon talaga ang dalawa dahil walang chat thread na
 * ginawa. Tingnan ang detalyadong paliwanag sa section na 'yon sa baba.
 *
 * UPDATE 3 (bago): idinagdag ang PICKUP LOCATION section (see
 * "PICKUP LOCATION (rider dashboard)") sa ibaba. Ito ang naglalagay ng
 * `pickupLocation` field sa bawat order na ipinapakita sa rider —
 * kinukuha mula sa "location" na naka-save ng seller sa
 * profile-seller.html (stores/{sellerUID}.location), para makita ni
 * rider kung saan siya kukuha ng order pag-accept niya nito.
 * ============================================================================
 *
 * Collections used:
 *   customers/{uid}           – customer accounts
 *   sellers/{uid}             – seller accounts
 *   sellerProfiles/{username} – seller profile details
 *   stores/{uid}              – store listing info (ideally may lat/lng, at "location" string)
 *   products/{auto}           – products (field: seller=username)
 *   orders/{auto}             – all orders (fields: customerUID, sellerUsername, status …)
 *   addresses/{auto}          – delivery addresses (field: customerUID, ideally may lat/lng)
 *   riders/{riderUID}         – rider accounts (fields: username, profilePic, available, location)
 *   chats/{orderId}           – rider<->customer chat thread (1 per order, see CHATS section)
 */

import { initializeApp }    from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
    getFirestore,
    collection, doc,
    getDoc, getDocs, addDoc, setDoc, updateDoc, deleteDoc,
    query, where, orderBy, serverTimestamp, onSnapshot, arrayUnion
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

const firebaseConfig = {
    apiKey:            "AIzaSyBaDezXv4aynvYTJaaZyXwIRIImLBEYwB0",
    authDomain:        "dalocal-8ceb3.firebaseapp.com",
    projectId:         "dalocal-8ceb3",
    storageBucket:     "dalocal-8ceb3.appspot.com",
    messagingSenderId: "737186112999",
    appId:             "1:737186112999:web:f61d20523f4ac479f8c942"
};

const app  = initializeApp(firebaseConfig);
export const db   = getFirestore(app);
export const auth = getAuth(app);

// ─── CUSTOMERS ────────────────────────────────────────────────────────────────

export async function getCustomer(uid) {
    const snap = await getDoc(doc(db, "customers", uid));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function saveCustomerProfile(uid, data) {
    await setDoc(doc(db, "customers", uid), data, { merge: true });
}

// ─── SELLERS ──────────────────────────────────────────────────────────────────

export async function getSellerByUsername(username) {
    const snap = await getDocs(query(collection(db, "sellers"), where("username", "==", username)));
    if (snap.empty) return null;
    return { id: snap.docs[0].id, ...snap.docs[0].data() };
}

export async function getSellerProfile(username) {
    const snap = await getDoc(doc(db, "sellerProfiles", username));
    return snap.exists() ? snap.data() : {};
}

export async function saveSellerProfile(username, data) {
    await setDoc(doc(db, "sellerProfiles", username), data, { merge: true });
}

// ─── STORES ───────────────────────────────────────────────────────────────────

export async function getAllStores() {
    const snap = await getDocs(collection(db, "stores"));
    return snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(s => s.name && s.seller);
}

export async function getStore(sellerUID) {
    const snap = await getDoc(doc(db, "stores", sellerUID));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function saveStore(sellerUID, data) {
    await setDoc(doc(db, "stores", sellerUID), data, { merge: true });
}

// ─── PICKUP LOCATION (rider dashboard) ────────────────────────────────────────
//
// Riders need to see WHERE to pick up an order — i.e. the seller's store
// location, the same plain-text string sellers set on profile-seller.html
// under "📍 Store Location" (saved to stores/{sellerUID}.location via
// saveProfile() in that page). Orders themselves don't carry this, so we
// look it up from the "stores" collection — which is keyed by sellerUID but
// also carries a "seller" field equal to the seller's username (see
// getAllStores() above, and profile-seller.html's saveProfile(), which
// writes `seller: currentSeller` onto stores/{sellerUID}) — and stamp it
// onto each order as `pickupLocation` before handing the list back to
// rider-dashboard.html.
//
// Batched + cached per call by sellerUsername, so a list with many orders
// from the same seller only queries "stores" once for that seller, not
// once per order.

async function getStoreLocationBySellerUsername(sellerUsername) {
    if (!sellerUsername) return "";
    const snap = await getDocs(query(collection(db, "stores"), where("seller", "==", sellerUsername)));
    if (snap.empty) return "";
    return snap.docs[0].data().location || "";
}

/**
 * Given an array of order objects (each with a sellerUsername field),
 * returns a new array where every order also has `pickupLocation` set to
 * that seller's store location string (or "" if the seller hasn't set one
 * yet). Used by getToReceiveOrdersForDelivery() and
 * getPendingRiderRequests() so rider-dashboard.html can show "Pickup at: …"
 * and link straight to Google Maps directions to the seller.
 */
async function attachPickupLocations(orders) {
    const usernames = [...new Set(orders.map(o => o.sellerUsername).filter(Boolean))];
    const locationMap = {};
    await Promise.all(usernames.map(async (username) => {
        locationMap[username] = await getStoreLocationBySellerUsername(username);
    }));
    return orders.map(o => ({
        ...o,
        pickupLocation: o.sellerUsername ? (locationMap[o.sellerUsername] || "") : ""
    }));
}

// ─── PRODUCTS ─────────────────────────────────────────────────────────────────

export async function getProductsBySeller(sellerUsername) {
    const snap = await getDocs(query(collection(db, "products"), where("seller", "==", sellerUsername)));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function addProduct(data) {
    return await addDoc(collection(db, "products"), data);
}

export async function updateProduct(productId, data) {
    await updateDoc(doc(db, "products", productId), data);
}

export async function deleteProduct(productId) {
    await deleteDoc(doc(db, "products", productId));
}

// ─── ORDERS ───────────────────────────────────────────────────────────────────

/**
 * Place a new order. Stores into Firestore "orders" collection.
 * @param {Object} orderData - should include: customerUID, customerUsername,
 *   sellerUsername, items[], paymentMethod, address, status, gcashScreenshot?, referenceNum?
 */
/** Count pending orders for a seller (status === "pending") */
export async function getPendingOrderCountForSeller(sellerUsername) {
    const snap = await getDocs(query(
        collection(db, "orders"),
        where("sellerUsername", "==", sellerUsername),
        where("status", "==", "pending")
    ));
    return snap.size;
}

export async function placeOrder(orderData) {
    return await addDoc(collection(db, "orders"), {
        ...orderData,
        createdAt: serverTimestamp()
    });
}

/** Get all orders for a customer */
export async function getOrdersByCustomer(customerUID) {
    const snap = await getDocs(query(
        collection(db, "orders"),
        where("customerUID", "==", customerUID)
    ));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/** Get all orders for a seller */
export async function getOrdersBySeller(sellerUsername) {
    const snap = await getDocs(query(
        collection(db, "orders"),
        where("sellerUsername", "==", sellerUsername)
    ));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/** Update an order's status */
export async function updateOrderStatus(orderId, status) {
    await updateDoc(doc(db, "orders", orderId), { status, updatedAt: serverTimestamp() });
}

/**
 * Listen to a single order in real time (status changes, rider assignment, etc).
 * @returns {Function} unsubscribe function — call it to stop listening.
 */
export function subscribeToOrder(orderId, callback) {
    return onSnapshot(doc(db, "orders", orderId), (snap) => {
        callback(snap.exists() ? { id: snap.id, ...snap.data() } : null);
    });
}

// ─── DELIVERY FEE / DISTANCE (NEW) ────────────────────────────────────────────
//
// Straight-line (Haversine) distance between the seller's store and the
// customer's chosen delivery address, used to compute an extra distance-based
// delivery fee at checkout. No external Maps API key required.
//
// Requires `lat` / `lng` numbers on both the store doc and the address doc.
// If either is missing, computeDeliveryFee() automatically falls back to a
// flat fee so checkout never breaks — it just won't be distance-accurate
// until those coordinates are captured (e.g. in add-new-address.html via
// navigator.geolocation, and in the seller's store-setup page).

const EARTH_RADIUS_KM        = 6371;
export const DELIVERY_BASE_FEE      = 25;  // ₱ flat base, added on top of per-km charge
export const DELIVERY_PER_KM        = 8;   // ₱ per kilometer
export const DELIVERY_FLAT_FALLBACK = 49;  // ₱ used only when coordinates are missing

/** Straight-line distance in km between two lat/lng points. Returns null if any coord is missing/invalid. */
export function calculateDistanceKm(lat1, lng1, lat2, lng2) {
    if ([lat1, lng1, lat2, lng2].some(v => v === null || v === undefined || isNaN(v))) return null;
    const toRad = d => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return EARTH_RADIUS_KM * c;
}

/**
 * Computes the delivery fee for an order given the store's and the
 * customer address's coordinates.
 * @param {{lat:number,lng:number}|null} storeCoords
 * @param {{lat:number,lng:number}|null} addressCoords
 * @returns {{fee:number, distanceKm:number|null, method:"distance"|"flat-fallback"}}
 */
export function computeDeliveryFee(storeCoords, addressCoords) {
    const distanceKm = (storeCoords && addressCoords)
        ? calculateDistanceKm(storeCoords.lat, storeCoords.lng, addressCoords.lat, addressCoords.lng)
        : null;

    if (distanceKm === null) {
        return { fee: DELIVERY_FLAT_FALLBACK, distanceKm: null, method: "flat-fallback" };
    }
    const fee = Math.round(DELIVERY_BASE_FEE + distanceKm * DELIVERY_PER_KM);
    return { fee, distanceKm: Math.round(distanceKm * 10) / 10, method: "distance" };
}

// ─── AUTOMATIC PAYMENT VERIFICATION ──────────────────────────────────────────
//
// NOTE: There is no live GCash/bank API connected to this project, so a
// screenshot's authenticity can't be checked against GCash's own servers.
// What we CAN automate is the seller's manual step of opening every
// screenshot and eyeballing it: as soon as the customer submits a GCash
// reference number + screenshot at checkout, the order is instantly marked
// "auto-verified" and the seller dashboard no longer requires them to open
// and review it before moving the order forward.
/**
 * Mark a GCash order as automatically verified right after the customer
 * submits their proof of payment. Call this from payment.html.
 */
export async function autoVerifyGcashPayment(orderId, referenceNum) {
    await updateDoc(doc(db, "orders", orderId), {
        paymentStatus: "auto-verified",
        paymentVerified: true,
        paymentVerifiedAt: serverTimestamp(),
        referenceNum: referenceNum || ""
    });
}

// ─── RIDER LIVE GPS TRACKING ──────────────────────────────────────────────────
//
// riders/{riderUID}.location = { lat, lng, updatedAt } — a single live
// position per rider, updated continuously while they have active
// deliveries. Orders store which rider is currently carrying them
// (assignedRiderUID) so the customer can look up that rider's live spot.

//** Rider claims an order for delivery + live tracking. */
export async function assignRiderToOrder(orderId, riderUsername, riderUID) {
    // Kunin muna ang order para makuha ang customerUID/customerUsername/orderName
    // — kailangan ito para makagawa (o ma-refresh) ng chat thread, kagaya ng
    // ginagawa na ng acceptRiderRequest() sa "Delivery requests" flow. Dati,
    // ang self-claim path na ito ay hindi gumagawa ng chats/{orderId} doc,
    // kaya nakakapag-send ang customer pero hindi nakikita ng rider sa
    // rider-message.html inbox niya (walang riderUID field na matutugma
    // dahil walang parent chat doc na nagawa).
    const orderSnap = await getDoc(doc(db, "orders", orderId));
    const order = orderSnap.exists() ? orderSnap.data() : {};

    await updateDoc(doc(db, "orders", orderId), {
        assignedRider:    riderUsername,
        assignedRiderUID: riderUID
    });

    if (order.customerUID) {
        await getOrCreateChatForOrder(orderId, {
            customerUID: order.customerUID,
            customerUsername: order.customerUsername || "Customer",
            riderUID,
            riderUsername,
            orderName: order.name || orderId
        });
    }
}

/**
 * Push the rider's current GPS coordinates (called repeatedly while
 * delivering). `accuracy` (meters, from the browser's GeolocationPosition)
 * is optional but recommended — it's what tells you whether a location is
 * a real GPS fix or just a rough WiFi/cell-tower/IP-based guess (the
 * latter is what makes riders sometimes appear to be in Metro Manila
 * regardless of where they actually are).
 */
export async function updateRiderLocation(riderUID, lat, lng, accuracy = null) {
    await setDoc(doc(db, "riders", riderUID), {
        location: { lat, lng, accuracy, updatedAt: serverTimestamp() }
    }, { merge: true });
}

/**
 * Listen to a rider's live location in real time.
 * @returns {Function} unsubscribe function.
 */
export function subscribeToRiderLocation(riderUID, callback) {
    return onSnapshot(doc(db, "riders", riderUID), (snap) => {
        callback(snap.exists() ? (snap.data().location || null) : null);
    });
}

// ─── DELIVERY / RIDERS ──────────────────────────────────────────────────────

export async function getDeliveryByUsername(username) {
    const snap = await getDocs(query(collection(db, "riders"), where("username", "==", username)));
    if (snap.empty) return null;
    return { id: snap.docs[0].id, ...snap.docs[0].data() };
}

/**
 * Kunin ang rider profile gamit mismo ang UID (doc ID), hindi username query.
 * Mas maaasahan ito kaysa getDeliveryByUsername() kapag:
 *   - may 2+ riders docs na parehong "username" (duplicate account) — dito
 *     wala nang epekto yun, dahil UID mismo ang tinitignan, hindi field
 *     match na pwedeng tumama sa maling doc.
 *   - nag-edit ng username ang rider PAGKATAPOS ma-assign sa isang order —
 *     dito rin walang epekto, dahil hindi nagbabago ang UID kailanman,
 *     kahit magbago ang display name.
 * Gamitin ito sa mga pages na may access na sa order.assignedRiderUID
 * (hal. to-receive.html), sa halip na order.assignedRider (username string).
 */
export async function getRiderById(riderUID) {
    if (!riderUID) return null;
    const snap = await getDoc(doc(db, "riders", riderUID));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/** Orders that are ready for pickup/delivery (status === "to-ship") */
export async function getToShipOrdersForDelivery() {
    const snap = await getDocs(query(collection(db, "orders"), where("status", "==", "to-ship")));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/**
 * Orders visible to RIDERS (status === "to-receive").
 * A rider should never see an order while it is still "to-ship" — the
 * seller has to move it to "to-receive" first. Once it's "to-receive",
 * it shows up here for the rider to pick up / deliver.
 *
 * Each order also comes back with a `pickupLocation` field (the seller's
 * store location — see "PICKUP LOCATION" section above) so
 * rider-dashboard.html can show the rider exactly where to go pick up the
 * item, and link to Google Maps directions there.
 */
export async function getToReceiveOrdersForDelivery() {
    const snap = await getDocs(query(collection(db, "orders"), where("status", "==", "to-receive")));
    const orders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    return await attachPickupLocations(orders);
}

/** Orders a specific rider has already delivered (proof already submitted) */
export async function getDeliveredOrdersByRider(riderUsername) {
    const snap = await getDocs(query(
        collection(db, "orders"),
        where("deliveredByRider", "==", riderUsername)
    ));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/**
 * Rider submits proof that the order was delivered to the customer.
 * IMPORTANT: this does NOT touch the shared order.status field — that
 * field drives the seller's own manual status flow on
 * approval-of-order.html, and should stay under the seller's control.
 * Instead, this only records the proof photo + who delivered it, plus a
 * separate riderDeliveryStatus flag the RIDER'S OWN dashboard uses to
 * treat the order as done and drop it from their active list. The seller
 * still sees the photo (via deliveryProof) and can move the order's real
 * status forward themselves whenever they want.
 */
export async function submitDeliveryProof(orderId, riderUsername, proofPhoto) {
    await updateDoc(doc(db, "orders", orderId), {
        deliveryProof: proofPhoto,
        deliveredByRider: riderUsername,
        proofSubmittedAt: serverTimestamp(),
        riderDeliveryStatus: "delivered"
    });
}

// ─── RIDER REQUESTS (seller → specific rider) ────────────────────────────────
//
// A seller can search for a free/available rider and send that ONE rider a
// delivery request for a "to-ship" order (instead of just waiting for any
// rider to self-claim once the order reaches "to-receive"). This adds these
// fields to an order doc while a request is in flight:
//
//   requestedRiderUID       – uid of the rider the seller asked
//   requestedRiderUsername  – display name of that rider
//   requestStatus            – "pending" | "declined" | "accepted" | null
//   declinedRiders            – array of rider UIDs who already declined this
//                               order, so they aren't accidentally re-picked
//
// Once a rider ACCEPTS, we set assignedRiderUID/assignedRider (same fields
// used by the self-claim flow in getToReceiveOrdersForDelivery) and clear
// the requestedRider* fields, since the order now has a confirmed rider.

/**
 * Orders belonging to this seller that still need a rider: status is
 * "to-ship" and no rider has been assigned yet. Includes orders that
 * currently have a pending or declined request so the UI can show that
 * state and let the seller pick again if declined.
 */
export async function getOrdersNeedingRiderForSeller(sellerUsername) {
    const snap = await getDocs(query(
        collection(db, "orders"),
        where("sellerUsername", "==", sellerUsername),
        where("status", "==", "to-ship")
    ));
    return snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(o => !o.assignedRiderUID);
}

/**
 * All riders currently marked available (riders/{uid}.available !== false).
 * Riders with no "available" field at all are treated as available by
 * default (opt-out model), matching how the rider dashboard toggle behaves.
 */
export async function getAvailableRiders() {
    const snap = await getDocs(collection(db, "riders"));
    return snap.docs
        .map(d => ({ uid: d.id, ...d.data() }))
        .filter(r => r.available !== false && !!r.username);
}

/**
 * Seller sends a delivery request to one specific rider for one order.
 * Overwrites any previous (e.g. declined) request on that order.
 */
export async function requestRiderForOrder(orderId, riderUID, riderUsername) {
    await updateDoc(doc(db, "orders", orderId), {
        requestedRiderUID: riderUID,
        requestedRiderUsername: riderUsername,
        requestStatus: "pending",
        requestedAt: serverTimestamp()
    });
}

/** Seller cancels a request they sent (before the rider responds). */
export async function cancelRiderRequest(orderId) {
    await updateDoc(doc(db, "orders", orderId), {
        requestedRiderUID: null,
        requestedRiderUsername: null,
        requestStatus: null
    });
}

/**
 * Orders where this rider has an incoming, unanswered delivery request.
 *
 * Each order also comes back with a `pickupLocation` field (the seller's
 * store location — see "PICKUP LOCATION" section above), so
 * rider-dashboard.html can show it in the "Delivery requests" list too,
 * before the rider even accepts.
 */
export async function getPendingRiderRequests(riderUID) {
    const snap = await getDocs(query(
        collection(db, "orders"),
        where("requestedRiderUID", "==", riderUID),
        where("requestStatus", "==", "pending")
    ));
    const orders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    return await attachPickupLocations(orders);
}

/**
 * Rider accepts a delivery request: becomes the assigned rider for the
 * order, the pending request is cleared, and the order's status is
 * automatically advanced from "to-ship" to "to-receive" — a rider has
 * now confirmed the delivery, so the seller no longer has to manually
 * flip the status themselves. This also means the order immediately
 * shows up in getToReceiveOrdersForDelivery() for the rider dashboard's
 * "Ready for delivery" list, already assigned to this rider.
 *
 * ★ ITO ANG FUNCTION NA NAGPAPAKITA KAY CUSTOMER KUNG SINO ANG
 *   MAG-DE-DELIVER. Kapag na-set na dito ang assignedRider +
 *   assignedRiderUID, automatic na lalabas sa to-receive.html ang
 *   pangalan ng rider + live GPS tracking box. ★
 *
 * IMPORTANT (bago): tinawagan na rin dito ang getOrCreateChatForOrder()
 * — ibig sabihin, sa sandaling mag-"Accept" ang rider, AWTOMATIKONG
 * nagkakaroon na ng "chats/{orderId}" document na may parehong
 * riderUID at customerUID. Dati, wala talagang gumagawa nito kahit
 * saan, kaya hindi nagkokonekta ang chat.html (customer) at
 * rider-message.html (rider) sa isa't isa.
 */
export async function acceptRiderRequest(orderId, riderUID, riderUsername) {
    // Kunin muna ang order para makuha ang customerUID/customerUsername/orderName
    // na kailangan para makabuo ng chat thread.
    const orderSnap = await getDoc(doc(db, "orders", orderId));
    const order = orderSnap.exists() ? orderSnap.data() : {};

    await updateDoc(doc(db, "orders", orderId), {
        assignedRider: riderUsername,
        assignedRiderUID: riderUID,
        requestStatus: "accepted",
        requestedRiderUID: null,
        requestedRiderUsername: null,
        status: "to-receive",
        updatedAt: serverTimestamp()
    });

    if (order.customerUID) {
        await getOrCreateChatForOrder(orderId, {
            customerUID: order.customerUID,
            customerUsername: order.customerUsername || "Customer",
            riderUID,
            riderUsername,
            orderName: order.name || orderId
        });
    }
}

/**
 * Rider declines a delivery request. The seller is left with
 * requestStatus "declined" (with the rider's name still on the order) so
 * they can see who declined, and the rider is added to declinedRiders so
 * they can be excluded from being re-suggested for this same order.
 */
export async function declineRiderRequest(orderId, riderUID) {
    await updateDoc(doc(db, "orders", orderId), {
        requestStatus: "declined",
        requestedRiderUID: null,
        declinedRiders: arrayUnion(riderUID)
    });
}

/** Read a rider's availability flag (defaults to true if never set). */
export async function getRiderAvailability(riderUID) {
    const snap = await getDoc(doc(db, "riders", riderUID));
    if (!snap.exists()) return true;
    const data = snap.data();
    return data.available !== false;
}

/** Set a rider's availability flag on/off. */
export async function setRiderAvailability(riderUID, available) {
    await setDoc(doc(db, "riders", riderUID), {
        available: !!available
    }, { merge: true });
}

// ─── ADDRESSES ────────────────────────────────────────────────────────────────

export async function getAddresses(customerUID) {
    const snap = await getDocs(query(collection(db, "addresses"), where("customerUID", "==", customerUID)));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function saveAddress(customerUID, addressData, existingId = null) {
    if (existingId) {
        await setDoc(doc(db, "addresses", existingId), { customerUID, ...addressData }, { merge: true });
        return existingId;
    } else {
        const ref = await addDoc(collection(db, "addresses"), { customerUID, ...addressData });
        return ref.id;
    }
}

export async function deleteAddress(addressId) {
    await deleteDoc(doc(db, "addresses", addressId));
}

export async function setDefaultAddress(customerUID, addressId) {
    // Unset all, then set the chosen one
    const all = await getAddresses(customerUID);
    const batch = all.map(a =>
        updateDoc(doc(db, "addresses", a.id), { isDefault: a.id === addressId })
    );
    await Promise.all(batch);
}

// ─── CART ─────────────────────────────────────────────────────────────────────

export async function getCart(customerUID) {
    const snap = await getDoc(doc(db, "carts", customerUID));
    return snap.exists() ? (snap.data().items || []) : [];
}

export async function saveCart(customerUID, items) {
    await setDoc(doc(db, "carts", customerUID), { items, updatedAt: serverTimestamp() });
}

// ─── CHATS (rider <-> customer) ────────────────────────────────────────────
//
// THIS is the piece that was missing before. chat.html (customer) and
// rider-message.html (rider) both READ from and WRITE to a "chats/{chatId}"
// document + its "messages" sub-collection, but nothing in the project
// actually CREATED that document. That's why messages could get sent (a
// sub-collection can be written to even if its parent doc doesn't exist)
// but the rider would never see the conversation show up in their list —
// rider-message.html's query filters strictly by chats.riderUID, and a
// chat doc that was never created has no riderUID field to match.
//
// getOrCreateChatForOrder() is now called automatically inside
// acceptRiderRequest() above, right when a rider accepts a delivery — the
// exact moment both a confirmed rider and the customer are known. It uses
// the orderId itself as the chatId, so there's exactly one thread per
// order and no risk of creating duplicates.

/**
 * Ensure a chats/{orderId} document exists with both parties wired up.
 * Safe to call multiple times — if the doc already exists, it just
 * refreshes the rider/orderName fields (e.g. in case of reassignment)
 * instead of wiping out existing messages, lastMessage, or unread counts.
 *
 * @param {string} orderId
 * @param {{customerUID:string, customerUsername:string, riderUID:string, riderUsername:string, orderName?:string}} info
 * @returns {Promise<string>} the chatId (same as orderId) — pass this as
 *   ?chat=<id> to chat.html, and it's what rider-message.html's
 *   conversation list will show once riderUID matches the logged-in rider.
 */
export async function getOrCreateChatForOrder(orderId, info) {
    const { customerUID, customerUsername, riderUID, riderUsername, orderName } = info;
    const chatRef = doc(db, "chats", orderId);
    const snap = await getDoc(chatRef);

    if (!snap.exists()) {
        await setDoc(chatRef, {
            orderId,
            customerUID,
            customerUsername: customerUsername || "Customer",
            riderUID,
            riderUsername: riderUsername || "Rider",
            orderName: orderName || "",
            lastMessage: "",
            unreadRider: 0,
            unreadCustomer: 0,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });
    } else {
        // Keep rider identity fresh (handles the rare case where a rider
        // was reassigned on the same order) without touching message
        // history or unread counters already in progress.
        await setDoc(chatRef, {
            riderUID,
            riderUsername: riderUsername || "Rider",
            orderName: orderName || snap.data().orderName || ""
        }, { merge: true });
    }

    return orderId;
}

/**
 * Look up the chatId for a given order (same value as the orderId, but
 * exposed as its own helper so calling code doesn't need to know that
 * detail). Returns null if no chat has been created yet for this order.
 */
export async function getChatIdForOrder(orderId) {
    const snap = await getDoc(doc(db, "chats", orderId));
    return snap.exists() ? snap.id : null;
}

// ─── MESSAGES ─────────────────────────────────────────────────────────────────

export async function getMessages(customerUsername, sellerUsername) {
    const threadId = [customerUsername, sellerUsername].sort().join("__");
    const snap = await getDocs(query(
        collection(db, "messages"),
        where("threadId", "==", threadId)
    ));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (a.sentAt?.seconds || 0) - (b.sentAt?.seconds || 0));
}

/**
 * Send a message. The `read` field is set to false so recipients
 * can detect unread messages via getUnreadMessageCount().
 */
export async function sendMessage(customerUsername, sellerUsername, sender, text) {
    const threadId = [customerUsername, sellerUsername].sort().join("__");
    await addDoc(collection(db, "messages"), {
        threadId, customerUsername, sellerUsername,
        sender, text, sentAt: serverTimestamp(),
        read: false   // <-- NEW: unread by default
    });
}

export async function getThreadsForSeller(sellerUsername) {
    const snap = await getDocs(query(collection(db, "messages"), where("sellerUsername", "==", sellerUsername)));
    const threads = {};
    snap.docs.forEach(d => {
        const data = d.data();
        if (!threads[data.threadId]) threads[data.threadId] = { ...data, messages: [] };
        threads[data.threadId].messages.push(data);
    });
    return Object.values(threads);
}

export async function getThreadsForCustomer(customerUsername) {
    const snap = await getDocs(query(collection(db, "messages"), where("customerUsername", "==", customerUsername)));
    const threads = {};
    snap.docs.forEach(d => {
        const data = d.data();
        if (!threads[data.threadId]) threads[data.threadId] = { ...data, messages: [] };
        threads[data.threadId].messages.push(data);
    });
    return Object.values(threads);
}

/**
 * Count unread messages for a SELLER.
 * Unread = messages sent by customer (sender !== sellerUsername) that have read !== true.
 */
export async function getUnreadCountForSeller(sellerUsername) {
    const snap = await getDocs(query(
        collection(db, "messages"),
        where("sellerUsername", "==", sellerUsername),
        where("sender", "==", "customer"),
        where("read", "==", false)
    ));
    return snap.size;
}

/**
 * Count unread messages for a CUSTOMER.
 * Unread = messages sent by seller (sender !== customerUsername) that have read !== true.
 */
export async function getUnreadCountForCustomer(customerUsername) {
    const snap = await getDocs(query(
        collection(db, "messages"),
        where("customerUsername", "==", customerUsername),
        where("sender", "==", "seller"),
        where("read", "==", false)
    ));
    return snap.size;
}

/**
 * Mark all messages in a thread as read for a given reader role.
 * Call this when the messages page is opened.
 * @param {string} threadId  - the thread ID
 * @param {string} readerRole - "customer" or "seller" (the one reading, NOT the sender)
 */
export async function markMessagesRead(threadId, readerRole) {
    // Mark messages sent by the OTHER party as read
    const senderRole = readerRole === "customer" ? "seller" : "customer";
    const snap = await getDocs(query(
        collection(db, "messages"),
        where("threadId", "==", threadId),
        where("sender", "==", senderRole),
        where("read", "==", false)
    ));
    await Promise.all(snap.docs.map(d => updateDoc(doc(db, "messages", d.id), { read: true })));
}

// ─── RATINGS ──────────────────────────────────────────────────────────────────

export async function saveRating(customerUID, sellerUsername, ratingData) {
    await addDoc(collection(db, "ratings"), {
        customerUID, sellerUsername, ...ratingData, ratedAt: serverTimestamp()
    });
}

export async function getRatingsBySeller(sellerUsername) {
    const snap = await getDocs(query(collection(db, "ratings"), where("sellerUsername", "==", sellerUsername)));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/**
 * Rate a rider's delivery (overall rating + how safe the delivery felt).
 * Call this from the to-rate flow once "riderUsername" is known for the order.
 */
export async function saveRiderRating(customerUID, riderUsername, ratingData) {
    await addDoc(collection(db, "ratings"), {
        customerUID, riderUsername, ...ratingData, ratedAt: serverTimestamp()
    });
}

export async function getRatingsByRider(riderUsername) {
    const snap = await getDocs(query(collection(db, "ratings"), where("riderUsername", "==", riderUsername)));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/** Cancel an order (sets status to "cancelled") */
export async function cancelOrder(orderId) {
    await updateDoc(doc(db, "orders", orderId), { 
        status: "cancelled", 
        cancelledAt: serverTimestamp() 
    });
}

export async function updateRiderProfile(riderUID, updates) {
  const ref = doc(db, "riders", riderUID);
  await setDoc(ref, updates, { merge: true });
}