// login.js - Firebase Auth is handled directly in login.html and seller login.html
// This file is kept for compatibility with any pages that load it.

// Shared logout helper for customer pages
window.logoutCustomer = function() {
    import("https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js").then(({ getAuth, signOut }) => {
        const auth = getAuth();
        signOut(auth).catch(() => {});
    });
    localStorage.removeItem("currentCustomer");
    localStorage.removeItem("currentCustomerUID");
    window.location.href = "login.html";
};

// Shared logout helper for seller pages
window.logoutSeller = function() {
    import("https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js").then(({ getAuth, signOut }) => {
        const auth = getAuth();
        signOut(auth).catch(() => {});
    });
    localStorage.removeItem("currentSeller");
    localStorage.removeItem("currentSellerUID");
    window.location.href = "seller login.html";
};
