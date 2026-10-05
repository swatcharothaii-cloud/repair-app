// pm-calendar.js — ปฏิทินซ่อมบำรุงเชิงป้องกัน (Preventive Maintenance)
//
// แนวคิด: "pmSchedules" คือรายการงานที่ต้องทำซ้ำตามรอบ (เช่น ล้างแอร์ทุกเดือน, เปลี่ยนไส้กรองน้ำทุก 3 เดือน)
// แต่ละรายการเก็บแค่ "วันครบกำหนดครั้งถัดไป" (nextDueDate) ไว้ค่าเดียว — เวลากด "ทำเสร็จแล้ว" ระบบจะ
// (1) บันทึกประวัติการทำเสร็จลง "pmLogs" (คนละ collection กันเอกสารบวม) และ
// (2) เลื่อน nextDueDate ของรายการนั้นไปข้างหน้าให้อัตโนมัติตามความถี่ที่ตั้งไว้
import { db, collection, getDocs, doc, addDoc, updateDoc, deleteDoc, serverTimestamp } from "./firebase-init.js";
import { PM_SCHEDULES_COLLECTION, PM_LOGS_COLLECTION } from "./firebase-init.js";

export const PM_FREQUENCY = {
  DAILY: "รายวัน",
  WEEKLY: "รายสัปดาห์",
  MONTHLY: "รายเดือน",
  QUARTERLY: "รายไตรมาส",
  YEARLY: "รายปี",
  ONCE: "ครั้งเดียว",
};

export const PM_FREQUENCY_ORDER = [
  PM_FREQUENCY.DAILY,
  PM_FREQUENCY.WEEKLY,
  PM_FREQUENCY.MONTHLY,
  PM_FREQUENCY.QUARTERLY,
  PM_FREQUENCY.YEARLY,
  PM_FREQUENCY.ONCE,
];

function todayISOStr() {
  return new Date().toISOString().slice(0, 10);
}

// เลื่อนวันที่ไปข้างหน้า "หนึ่งรอบ" ตามความถี่ที่กำหนด — คืนค่า null ถ้าเป็น "ครั้งเดียว" (ไม่มีรอบถัดไป)
function advanceOnce(dateStr, frequency) {
  const d = new Date(`${dateStr}T00:00:00`);
  switch (frequency) {
    case PM_FREQUENCY.DAILY:
      d.setDate(d.getDate() + 1);
      break;
    case PM_FREQUENCY.WEEKLY:
      d.setDate(d.getDate() + 7);
      break;
    case PM_FREQUENCY.MONTHLY:
      d.setMonth(d.getMonth() + 1);
      break;
    case PM_FREQUENCY.QUARTERLY:
      d.setMonth(d.getMonth() + 3);
      break;
    case PM_FREQUENCY.YEARLY:
      d.setFullYear(d.getFullYear() + 1);
      break;
    default:
      return null;
  }
  return d.toISOString().slice(0, 10);
}

// คำนวณวันครบกำหนดครั้งถัดไปจากวันครบกำหนดปัจจุบัน — ถ้างานค้างเกินกำหนดมานาน (เช่น ลืมกดทำเสร็จหลายรอบ)
// จะเลื่อนไปเรื่อยๆ จนกว่าจะได้วันที่ "วันนี้หรืออนาคต" เสมอ กันไม่ให้กดทำเสร็จแล้วแต่ระบบยังขึ้นเกินกำหนดซ้ำทันที
export function computeNextDueDate(currentDueDate, frequency) {
  let next = advanceOnce(currentDueDate, frequency);
  if (next === null) return null; // "ครั้งเดียว" ไม่มีรอบถัดไป
  const today = todayISOStr();
  let guard = 0;
  while (next < today && guard < 2000) {
    next = advanceOnce(next, frequency);
    guard++;
  }
  return next;
}

export async function loadPmSchedules() {
  const snap = await getDocs(collection(db, PM_SCHEDULES_COLLECTION));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function loadPmLogs() {
  const snap = await getDocs(collection(db, PM_LOGS_COLLECTION));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function addPmSchedule({ title, project, category, frequency, nextDueDate, assignedTech, notes }) {
  const trimmedTitle = (title || "").trim();
  if (!trimmedTitle) throw new Error("กรุณาระบุชื่องาน PM");
  if (!nextDueDate) throw new Error("กรุณาระบุวันครบกำหนดครั้งแรก");
  const ref = await addDoc(collection(db, PM_SCHEDULES_COLLECTION), {
    title: trimmedTitle,
    project: project || "",
    category: category || "",
    frequency: frequency || PM_FREQUENCY.MONTHLY,
    nextDueDate,
    assignedTech: assignedTech || "",
    notes: (notes || "").trim(),
    active: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updatePmSchedule(id, patch) {
  await updateDoc(doc(db, PM_SCHEDULES_COLLECTION, id), { ...patch, updatedAt: serverTimestamp() });
}

export async function deletePmSchedule(id) {
  await deleteDoc(doc(db, PM_SCHEDULES_COLLECTION, id));
}

// บันทึกว่าทำ PM ตามกำหนดนี้เสร็จแล้ว: เขียนประวัติลง pmLogs + เลื่อน nextDueDate ของตารางนี้ให้อัตโนมัติ
// (ถ้าเป็น "ครั้งเดียว" จะปิดใช้งานรายการนี้ไปเลยหลังทำเสร็จ เพราะไม่มีรอบถัดไปให้เลื่อน)
export async function completePmSchedule(schedule, { completedBy = "", notes = "" } = {}) {
  const completedDate = todayISOStr();
  await addDoc(collection(db, PM_LOGS_COLLECTION), {
    scheduleId: schedule.id,
    scheduleTitle: schedule.title || "",
    project: schedule.project || "",
    dueDateAtCompletion: schedule.nextDueDate || "",
    completedDate,
    completedBy,
    notes: (notes || "").trim(),
    createdAt: serverTimestamp(),
  });

  const next = computeNextDueDate(schedule.nextDueDate, schedule.frequency);
  if (next) {
    await updatePmSchedule(schedule.id, { nextDueDate: next });
  } else {
    await updatePmSchedule(schedule.id, { active: false });
  }
  return next;
}
