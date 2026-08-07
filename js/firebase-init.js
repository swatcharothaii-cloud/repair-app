// ใช้ Firebase Modular SDK ผ่าน CDN (ไม่ต้องมี build step)
// หมายเหตุ: ไม่ใช้ Firebase Storage เพราะต้องอัปเกรดเป็นแผน Blaze (ผูกบัตรเครดิต)
// รูปภาพที่แนบจะถูกบีบอัดแล้วเก็บเป็น base64 ตรงใน Firestore แทน (ดู image-compress.js)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import { FIREBASE_CONFIG } from "./config.js";

const app = initializeApp(FIREBASE_CONFIG);
export const db = getFirestore(app);
export const auth = getAuth(app);

export {
  collection,
  addDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
};

export const REQUESTS_COLLECTION = "repairRequests";
export const ADMINS_COLLECTION = "admins";
export const CATEGORIES_COLLECTION = "categories";
export const PROJECTS_COLLECTION = "projects";
export const CONTRACTORS_COLLECTION = "contractors";
export const CONTRACTOR_JOBS_COLLECTION = "contractorJobs";
// คลังใบสั่งซื้อเก่าที่นำเข้าจาก PEAK — collection เดียวกับ progress-claim-app (Firestore ตัวเดียวกัน)
// repair-app เขียนเข้า collection นี้ได้ด้วยตอนแอดมินแนบไฟล์ PDF ใบสั่งซื้อในตาราง "งานที่ส่งให้ผู้รับเหมา"
// (ดู contractor-jobs.js ฟังก์ชัน setPoNumberWithFile / syncContractorJobPoToArchive) เพื่อให้ PO
// ที่ออกจากระบบนี้ไปโผล่ใน "📜 Purchase Order Archive (PEAK Import)" ของ progress-claim-app ด้วย
export const LEGACY_PO_COLLECTION = "legacyPurchaseOrders";
