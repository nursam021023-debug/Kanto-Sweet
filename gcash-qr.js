// gcash-qr.js
// ─────────────────────────────────────────────────────────────────────────────
// Turns the seller's static GCash "Receive Money" QR into a DYNAMIC QR that
// already has the order amount filled in.
//
// GCash QR codes follow the EMVCo / QR Ph format: a flat list of
// TAG(2) LENGTH(2) VALUE items, ending with a CRC16 checksum (tag 63).
//   tag 01 = "11" static QR   /  "12" dynamic QR (amount included)
//   tag 54 = transaction amount, e.g. "150.00"
// We read the seller's QR text once (when they upload it), then for every
// order we set tag 01 = "12", add tag 54 = amount, and recompute the CRC.
// ─────────────────────────────────────────────────────────────────────────────

/** CRC16-CCITT (poly 0x1021, init 0xFFFF) — the checksum EMV QR codes use. */
export function crc16(str) {
    let crc = 0xFFFF;
    for (let i = 0; i < str.length; i++) {
        crc ^= (str.charCodeAt(i) & 0xFF) << 8;
        for (let b = 0; b < 8; b++) {
            crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
            crc &= 0xFFFF;
        }
    }
    return crc.toString(16).toUpperCase().padStart(4, "0");
}

/** Split an EMV QR string into [{tag, value}, ...]. Returns null if malformed. */
export function parseTLV(s) {
    const out = [];
    let i = 0;
    while (i < s.length) {
        if (i + 4 > s.length) return null;
        const tag = s.substr(i, 2);
        const len = parseInt(s.substr(i + 2, 2), 10);
        if (!/^\d{2}$/.test(tag) || isNaN(len)) return null;
        const value = s.substr(i + 4, len);
        if (value.length !== len) return null;
        out.push({ tag, value });
        i += 4 + len;
    }
    return out;
}

function serialize(items) {
    return items.map(t => t.tag + String(t.value.length).padStart(2, "0") + t.value).join("");
}

/** True if the text looks like a valid EMV / QR Ph payload (header + CRC ok). */
export function isEmvQr(payload) {
    if (typeof payload !== "string" || !payload.startsWith("000201")) return false;
    if (!parseTLV(payload)) return false;
    const body = payload.slice(0, -4);
    return body.endsWith("6304") && crc16(body) === payload.slice(-4).toUpperCase();
}

/**
 * Take the seller's static payload and return a new payload with `amount`
 * (in pesos) locked in. Returns null if the payload can't be used.
 */
export function buildDynamicPayload(staticPayload, amount) {
    if (!staticPayload) return null;
    const amt = Number(amount);
    if (!isFinite(amt) || amt <= 0) return null;
    const items = parseTLV(staticPayload);
    if (!items) return null;

    const kept = items.filter(t => t.tag !== "63" && t.tag !== "54");
    const init = kept.find(t => t.tag === "01");
    if (init) init.value = "12";                       // static → dynamic

    const amountItem = { tag: "54", value: amt.toFixed(2) };
    // EMV wants tags in ascending order: amount (54) goes before the first tag > 54
    let idx = kept.findIndex(t => parseInt(t.tag, 10) > 54);
    if (idx === -1) idx = kept.length;
    kept.splice(idx, 0, amountItem);

    const body = serialize(kept) + "6304";
    return body + crc16(body);
}

/** Draw any text as a QR code on a <canvas>. Needs vendor/qrcode.js loaded first. */
export function drawQr(canvas, text, cell = 8, margin = 4) {
    const make = globalThis.qrcode;
    if (!make) throw new Error("qrcode library not loaded");
    const qr = make(0, "M");
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    const size = (n + margin * 2) * cell;
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = "#000";
    for (let r = 0; r < n; r++)
        for (let c = 0; c < n; c++)
            if (qr.isDark(r, c)) ctx.fillRect((c + margin) * cell, (r + margin) * cell, cell, cell);
}
