// contractor-jobs.js — จัดการ "งานที่ส่งให้ผู้รับเหมา" ผ่าน Firestore (collection "contractorJobs")
import {
  db,
  collection,
  addDoc,
  doc,
  getDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
} from "./firebase-init.js";
import { CONTRACTOR_JOBS_COLLECTION } from "./firebase-init.js";
import { CONTRACTOR_JOB_STATUS } from "./config.js";

function generateJobId() {
  const d = new Date();
  const datePart = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `CJ-${datePart}-${rand}`;
}

// สร้างงานใหม่ส่งให้ผู้รับเหมา (แอดมินเรียกจากหน้าแอดมิน)
export async function addContractorJob(data) {
  const jobId = generateJobId();
  const ref = await addDoc(collection(db, CONTRACTOR_JOBS_COLLECTION), {
    jobId,
    type: data.type, // "fix" | "quote" | "defect"
    ticketId: data.ticketId || "",
    projectId: data.projectId || "",
    project: data.project || "",
    siteName: data.siteName || "",
    description: data.description || "",
    images: data.images || [],
    contractorId: data.contractorId || "",
    contractorName: data.contractorName || "",
    // แอดมินเสนอวันเข้าหน้างานเบื้องต้นได้ (ผู้รับเหมายืนยัน/แก้ไขได้อีกครั้งผ่านลิงก์) — ใช้กับ fix/defect
    siteVisitDate: data.siteVisitDate || "",
    repairDays: null,
    // เฉพาะงานประเภท "fix" — ผู้รับเหมาเสนอราคาค่าซ่อมเพิ่มเติมด้วย (defect ไม่มีราคา เพราะเป็นงานแก้ไขที่ตรวจไม่ผ่าน ไม่คิดเงินเพิ่ม)
    repairPrice: null,
    // เฉพาะงานประเภท "defect" — เลขรอบที่ตรวจไม่ผ่าน (admin เป็นคนระบุตอนสร้างงาน)
    defectRound: data.defectRound != null && data.defectRound !== "" ? Number(data.defectRound) : null,
    contractorResponse: "",
    quoteDays: null,
    quotePrice: null,
    quoteNote: "",
    status: CONTRACTOR_JOB_STATUS.WAITING,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    updatedBy: data.updatedBy || "",
    respondedAt: null,
    // ---- ระบบส่งมอบงาน/PO (เฟส 2 ขั้นที่ 1: PO + ส่งมอบงาน + ตรวจรับ + ใบส่งมอบงาน PDF) ----
    poNumber: "", // เลขที่ใบสั่งซื้อ — แอดมินกรอกเองทีหลัง (ปกติหลังตกลงราคา/วันแล้ว)
    deliveryDate: "", // วันที่ผู้รับเหมาแจ้งว่าส่งมอบงานจริง
    deliveryNote: "",
    supervisorName: "", // ชื่อผู้ดูแลงาน (ฝั่งผู้รับเหมา) ที่รับผิดชอบตอนส่งมอบงานนี้
    deliveryImages: [], // ภาพหน้างานตอนส่งมอบ (แนบได้สูงสุด 20 ภาพ แยกจากภาพก่อนซ่อมของงาน)
    deliverySubmitted: false,
    deliverySubmittedAt: null,
    deliveryAccepted: false, // ทีมงานภายในกด "ตรวจรับงาน" แล้วหรือยัง
    deliveryAcceptedBy: "",
    deliveryAcceptedAt: null,
    // ---- ตรวจรับงาน: รอบที่ตรวจ + ผลตรวจล่าสุด + ผู้ตรวจงานลงชื่อ ----
    inspectionRound: 0, // เพิ่มขึ้นทุกครั้งที่มีการตรวจ (ไม่ว่าผ่านหรือไม่ผ่าน)
    lastInspectionResult: "", // "passed" | "failed"
    lastInspectionBy: "", // ชื่อผู้ตรวจงาน (พิมพ์เองตอนกดตรวจ)
    lastInspectionNote: "", // เหตุผลที่ไม่ผ่าน (ถ้ามี)
    lastInspectionAt: null,
  });
  return { id: ref.id, jobId };
}

export async function updateContractorJob(id, patch) {
  await updateDoc(doc(db, CONTRACTOR_JOBS_COLLECTION, id), { ...patch, updatedAt: serverTimestamp() });
}

// ลบงานที่ส่งให้ผู้รับเหมาถาวร (ตามคำขอ) — กู้คืนไม่ได้
export async function deleteContractorJob(id) {
  await deleteDoc(doc(db, CONTRACTOR_JOBS_COLLECTION, id));
}

// ---------------- ลิงก์อนุมัติสำหรับผู้บริหาร (ไม่ต้องล็อกอิน) ----------------
// แอดมินกดสร้างลิงก์ทีละงาน (ปกติหลังผู้รับเหมาตอบรับ/เสนอราคาแล้ว) ให้ผู้บริหารกดอนุมัติ/ปฏิเสธเองผ่านลิงก์
export async function sendJobForApproval(id) {
  await updateDoc(doc(db, CONTRACTOR_JOBS_COLLECTION, id), {
    approvalStatus: "pending",
    updatedAt: serverTimestamp(),
  });
}

export async function approveJobPublic(id, approverName) {
  await updateDoc(doc(db, CONTRACTOR_JOBS_COLLECTION, id), {
    approvalStatus: "approved",
    approvedBy: (approverName || "").trim(),
    approvalRespondedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function rejectJobPublic(id, approverName) {
  await updateDoc(doc(db, CONTRACTOR_JOBS_COLLECTION, id), {
    approvalStatus: "rejected",
    approvedBy: (approverName || "").trim(),
    approvalRespondedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

// ---------------- เรียกจากหน้าผู้รับเหมา (contractor.html, ไม่ต้องล็อกอิน) ----------------

// งานประเภท "งานแก้ไข" / "งานแก้ไขที่ตรวจไม่ผ่าน" — ผู้รับเหมายืนยัน/ระบุวันเข้าหน้างาน + จำนวนวันซ่อม
// (ใช้ร่วมกันทั้ง fix และ defect — ต้องกดรับงานนี้ก่อนถึงจะกรอกได้)
// repairPrice: ใช้เฉพาะ fix เท่านั้น (defect ไม่ส่งค่านี้มา เพราะเป็นงานแก้ไขที่ตรวจไม่ผ่าน ไม่คิดเงินเพิ่ม)
export async function respondFixJob(id, { siteVisitDate, repairDays, repairPrice }) {
  await updateDoc(doc(db, CONTRACTOR_JOBS_COLLECTION, id), {
    siteVisitDate,
    repairDays: Number(repairDays),
    repairPrice: repairPrice != null && repairPrice !== "" ? Number(repairPrice) : null,
    contractorResponse: "confirmed",
    status: CONTRACTOR_JOB_STATUS.CONFIRMED,
    respondedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

// ปฏิเสธงาน — ใช้ร่วมกันได้ทั้ง 3 ประเภทงาน (fix / quote / defect)
export async function rejectJob(id) {
  await updateDoc(doc(db, CONTRACTOR_JOBS_COLLECTION, id), {
    contractorResponse: "rejected",
    status: CONTRACTOR_JOB_STATUS.REJECTED,
    respondedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

// งานประเภท "งานใหม่ที่ต้องเสนอราคา" — ผู้รับเหมารับงาน + เสนอจำนวนวัน/ราคา
export async function acceptQuoteJob(id, { quoteDays, quotePrice, quoteNote }) {
  await updateDoc(doc(db, CONTRACTOR_JOBS_COLLECTION, id), {
    contractorResponse: "accepted",
    quoteDays: Number(quoteDays),
    quotePrice: Number(quotePrice),
    quoteNote: (quoteNote || "").trim(),
    status: CONTRACTOR_JOB_STATUS.CONFIRMED,
    respondedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

// สำหรับหน้าแอดมิน — subscribe งานทั้งหมด (ใหม่สุดก่อน)
export function watchAllContractorJobs(cb, onErr) {
  const q = query(collection(db, CONTRACTOR_JOBS_COLLECTION), orderBy("createdAt", "desc"));
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (err) => {
      console.error(err);
      if (onErr) onErr(err);
    }
  );
}

// สำหรับหน้าผู้รับเหมา (public, ไม่ต้องล็อกอิน) — subscribe งานเดียวตาม document id
export function watchContractorJob(id, cb, onErr) {
  return onSnapshot(
    doc(db, CONTRACTOR_JOBS_COLLECTION, id),
    (snap) => cb(snap.exists() ? { id: snap.id, ...snap.data() } : null),
    (err) => {
      console.error(err);
      if (onErr) onErr(err);
    }
  );
}

export async function getContractorJobOnce(id) {
  const snap = await getDoc(doc(db, CONTRACTOR_JOBS_COLLECTION, id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// ============================================================
//  ระบบส่งมอบงาน / PO (เฟส 2 ขั้นที่ 1) — ต่อยอดจาก contractorJobs เดิม ไม่แยกแอปใหม่
//  ลำดับ: (ตกลงราคา/วันแล้ว = CONFIRMED) → แอดมินออกเลขที่ PO → ผู้รับเหมาแจ้งส่งมอบงาน
//  → ทีมงานภายในตรวจรับ → status เปลี่ยนเป็น DONE ("เสร็จสิ้น")
// ============================================================

// แอดมินออก/แก้ไขเลขที่ PO ให้งานนี้ (ปกติทำหลังตกลงราคา/วันเข้าหน้างานกับผู้รับเหมาแล้ว)
export async function setPoNumber(id, poNumber) {
  await updateDoc(doc(db, CONTRACTOR_JOBS_COLLECTION, id), {
    poNumber: (poNumber || "").trim(),
    updatedAt: serverTimestamp(),
  });
}

// ผู้รับเหมาแจ้งส่งมอบงานจริง (ผ่านลิงก์สาธารณะ contractor.html เดิม ไม่ต้องล็อกอิน)
export async function submitDelivery(id, { deliveryDate, deliveryNote, supervisorName, deliveryImages }) {
  await updateDoc(doc(db, CONTRACTOR_JOBS_COLLECTION, id), {
    deliveryDate,
    deliveryNote: (deliveryNote || "").trim(),
    supervisorName: (supervisorName || "").trim(),
    deliveryImages: deliveryImages || [],
    deliverySubmitted: true,
    deliverySubmittedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

// ทีมงานภายในตรวจงานที่ผู้รับเหมาส่งมอบมา — ผลตรวจมี 2 แบบ: "ผ่าน" (ปิดงานเสร็จสิ้น) หรือ "ไม่ผ่าน" (ให้ส่งมอบงานใหม่)
// round: เลขรอบที่ตรวจ (นับต่อจากรอบก่อนหน้า ส่งมาจากฝั่งแอดมิน เพื่อไม่ต้องอ่านข้อมูลซ้ำก่อนเขียน)
// inspectorName: ชื่อผู้ตรวจงาน (พิมพ์เองตอนกดตรวจ ไม่ผูกกับชื่อแอดมินที่ล็อกอินอยู่ เพราะอาจเป็นคนละคนกัน)
export async function passDeliveryInspection(id, { round, inspectorName, note }) {
  await updateDoc(doc(db, CONTRACTOR_JOBS_COLLECTION, id), {
    inspectionRound: round,
    lastInspectionResult: "passed",
    lastInspectionBy: (inspectorName || "").trim(),
    lastInspectionNote: (note || "").trim(),
    lastInspectionAt: serverTimestamp(),
    deliveryAccepted: true,
    deliveryAcceptedBy: (inspectorName || "").trim(),
    deliveryAcceptedAt: serverTimestamp(),
    status: CONTRACTOR_JOB_STATUS.DONE,
    updatedAt: serverTimestamp(),
  });
}

export async function failDeliveryInspection(id, { round, inspectorName, note }) {
  await updateDoc(doc(db, CONTRACTOR_JOBS_COLLECTION, id), {
    inspectionRound: round,
    lastInspectionResult: "failed",
    lastInspectionBy: (inspectorName || "").trim(),
    lastInspectionNote: (note || "").trim(),
    lastInspectionAt: serverTimestamp(),
    // รีเซ็ตให้ผู้รับเหมาส่งมอบงานใหม่อีกครั้ง (deliveryAccepted ยังเป็น false อยู่แล้ว ไม่ต้องแก้)
    deliverySubmitted: false,
    updatedAt: serverTimestamp(),
  });
}
