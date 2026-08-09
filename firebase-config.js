import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

const firebaseConfig = {
    apiKey: "AIzaSyBaDezXv4aynvYTJaaZyXwIRIImLBEYwB0",
    authDomain: "dalocal-8ceb3.firebaseapp.com",
    projectId: "dalocal-8ceb3",
    storageBucket: "dalocal-8ceb3.appspot.com",
    messagingSenderId: "737186112999",
    appId: "1:737186112999:web:f61d20523f4ac479f8c942"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const auth = getAuth(app);

