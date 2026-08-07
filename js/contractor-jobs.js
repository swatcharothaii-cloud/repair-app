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
import { CONTRACTOR_JOB_STATUS, CONTRACTOR_JOB_TYPE } from "./config.js";
import { createFreshApproval, approveApprovalStep, rejectApprovalStep, APPROVAL_STATUS } from "./approval.js";

// ============================================================
//  ระบบต่อรองราคา (Price Negotiation) — ใช้กับงานประเภท "fix" (ที่มีการเสนอราคาซ่อม) และ "quote" เท่านั้น
//  (defect ไม่มีราคา จึงไม่มีการต่อรอง) ทั้งแอดมินและผู้รับเหมาต่อรองกลับไปมาได้ไม่จำกัดรอบ ("ปิงปอง" ราคา)
//  จนกว่าฝ่ายใดฝ่ายหนึ่งจะกด "ยอมรับราคา" (negotiation.status = "agreed") — เก็บประวัติข้อเสนอทุกรอบไว้ใน
//  negotiation.offers เพื่อดูย้อนหลังได้ทั้งสองฝั่ง
//  ⚠️ "at" ของแต่ละ offer ต้องใช้เวลาฝั่ง client (new Date()) เสมอ ห้ามใช้ serverTimestamp() เพราะอยู่ใน
//  array (negotiation.offers) ซึ่ง Firestore ไม่รองรับ serverTimestamp() ภายใน array (บทเรียนเดียวกับที่
//  เคยเจอใน approval.js — ดูคอมเมนต์ที่นั่นประกอบ)
// ============================================================
export const NEGOTIATION_STATUS = {
  AWAITING_ADMIN: "awaiting_admin", // มีข้อเสนอใหม่จากผู้รับเหมา รอทีมงานตอบรับ/ต่อรอง
  AWAITING_CONTRACTOR: "awaiting_contractor", // มีข้อเสนอใหม่จากทีมงาน รอผู้รับเหมาตอบรับ/ต่อรอง
  AGREED: "agreed", // ตกลงราคากันแล้ว จบการต่อรอง
};

// คืนชื่อฟิลด์ราคา/จำนวนวัน "อย่างเป็นทางการ" บนตัวเอกสาร ที่ต้องอัปเดตให้ตรงกับข้อเสนอล่าสุดเสมอ
// (เพื่อให้โค้ดเดิมที่อ่าน job.quotePrice/job.repairPrice ตรงๆ เช่นใบส่งมอบงาน/การคำนวณเบิกงวดงาน ยังทำงานถูกต้อง)
function officialPriceFields(jobType, price, days, note) {
  if (jobType === CONTRACTOR_JOB_TYPE.QUOTE) {
    return { quotePrice: price, quoteDays: days, quoteNote: note };
  }
  return { repairPrice: price, repairDays: days };
}

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
export async function respondFixJob(id, { siteVisitDate, repairDays, repairPrice, repairNote }) {
  const hasPrice = repairPrice != null && repairPrice !== "";
  const patch = {
    siteVisitDate,
    repairDays: Number(repairDays),
    repairPrice: hasPrice ? Number(repairPrice) : null,
    contractorResponse: "confirmed",
    status: CONTRACTOR_JOB_STATUS.CONFIRMED,
    respondedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  // มีราคาเสนอ (เฉพาะงานประเภท "fix" — defect ไม่ส่งราคามา) → เริ่มกระบวนการต่อรองราคา ให้ทีมงานตอบรับ/ต่อรองต่อ
  if (hasPrice) {
    patch.negotiation = {
      status: NEGOTIATION_STATUS.AWAITING_ADMIN,
      offers: [{ by: "contractor", action: "offer", price: Number(repairPrice), days: Number(repairDays), note: (repairNote || "").trim(), at: new Date() }],
    };
  }
  await updateDoc(doc(db, CONTRACTOR_JOBS_COLLECTION, id), patch);
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

// งานประเภท "งานใหม่ที่ต้องเสนอราคา" — ผู้รับเหมารับงาน + เสนอจำนวนวัน/ราคา (= ข้อเสนอแรกของการต่อรองราคา)
export async function acceptQuoteJob(id, { quoteDays, quotePrice, quoteNote }) {
  const price = Number(quotePrice);
  const days = Number(quoteDays);
  const note = (quoteNote || "").trim();
  await updateDoc(doc(db, CONTRACTOR_JOBS_COLLECTION, id), {
    contractorResponse: "accepted",
    quoteDays: days,
    quotePrice: price,
    quoteNote: note,
    status: CONTRACTOR_JOB_STATUS.CONFIRMED,
    respondedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    negotiation: {
      status: NEGOTIATION_STATUS.AWAITING_ADMIN,
      offers: [{ by: "contractor", action: "offer", price, days, note, at: new Date() }],
    },
  });
}

// ฝ่ายใดฝ่ายหนึ่ง (by: "admin" | "contractor") กด "ยอมรับราคา" ข้อเสนอล่าสุด — จบการต่อรองทันที
// currentNegotiation: ค่า job.negotiation ปัจจุบันที่มีอยู่ในมือ (จากอ่านครั้งล่าสุด) ใช้ต่อประวัติ ไม่ทับของเดิม
export async function acceptNegotiationOffer(id, jobType, currentNegotiation, by, note) {
  const offers = (currentNegotiation && currentNegotiation.offers) || [];
  const lastOffer = offers[offers.length - 1];
  const entry = { by, action: "accept", price: lastOffer?.price ?? null, days: lastOffer?.days ?? null, note: (note || "").trim(), at: new Date() };
  const patch = {
    negotiation: { status: NEGOTIATION_STATUS.AGREED, offers: [...offers, entry] },
    updatedAt: serverTimestamp(),
  };
  if (lastOffer) Object.assign(patch, officialPriceFields(jobType, lastOffer.price, lastOffer.days, lastOffer.note));
  await updateDoc(doc(db, CONTRACTOR_JOBS_COLLECTION, id), patch);
}

// ฝ่ายใดฝ่ายหนึ่ง (by: "admin" | "contractor") กด "ต่อรองราคาใหม่" — เสนอราคา/จำนวนวันใหม่ สลับให้อีกฝ่ายตอบรับ/
// ต่อรองต่อ ทำได้ไม่จำกัดรอบจนกว่าจะมีฝ่ายใดฝ่ายหนึ่งกดยอมรับ (acceptNegotiationOffer ด้านบน)
export async function submitNegotiationCounterOffer(id, jobType, currentNegotiation, by, { price, days, note }) {
  const offers = (currentNegotiation && currentNegotiation.offers) || [];
  const entry = { by, action: "offer", price: Number(price), days: days != null && days !== "" ? Number(days) : null, note: (note || "").trim(), at: new Date() };
  const nextStatus = by === "admin" ? NEGOTIATION_STATUS.AWAITING_CONTRACTOR : NEGOTIATION_STATUS.AWAITING_ADMIN;
  const patch = {
    negotiation: { status: nextStatus, offers: [...offers, entry] },
    updatedAt: serverTimestamp(),
  };
  Object.assign(patch, officialPriceFields(jobType, entry.price, entry.days, entry.note));
  await updateDoc(doc(db, CONTRACTOR_JOBS_COLLECTION, id), patch);
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
// ทุกครั้งที่ส่งมอบงาน (ครั้งแรก หรือส่งใหม่หลังตรวจไม่ผ่าน) จะเริ่มกระบวนการอนุมัติ 4 ขั้นตอนใหม่เสมอ
export async function submitDelivery(id, { deliveryDate, deliveryNote, supervisorName, deliveryImages }) {
  await updateDoc(doc(db, CONTRACTOR_JOBS_COLLECTION, id), {
    deliveryDate,
    deliveryNote: (deliveryNote || "").trim(),
    supervisorName: (supervisorName || "").trim(),
    deliveryImages: deliveryImages || [],
    deliverySubmitted: true,
    deliverySubmittedAt: serverTimestamp(),
    approval: createFreshApproval(),
    updatedAt: serverTimestamp(),
  });
}

// ---- ตรวจรับงานที่ผู้รับเหมาส่งมอบมา — ระบบอนุมัติ 4 ขั้นตอน (ทีมงาน/PM/จัดซื้อ/ผู้บริหาร) ----
// ใครก็ได้ที่ล็อกอินอยู่ (actorName = currentAdmin.name) กดแทนขั้นตอนไหนก็ได้ ไม่มีการบังคับสิทธิ์ตามตำแหน่งจริง
// อนุมัติขั้นตอนปัจจุบัน — ถ้าเป็นขั้นตอนสุดท้าย (ขั้นที่ 4) จะถือว่า "ตรวจรับผ่านทั้งหมด" ปิดงานเสร็จสิ้นทันที
export async function approveJobDeliveryStep(id, actorName, note) {
  const snap = await getDoc(doc(db, CONTRACTOR_JOBS_COLLECTION, id));
  const job = snap.exists() ? snap.data() : null;
  const approval = approveApprovalStep(job?.approval, actorName, note, serverTimestamp);
  const patch = { approval, updatedAt: serverTimestamp() };
  if (approval.status === APPROVAL_STATUS.APPROVED) {
    const round = (job?.inspectionRound || 0) + 1;
    Object.assign(patch, {
      inspectionRound: round,
      lastInspectionResult: "passed",
      lastInspectionBy: (actorName || "").trim(),
      lastInspectionNote: (note || "").trim(),
      lastInspectionAt: serverTimestamp(),
      deliveryAccepted: true,
      deliveryAcceptedBy: (actorName || "").trim(),
      deliveryAcceptedAt: serverTimestamp(),
      status: CONTRACTOR_JOB_STATUS.DONE,
    });
  }
  await updateDoc(doc(db, CONTRACTOR_JOBS_COLLECTION, id), patch);
  return approval;
}

// ปฏิเสธขั้นตอนปัจจุบัน — จบกระบวนการทันที (ตรวจไม่ผ่าน) ผู้รับเหมาต้องส่งมอบงานใหม่ (submitDelivery จะเริ่มกระบวนการใหม่)
export async function rejectJobDeliveryStep(id, actorName, note) {
  const snap = await getDoc(doc(db, CONTRACTOR_JOBS_COLLECTION, id));
  const job = snap.exists() ? snap.data() : null;
  const approval = rejectApprovalStep(job?.approval, actorName, note, serverTimestamp);
  const round = (job?.inspectionRound || 0) + 1;
  await updateDoc(doc(db, CONTRACTOR_JOBS_COLLECTION, id), {
    approval,
    inspectionRound: round,
    lastInspectionResult: "failed",
    lastInspectionBy: (actorName || "").trim(),
    lastInspectionNote: (note || "").trim(),
    lastInspectionAt: serverTimestamp(),
    // รีเซ็ตให้ผู้รับเหมาส่งมอบงานใหม่อีกครั้ง (deliveryAccepted ยังเป็น false อยู่แล้ว ไม่ต้องแก้)
    deliverySubmitted: false,
    updatedAt: serverTimestamp(),
  });
  return approval;
}
