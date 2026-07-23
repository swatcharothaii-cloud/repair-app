// contractors.js — จัดการ "รายชื่อผู้รับเหมา" ผ่าน Firestore (collection "contractors")
import { db, collection, getDocs, doc, addDoc, updateDoc, serverTimestamp } from "./firebase-init.js";
import { CONTRACTORS_COLLECTION } from "./firebase-init.js";

// โหลดผู้รับเหมาทั้งหมด (รวมที่ปิดใช้งานแล้วด้วย) เรียงตามชื่อ (ไทย)
export async function loadContractors() {
  const snap = await getDocs(collection(db, CONTRACTORS_COLLECTION));
  const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  list.sort((a, b) => (a.name || "").localeCompare(b.name || "", "th"));
  return list;
}

// เพิ่มผู้รับเหมาใหม่ — lineContact เป็นแค่ข้อมูลอ้างอิงให้แอดมินเอาไปหาแชทไลน์เอง
// (ระบบนี้ไม่ได้ส่งข้อความไลน์อัตโนมัติ แอดมินต้องคัดลอกลิงก์งานไปวางในแชทไลน์เอง)
export async function addContractor({ name, lineContact, phone, note }) {
  const trimmedName = (name || "").trim();
  if (!trimmedName) throw new Error("กรุณาระบุชื่อผู้รับเหมา");
  const ref = await addDoc(collection(db, CONTRACTORS_COLLECTION), {
    name: trimmedName,
    lineContact: (lineContact || "").trim(),
    phone: (phone || "").trim(),
    note: (note || "").trim(),
    active: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateContractor(id, patch) {
  await updateDoc(doc(db, CONTRACTORS_COLLECTION, id), { ...patch, updatedAt: serverTimestamp() });
}
