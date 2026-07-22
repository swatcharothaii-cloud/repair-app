import { DEPARTMENTS, STATUS, STATUS_STYLE, LIFF_ID_ADMIN, ADMINS, COMPANY, MAX_IMAGES, MAX_IMAGE_MB } from "./config.js";
import { showToast, formatDateThai, isOverdue, renderCompanyBrandBar } from "./utils.js";
import { compressImageToDataUrl } from "./image-compress.js";
import {
  T, tri, catTri, statusTri, deptTri, idNumberLabel,
  msgMaxImages, msgMaxAfterImages, msgFileTooLarge, msgExportSuccess,
} from "./i18n.js";

renderCompanyBrandBar("brand-bar", COMPANY);

// ไม่ใช้ระบบล็อกอินแล้ว — ระบุตัวตนด้วยการ "เลือกชื่อ" จากรายชื่อคงที่ใน config.js (ADMINS)
// เก็บชื่อที่เลือกไว้ใน localStorage ของอุปกรณ์นี้ เพื่อไม่ต้องเลือกใหม่ทุกครั้งที่เปิดหน้า
const IDENTITY_KEY = "repairAdminIdentity";
function getStoredIdentity() {
  try {
    const parsed = JSON.parse(localStorage.getItem(IDENTITY_KEY) || "null");
    if (parsed && ADMINS.some((a) => a.id === parsed.id)) return parsed;
    return null;
  } catch {
    return null;
  }
}
function setStoredIdentity(identity) {
  localStorage.setItem(IDENTITY_KEY, JSON.stringify(identity));
}
function clearStoredIdentity() {
  localStorage.removeItem(IDENTITY_KEY);
}
function escapeHtmlGlobal(str) {
  const d = document.createElement("div");
  d.textContent = str ?? "";
  return d.innerHTML;
}

// ============================================================
//  LINE LIFF (ไม่บังคับ) — ให้ทีมงานเปิดหน้าแอดมินผ่านแอป LINE ได้
//  หมายเหตุ: LINE เป็นแค่ "ช่องทางเข้าถึง" เท่านั้น สิทธิ์แอดมินจริงยังคง
//  ตรวจสอบผ่านอีเมล/รหัสผ่าน (Firebase Auth) + รายชื่อใน collection "admins" เหมือนเดิมทุกประการ
//  ถ้าไม่ได้ตั้งค่า LIFF_ID_ADMIN ไว้ จะข้ามส่วนนี้ทั้งหมดและทำงานเป็นเว็บแอปปกติ
(async function initAdminLiff() {
  if (!LIFF_ID_ADMIN) return;
  try {
    await liff.init({ liffId: LIFF_ID_ADMIN });
    if (!liff.isLoggedIn()) {
      liff.login({ redirectUri: window.location.href });
      return;
    }
    const profile = await liff.getProfile();
    const bar = document.createElement("div");
    bar.className = "liff-user-bar liff-user-bar--admin";
    bar.innerHTML = `
      ${profile.pictureUrl ? `<img src="${profile.pictureUrl}" alt="">` : `<span class="liff-avatar-fallback">🙂</span>`}
      <span>${T.accessedViaLine}${escapeHtmlAdminLiff(profile.displayName || "")}</span>
    `;
    document.body.prepend(bar);
  } catch (e) {
    console.warn("Admin LIFF init failed, running as normal web app:", e);
  }
})();

function escapeHtmlAdminLiff(str) {
  const d = document.createElement("div");
  d.textContent = str || "";
  return d.innerHTML;
}

main().catch((err) => {
  console.error(err);
  document.getElementById("identity-screen").innerHTML = `
    <div class="login-card" style="text-align:center;">
      <div style="font-size:40px;">⚠️</div>
      <h3>${T.connectFailTitle}</h3>
      <p class="hint">${T.connectFailHint}</p>
    </div>`;
});

async function main() {
  // โหลด firebase-init.js แบบ dynamic import เพื่อดักจับข้อผิดพลาดกรณีเชื่อมต่อ Firebase ไม่สำเร็จ
  const {
    db,
    collection, doc, updateDoc, onSnapshot, query, orderBy, serverTimestamp,
  } = await import("./firebase-init.js");
  const { loadCategories, addCategory, updateCategory } = await import("./categories.js");
  const { loadProjects, addProject, updateProject } = await import("./projects.js");

  // ประเภทงาน — โหลดจาก Firestore (แก้ไข/เพิ่มเองได้จากส่วน "จัดการประเภทงาน" ด้านล่าง)
  // แทนที่ค่าตายตัวใน config.js เดิม (ครั้งแรกที่ใช้งานจะหว่านเมล็ดให้อัตโนมัติ ดู js/categories.js)
  let categories = [];
  try {
    categories = await loadCategories();
  } catch (e) {
    console.warn("โหลดประเภทงานไม่สำเร็จ", e);
    showToast(T.msgCategoryLoadFail, 4000);
  }
  // ใช้ตอนสร้างกราฟ/สรุป Excel: แสดงประเภทที่ยังเปิดใช้งานอยู่เสมอ (แม้ยังไม่มีข้อมูล) + ประเภทที่ปิดใช้
  // งานไปแล้วแต่ยังมีรายการแจ้งซ่อมเก่าอ้างอิงอยู่ (กันไม่ให้ข้อมูลเก่าหายไปจากสรุป/กราฟ)
  function categoriesForStats(items) {
    return categories.filter((c) => c.active !== false || items.some((r) => r.category === c.label));
  }

  // โปรเจกต์ — แยกขอบเขตรายการแจ้งซ่อมเป็นแต่ละโปรเจกต์ (ดู "📁 Project switcher" ด้านบนแดชบอร์ด)
  // ประเภทงานยังคงเป็นตัวกรอง "ระดับย่อย" ภายในโปรเจกต์ที่เลือกไว้เหมือนเดิม (ดู js/projects.js)
  let projects = [];
  try {
    projects = await loadProjects();
  } catch (e) {
    console.warn("โหลดรายการโปรเจกต์ไม่สำเร็จ", e);
    showToast(T.msgProjectLoadFail, 4000);
  }
  const UNASSIGNED_PROJECT_KEY = "__unassigned__"; // ค่าที่ใช้แทน "รายการเก่าที่ยังไม่มีโปรเจกต์ระบุไว้"
  const PROJECT_SCOPE_KEY = "repairAdminProjectScope";
  let selectedProjectScope = localStorage.getItem(PROJECT_SCOPE_KEY) || ""; // "" = ทุกโปรเจกต์
  function withinProjectScope(r) {
    if (!selectedProjectScope) return true;
    if (selectedProjectScope === UNASSIGNED_PROJECT_KEY) return !r.project;
    return r.project === selectedProjectScope;
  }

  const identityScreen = document.getElementById("identity-screen");
  const dashboard = document.getElementById("dashboard");

  let currentIdentity = getStoredIdentity(); // {id, name}
  let allRequests = []; // [{id, ...data}]
  let selectedPeriod = "day";
  let categoryChart = null;
  let activeDetailId = null;
  let activeAfterImages = []; // [{url}] รูป "หลังซ่อม" ของรายการที่กำลังเปิดดูอยู่
  let unsubRequests = null; // ประกาศไว้ตั้งแต่ต้น main() เพราะ showDashboard()/startDashboard() อาจถูกเรียกทันทีด้านล่าง
  // (กรณีแอดมินเคยเลือกชื่อไว้แล้ว มี identity ที่จำไว้ใน localStorage) ก่อนที่โค้ดจะไล่ลงมาถึงบรรทัดประกาศตัวแปรนี้แบบเดิม

  // ---------------- IDENTITY (ไม่มีรหัสผ่าน) ----------------
  const idGrid = document.getElementById("admin-id-grid");
  idGrid.innerHTML = ADMINS.map(
    (a) => `<button type="button" class="admin-chip" data-id="${a.id}">
      <span class="id-num">${idNumberLabel(a.id)}</span>${escapeHtmlGlobal(a.name)}
    </button>`
  ).join("");
  idGrid.querySelectorAll(".admin-chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      const found = ADMINS.find((a) => a.id === btn.dataset.id);
      if (!found) return;
      currentIdentity = found;
      setStoredIdentity(found);
      showDashboard();
    });
  });

  document.getElementById("switch-user-btn").addEventListener("click", () => {
    clearStoredIdentity();
    currentIdentity = null;
    dashboard.style.display = "none";
    identityScreen.style.display = "flex";
  });

  function showDashboard() {
    identityScreen.style.display = "none";
    dashboard.style.display = "block";
    document.getElementById("admin-whoami").textContent = `${idNumberLabel(currentIdentity.id)} · ${currentIdentity.name}`;
    startDashboard();
  }

  if (currentIdentity) {
    showDashboard();
  } else {
    identityScreen.style.display = "flex";
  }

  // ---------------- SELECT OPTIONS ----------------
  // labelFn: ใช้แปล "ข้อความที่แสดง" เป็น 3 ภาษา โดย "value" ของ option ยังคงเป็นค่าไทยเดิม
  // (เพื่อไม่ให้กระทบการเทียบ/กรอง/บันทึกข้อมูลกับ Firestore ที่มีอยู่แล้ว)
  function fillSelect(el, options, includeEmpty, labelFn) {
    const fn = labelFn || ((o) => o);
    el.innerHTML = (includeEmpty ? `<option value="">-</option>` : "") +
      options.map((o) => `<option value="${o}">${fn(o)}</option>`).join("");
  }
  fillSelect(document.getElementById("filter-status"), Object.values(STATUS), false, statusTri);
  document.getElementById("filter-status").insertAdjacentHTML("afterbegin", `<option value="">${T.filterAllStatus}</option>`);
  // หมายเหตุ: ต้องตั้งค่า .value = "" ให้ชัดเจนหลังแทรก option "ทั้งหมด" เพราะเบราว์เซอร์จะยังค้าง
  // สถานะ "เลือกอยู่" ไว้ที่ตัวเลือกแรกเดิม (ก่อนแทรก) แม้ตำแหน่งจะเลื่อนไปเป็นลำดับที่ 2 แล้วก็ตาม
  // ถ้าไม่ตั้งค่านี้ ตัวกรองจะดูเหมือนเลือก "ทั้งหมด" อยู่ (มีตัวเลือกนี้อยู่บนสุด) แต่จริงๆกรองเหลือ
  // แค่สถานะแรกเท่านั้น ทำให้ตารางแสดงรายการไม่ครบและดูสับสน
  document.getElementById("filter-status").value = "";
  // ตัวกรอง/ดรอปดาวน์เลือกประเภทงาน: รวมทั้งที่เปิด+ปิดใช้งานอยู่ (กันไม่ให้แก้ไข/ดูรายการเก่าที่ใช้
  // ประเภทงานที่ถูกปิดใช้งานไปแล้วไม่ได้)
  function refreshCategorySelects() {
    fillSelect(document.getElementById("filter-category"), categories.map((c) => c.label), false, catTri);
    document.getElementById("filter-category").insertAdjacentHTML("afterbegin", `<option value="">${T.filterAllCategory}</option>`);
    fillSelect(document.getElementById("d-category"), categories.map((c) => c.label), false, catTri);
  }
  refreshCategorySelects();
  // ตั้งค่าตัวกรองประเภทงานให้เป็น "ทั้งหมด" เฉพาะครั้งแรกที่โหลดหน้า (เหตุผลเดียวกับด้านบน) —
  // ไม่ตั้งค่านี้ไว้ใน refreshCategorySelects() เอง เพราะฟังก์ชันนี้ถูกเรียกซ้ำเวลาเพิ่ม/แก้ไขประเภทงาน
  // ด้วย ถ้าไปรีเซ็ตตัวกรองทุกครั้ง จะรบกวนตัวกรองที่แอดมินเลือกไว้อยู่ระหว่างใช้งาน
  document.getElementById("filter-category").value = "";
  fillSelect(document.getElementById("d-status"), Object.values(STATUS), false, statusTri);
  fillSelect(document.getElementById("d-forwardDept"), DEPARTMENTS, true, deptTri);

  // ตัวสลับโปรเจกต์ (ขอบเขตทั้งหน้า) + ดรอปดาวน์เลือกโปรเจกต์ในหน้าต่างแก้ไขรายการ — รวมทั้งที่เปิด
  // +ปิดใช้งานอยู่เหมือนกับประเภทงาน (กันไม่ให้ดู/แก้ไขรายการเก่าที่ใช้โปรเจกต์ที่ถูกปิดใช้งานไปแล้วไม่ได้)
  function refreshProjectSelects() {
    const switcherEl = document.getElementById("project-switcher");
    const prevScope = switcherEl.value || selectedProjectScope;
    switcherEl.innerHTML =
      `<option value="">${T.filterAllProjects}</option>` +
      projects.map((p) => `<option value="${escapeHtmlGlobal(p.label)}">${escapeHtmlGlobal(p.label)}</option>`).join("") +
      `<option value="${UNASSIGNED_PROJECT_KEY}">${T.unassignedProjectLabel}</option>`;
    switcherEl.value = prevScope;
    if (switcherEl.value !== prevScope) switcherEl.value = ""; // ถ้าโปรเจกต์ที่เคยเลือกไว้หายไป กลับไปที่ "ทุกโปรเจกต์"
    selectedProjectScope = switcherEl.value;

    fillSelect(document.getElementById("d-project"), projects.map((p) => p.label), true, (o) => o);
  }
  refreshProjectSelects();
  document.getElementById("project-switcher").addEventListener("change", (e) => {
    selectedProjectScope = e.target.value;
    localStorage.setItem(PROJECT_SCOPE_KEY, selectedProjectScope);
    renderAll();
  });

  document.getElementById("d-status").addEventListener("change", (e) => {
    document.getElementById("d-forward-field").style.display = e.target.value === STATUS.FORWARDED ? "block" : "none";
  });
  document.getElementById("d-category").addEventListener("change", (e) => {
    document.getElementById("d-categoryOther").style.display = e.target.value === "อื่นๆ" ? "block" : "none";
  });

  // ---------------- จัดการประเภทงาน (เพิ่ม/แก้ไข/เปิด-ปิดใช้งานเอง ไม่ต้องแก้โค้ด) ----------------
  function renderCategoryManageList() {
    const listEl = document.getElementById("category-manage-list");
    const sorted = [...categories].sort((a, b) => (a.order ?? 999) - (b.order ?? 999) || (a.label || "").localeCompare(b.label || "", "th"));
    listEl.innerHTML = sorted
      .map(
        (c) => `
        <div class="cat-manage-row ${c.active === false ? "cat-disabled" : ""}" data-cat-id="${c.id}">
          <input type="text" class="cat-icon-input" value="${escapeHtmlGlobal(c.icon || "")}" maxlength="4" data-field="icon">
          <input type="text" class="cat-label-input" value="${escapeHtmlGlobal(c.label || "")}" data-field="label">
          <input type="color" class="cat-color-input" value="${c.color || "#6b7280"}" data-field="color">
          ${c.active === false ? `<span class="badge" style="background:#fee2e2; color:#991b1b;">${T.badgeCategoryDisabled}</span>` : ""}
          <button type="button" class="btn btn-outline btn-sm" data-cat-save="${c.id}">${T.btnCategorySave}</button>
          <button type="button" class="btn ${c.active === false ? "btn-secondary" : "btn-outline"} btn-sm" data-cat-toggle="${c.id}">
            ${c.active === false ? T.btnCategoryEnable : T.btnCategoryDisable}
          </button>
        </div>`
      )
      .join("");

    listEl.querySelectorAll("[data-cat-save]").forEach((btn) => {
      btn.addEventListener("click", () => saveCategoryRow(btn.dataset.catSave));
    });
    listEl.querySelectorAll("[data-cat-toggle]").forEach((btn) => {
      btn.addEventListener("click", () => toggleCategoryRow(btn.dataset.catToggle));
    });
  }

  async function saveCategoryRow(id) {
    const row = document.querySelector(`.cat-manage-row[data-cat-id="${id}"]`);
    if (!row) return;
    const label = row.querySelector('[data-field="label"]').value.trim();
    const icon = row.querySelector('[data-field="icon"]').value.trim() || "🔧";
    const color = row.querySelector('[data-field="color"]').value;
    if (!label) {
      showToast(T.msgCategoryNameRequired);
      return;
    }
    try {
      await updateCategory(id, { label, icon, color });
      const cat = categories.find((c) => c.id === id);
      if (cat) Object.assign(cat, { label, icon, color });
      refreshCategorySelects();
      renderCategoryManageList();
      renderAll();
      showToast(T.msgCategorySaved);
    } catch (e) {
      console.error(e);
      showToast(T.errorPrefix + e.message);
    }
  }

  async function toggleCategoryRow(id) {
    const cat = categories.find((c) => c.id === id);
    if (!cat) return;
    const nextActive = cat.active === false ? true : false;
    try {
      await updateCategory(id, { active: nextActive });
      cat.active = nextActive;
      renderCategoryManageList();
      renderAll();
      showToast(T.msgCategorySaved);
    } catch (e) {
      console.error(e);
      showToast(T.errorPrefix + e.message);
    }
  }

  renderCategoryManageList();

  document.getElementById("category-add-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const labelInput = document.getElementById("cat-label");
    const iconInput = document.getElementById("cat-icon");
    const colorInput = document.getElementById("cat-color");
    const label = labelInput.value.trim();
    if (!label) {
      showToast(T.msgCategoryNameRequired);
      return;
    }
    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    try {
      const newId = await addCategory({ label, icon: iconInput.value.trim(), color: colorInput.value });
      categories.push({
        id: newId,
        label,
        icon: iconInput.value.trim() || "🔧",
        color: colorInput.value,
        order: 999,
        active: true,
      });
      refreshCategorySelects();
      renderCategoryManageList();
      renderAll();
      labelInput.value = "";
      iconInput.value = "";
      colorInput.value = "#2563eb";
      showToast(T.msgCategoryAdded);
    } catch (err) {
      console.error(err);
      showToast(T.errorPrefix + err.message);
    } finally {
      submitBtn.disabled = false;
    }
  });

  // ---------------- จัดการโปรเจกต์ (เพิ่ม/แก้ไข/เปิด-ปิดใช้งานเอง ไม่ต้องแก้โค้ด) ----------------
  function renderProjectManageList() {
    const listEl = document.getElementById("project-manage-list");
    const sorted = [...projects].sort((a, b) => (a.order ?? 999) - (b.order ?? 999) || (a.label || "").localeCompare(b.label || "", "th"));
    listEl.innerHTML = sorted
      .map(
        (p) => `
        <div class="cat-manage-row ${p.active === false ? "cat-disabled" : ""}" data-proj-id="${p.id}">
          <input type="text" class="cat-label-input proj-label-input" value="${escapeHtmlGlobal(p.label || "")}" data-field="label">
          <input type="color" class="cat-color-input" value="${p.color || "#2563eb"}" data-field="color">
          ${p.active === false ? `<span class="badge" style="background:#fee2e2; color:#991b1b;">${T.badgeProjectDisabled}</span>` : ""}
          <button type="button" class="btn btn-outline btn-sm" data-proj-save="${p.id}">${T.btnProjectSave}</button>
          <button type="button" class="btn ${p.active === false ? "btn-secondary" : "btn-outline"} btn-sm" data-proj-toggle="${p.id}">
            ${p.active === false ? T.btnProjectEnable : T.btnProjectDisable}
          </button>
        </div>`
      )
      .join("");

    listEl.querySelectorAll("[data-proj-save]").forEach((btn) => {
      btn.addEventListener("click", () => saveProjectRow(btn.dataset.projSave));
    });
    listEl.querySelectorAll("[data-proj-toggle]").forEach((btn) => {
      btn.addEventListener("click", () => toggleProjectRow(btn.dataset.projToggle));
    });
  }

  async function saveProjectRow(id) {
    const row = document.querySelector(`.cat-manage-row[data-proj-id="${id}"]`);
    if (!row) return;
    const label = row.querySelector('[data-field="label"]').value.trim();
    const color = row.querySelector('[data-field="color"]').value;
    if (!label) {
      showToast(T.msgProjectNameRequired);
      return;
    }
    try {
      await updateProject(id, { label, color });
      const proj = projects.find((p) => p.id === id);
      if (proj) Object.assign(proj, { label, color });
      refreshProjectSelects();
      renderProjectManageList();
      renderAll();
      showToast(T.msgProjectSaved);
    } catch (e) {
      console.error(e);
      showToast(T.errorPrefix + e.message);
    }
  }

  async function toggleProjectRow(id) {
    const proj = projects.find((p) => p.id === id);
    if (!proj) return;
    const nextActive = proj.active === false ? true : false;
    try {
      await updateProject(id, { active: nextActive });
      proj.active = nextActive;
      renderProjectManageList();
      renderAll();
      showToast(T.msgProjectSaved);
    } catch (e) {
      console.error(e);
      showToast(T.errorPrefix + e.message);
    }
  }

  renderProjectManageList();

  document.getElementById("project-add-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const labelInput = document.getElementById("proj-label");
    const colorInput = document.getElementById("proj-color");
    const label = labelInput.value.trim();
    if (!label) {
      showToast(T.msgProjectNameRequired);
      return;
    }
    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    try {
      const newId = await addProject({ label, color: colorInput.value });
      projects.push({ id: newId, label, color: colorInput.value, order: 999, active: true });
      refreshProjectSelects();
      renderProjectManageList();
      renderAll();
      labelInput.value = "";
      colorInput.value = "#2563eb";
      showToast(T.msgProjectAdded);
    } catch (err) {
      console.error(err);
      showToast(T.errorPrefix + err.message);
    } finally {
      submitBtn.disabled = false;
    }
  });

  // ---------------- DASHBOARD DATA ----------------
  function startDashboard() {
    if (unsubRequests) return;
    const q = query(collection(db, "repairRequests"), orderBy("createdAt", "desc"));
    unsubRequests = onSnapshot(q, (snap) => {
      allRequests = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderAll();
    });
  }

  document.querySelectorAll('[data-period]').forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll('[data-period]').forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      selectedPeriod = btn.dataset.period;
      renderAll();
    });
  });

  ["filter-status", "filter-category", "filter-search"].forEach((id) => {
    document.getElementById(id).addEventListener("input", renderAll);
  });

  // ---------------- EXPORT TO EXCEL (พร้อมรูปภาพที่แนบ) ----------------
  // ส่งออกเฉพาะรายการที่กำลังแสดงอยู่ในตาราง ณ ขณะนั้น (ตามช่วงเวลา + ตัวกรองที่เลือกไว้)
  const IMG_COLS = 5; // จำนวนคอลัมน์รูปภาพสูงสุด (เท่ากับ MAX_IMAGES ของแอป)
  const THUMB_PX = 90; // ขนาดกรอบรูปย่อสูงสุดในไฟล์ Excel (พิกเซล)

  function getImageDims(dataUrl) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth || THUMB_PX, h: img.naturalHeight || THUMB_PX });
      img.onerror = () => resolve({ w: THUMB_PX, h: THUMB_PX });
      img.src = dataUrl;
    });
  }

  document.getElementById("export-excel-btn").addEventListener("click", async () => {
    const btn = document.getElementById("export-excel-btn");
    if (typeof ExcelJS === "undefined") {
      showToast(T.msgExcelToolLoadFail);
      return;
    }
    const items = applyTableFilters(lastPeriodItems);
    if (items.length === 0) {
      showToast(T.msgNoItemsToExport);
      return;
    }

    const originalLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = T.msgGeneratingFile;

    try {
      // ใช้ข้อความไทยล้วนสำหรับ "ชื่อไฟล์" เท่านั้น (ห้ามใช้ข้อความ 3 ภาษาเพราะมีเครื่องหมาย "/" จะทำให้ชื่อไฟล์เพี้ยน)
      const periodLabelMap = { day: "รายวัน", week: "รายสัปดาห์", month: "รายเดือน", all: "ทั้งหมด" };
      const periodLabel = periodLabelMap[selectedPeriod] || "ทั้งหมด";
      const periodTriMap = { day: T.periodDay, week: T.periodWeek, month: T.periodMonth, all: T.periodAll };
      const periodLabelTri = periodTriMap[selectedPeriod] || T.periodAll;
      const workbook = new ExcelJS.Workbook();
      workbook.creator = "แจ้งซ่อมออนไลน์ / Repair Report Online / 在线报修";

      // ---- ชีตที่ 1: สรุปตัวเลข (สอดคล้องกับสรุปรายวัน/สัปดาห์/เดือนบนแดชบอร์ด) ----
      const total = items.length;
      const done = items.filter((r) => r.status === STATUS.DONE).length;
      const pending = items.filter((r) => r.status === STATUS.PENDING).length;
      const forwarded = items.filter((r) => r.status === STATUS.FORWARDED).length;
      const overdueCount = items.filter((r) => isOverdue(r.dueDate, r.status, STATUS.DONE)).length;

      // หมายเหตุ: ชื่อชีต (worksheet name) คงเป็นภาษาไทยล้วนไว้เหมือนเดิม เพราะ Excel จำกัดชื่อชีตไม่เกิน 31 ตัวอักษร
      // ข้อความ 3 ภาษาจะยาวเกินไป — ส่วนหัวตาราง/เนื้อหาภายในชีตแปล 3 ภาษาให้ตามที่ขอ
      const summarySheet = workbook.addWorksheet("สรุป");
      summarySheet.columns = [{ header: tri("Item", "รายการ", "项目"), key: "k", width: 30 }, { header: tri("Count", "จำนวน", "数量"), key: "v", width: 16 }];
      summarySheet.getRow(1).font = { bold: true };
      const projectScopeLabel = !selectedProjectScope
        ? T.filterAllProjects
        : selectedProjectScope === UNASSIGNED_PROJECT_KEY
        ? T.unassignedProjectLabel
        : selectedProjectScope;
      [
        [tri("Export Period", "ช่วงเวลาที่ส่งออก", "导出时间范围"), periodLabelTri],
        [T.thProject, projectScopeLabel],
        [T.statTotal, total],
        [statusTri(STATUS.PENDING), pending],
        [statusTri(STATUS.DONE), done],
        [T.statForwarded, forwarded],
        [T.statOverdue, overdueCount],
        ...categoriesForStats(items).map((c) => [`${c.icon} ${catTri(c.label)}`, items.filter((r) => r.category === c.label).length]),
      ].forEach((row) => summarySheet.addRow(row));

      // ---- ชีตที่ 2: รายการแจ้งซ่อมทั้งหมด พร้อมรูปภาพที่แนบ ----
      const sheet = workbook.addWorksheet("รายการแจ้งซ่อม");
      const baseHeaders = [
        T.thTicketNo, T.thProject, T.labelSiteNameModal, tri("Location (Address)", "ตำแหน่ง (ที่อยู่)", "位置（地址）"), T.thReporter, T.thCategory,
        tri("Other (Specify)", "ระบุเพิ่มเติม (อื่นๆ)", "其他说明"), T.labelDescriptionModal, T.thDateReported, T.thDueDate,
        T.thStatus, tri("Overdue", "เกินกำหนดหรือไม่", "是否逾期"), T.labelForwardDept, T.lastEditedByPrefix,
      ];
      const beforeImageHeaders = Array.from({ length: IMG_COLS }, (_, i) => `${tri("Before", "ก่อนซ่อม", "维修前")} ${i + 1}`);
      const afterImageHeaders = Array.from({ length: IMG_COLS }, (_, i) => `${tri("After", "หลังซ่อม", "维修后")} ${i + 1}`);
      sheet.addRow([...baseHeaders, ...beforeImageHeaders, ...afterImageHeaders]);
      sheet.getRow(1).font = { bold: true };
      const colWidths = [22, 22, 26, 34, 24, 22, 24, 40, 20, 22, 26, 22, 26, 28];
      colWidths.forEach((w, i) => (sheet.getColumn(i + 1).width = w));
      for (let i = 0; i < IMG_COLS * 2; i++) sheet.getColumn(baseHeaders.length + 1 + i).width = 13;

      async function embedImagesInRow(images, colOffset, rowNum) {
        const imgs = (images || []).slice(0, IMG_COLS);
        for (let k = 0; k < imgs.length; k++) {
          const dataUrl = imgs[k].url;
          const match = /^data:image\/(\w+);base64,(.*)$/.exec(dataUrl || "");
          if (!match) continue;
          let ext = match[1].toLowerCase();
          if (ext === "jpg") ext = "jpeg";
          if (!["png", "jpeg", "gif"].includes(ext)) ext = "jpeg";
          const base64 = match[2];
          const dims = await getImageDims(dataUrl);
          const scale = Math.min(THUMB_PX / dims.w, THUMB_PX / dims.h, 1);
          const w = Math.max(1, Math.round(dims.w * scale));
          const h = Math.max(1, Math.round(dims.h * scale));
          const imageId = workbook.addImage({ base64, extension: ext });
          sheet.addImage(imageId, {
            tl: { col: colOffset + k, row: rowNum - 1 },
            ext: { width: w, height: h },
            editAs: "oneCell",
          });
        }
      }

      for (let i = 0; i < items.length; i++) {
        const r = items[i];
        const rowNum = i + 2;
        sheet.addRow([
          r.ticketId || r.id,
          r.project || T.unassignedProjectLabel,
          r.siteName || "",
          r.location?.address || "",
          r.reporterName || "",
          r.category ? catTri(r.category) : "",
          r.categoryOther || "",
          r.description || "",
          formatDateThai(r.dateReported),
          formatDateThai(r.dueDate),
          r.status ? statusTri(r.status) : "",
          isOverdue(r.dueDate, r.status, STATUS.DONE) ? T.statOverdue : "",
          r.forwardDept ? deptTri(r.forwardDept) : "",
          r.updatedBy || "",
        ]);
        sheet.getRow(rowNum).height = 70;
        sheet.getRow(rowNum).alignment = { vertical: "top", wrapText: true };

        await embedImagesInRow(r.images, baseHeaders.length, rowNum);
        await embedImagesInRow(r.afterImages, baseHeaders.length + IMG_COLS, rowNum);
      }

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const today = new Date().toISOString().slice(0, 10);
      const projectFileTag = !selectedProjectScope
        ? ""
        : `_${(selectedProjectScope === UNASSIGNED_PROJECT_KEY ? "ไม่ระบุโปรเจกต์" : selectedProjectScope).replace(/[\\/:*?"<>|]/g, "")}`;
      const a = document.createElement("a");
      a.href = url;
      a.download = `แจ้งซ่อม${projectFileTag}_${periodLabel}_${today}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showToast(msgExportSuccess(items.length));
    } catch (e) {
      console.error(e);
      showToast(T.msgExcelExportErrorPrefix + e.message, 4000);
    } finally {
      btn.disabled = false;
      btn.textContent = originalLabel;
    }
  });

  // ---------------- EXPORT TO PDF (ไลน์งาน — ใช้หน้าต่างสั่งพิมพ์ของเบราว์เซอร์ "Save as PDF") ----------------
  // ใช้วิธีนี้ (ไม่ใช้ไลบรารีสร้าง PDF เช่น jsPDF) เพราะฟอนต์ไทย/จีนของไลบรารีเหล่านั้นมักไม่รองรับ
  // ข้อความไทย/จีนจะกลายเป็นสี่เหลี่ยมว่างๆ ส่วนเบราว์เซอร์เองรองรับฟอนต์ระบบได้ครบทุกภาษาอยู่แล้ว
  // และไม่ต้องใช้ไลบรารีเพิ่มเติมจาก CDN เลย (ฟรี ไม่มีข้อจำกัด)
  document.getElementById("export-pdf-btn").addEventListener("click", () => {
    const items = applyTableFilters(lastPeriodItems);
    if (items.length === 0) {
      showToast(T.msgNoItemsToExport);
      return;
    }

    const periodTriMap = { day: T.periodDay, week: T.periodWeek, month: T.periodMonth, all: T.periodAll };
    const periodLabelTri = periodTriMap[selectedPeriod] || T.periodAll;
    const projectScopeLabel = !selectedProjectScope
      ? T.filterAllProjects
      : selectedProjectScope === UNASSIGNED_PROJECT_KEY
      ? T.unassignedProjectLabel
      : selectedProjectScope;
    const statusFilterVal = document.getElementById("filter-status").value;
    const categoryFilterVal = document.getElementById("filter-category").value;
    const scopeParts = [
      periodLabelTri,
      escapeHtml(projectScopeLabel),
      statusFilterVal ? statusTri(statusFilterVal) : T.filterAllStatus,
      categoryFilterVal ? catTri(categoryFilterVal) : T.filterAllCategory,
    ];

    const rowsHtml = items
      .map((r) => {
        const thumbUrl = r.images && r.images[0] ? r.images[0].url : null;
        const thumbCell = thumbUrl ? `<img class="print-thumb" src="${thumbUrl}">` : `<div class="no-photo">${T.pdfNoPhoto}</div>`;
        const overdue = isOverdue(r.dueDate, r.status, STATUS.DONE);
        return `
          <tr>
            <td>${thumbCell}</td>
            <td>${escapeHtml(r.ticketId || r.id)}</td>
            <td>${escapeHtml(r.project || T.unassignedProjectLabel)}</td>
            <td>${escapeHtml(r.siteName || "-")}</td>
            <td>${r.category ? escapeHtml(catTri(r.category)) : "-"}</td>
            <td>${escapeHtml(r.reporterName || "-")}</td>
            <td>${escapeHtml(r.description || "-")}</td>
            <td>${formatDateThai(r.dueDate)}${overdue ? " ⚠️" : ""}</td>
            <td>${r.status ? escapeHtml(statusTri(r.status)) : "-"}</td>
          </tr>`;
      })
      .join("");

    const generatedAt = new Date().toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });

    document.getElementById("print-report").innerHTML = `
      <div class="print-report-header">
        ${COMPANY?.logo ? `<img src="${COMPANY.logo}">` : ""}
        <div class="titles">
          <h1>${T.pdfReportTitle} — ${escapeHtml(COMPANY?.nameTh || "")}</h1>
          <div class="sub">${escapeHtml(COMPANY?.nameEn || "")}</div>
        </div>
      </div>
      <div class="print-report-meta">
        ${T.pdfGeneratedAtPrefix}: ${generatedAt} &nbsp;·&nbsp; ${T.pdfExportScopePrefix}: ${scopeParts.join(" / ")} &nbsp;·&nbsp; ${T.statTotal}: ${items.length}
      </div>
      <table class="print-report-table">
        <thead>
          <tr>
            <th></th>
            <th>${T.thTicketNo}</th>
            <th>${T.thProject}</th>
            <th>${T.labelSiteNameModal}</th>
            <th>${T.thCategory}</th>
            <th>${T.thReporter}</th>
            <th>${T.labelDescriptionModal}</th>
            <th>${T.thDueDate}</th>
            <th>${T.thStatus}</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    `;

    showToast(T.pdfPrintHint, 5000);
    setTimeout(() => window.print(), 300);
  });

  function withinPeriod(dateStr) {
    if (selectedPeriod === "all") return true;
    if (!dateStr) return false;
    const d = new Date(dateStr);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    d.setHours(0, 0, 0, 0);
    if (selectedPeriod === "day") return d.getTime() === today.getTime();
    if (selectedPeriod === "week") {
      const weekAgo = new Date(today);
      weekAgo.setDate(today.getDate() - 6);
      return d >= weekAgo && d <= today;
    }
    if (selectedPeriod === "month") {
      return d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth();
    }
    return true;
  }

  let lastPeriodItems = [];
  function renderAll() {
    const projectScopedItems = allRequests.filter(withinProjectScope);
    const periodItems = projectScopedItems.filter((r) => withinPeriod(r.dateReported));
    lastPeriodItems = periodItems;
    renderStats(periodItems);
    renderChart(periodItems);
    renderTable(periodItems);
  }

  function renderStats(items) {
    const total = items.length;
    const done = items.filter((r) => r.status === STATUS.DONE).length;
    const pending = items.filter((r) => r.status === STATUS.PENDING).length;
    const forwarded = items.filter((r) => r.status === STATUS.FORWARDED).length;
    const overdue = items.filter((r) => isOverdue(r.dueDate, r.status, STATUS.DONE)).length;

    const cards = [
      { num: total, lbl: T.statTotal, color: "#2563eb" },
      { num: pending, lbl: statusTri(STATUS.PENDING), color: "#f59e0b" },
      { num: done, lbl: statusTri(STATUS.DONE), color: "#10b981" },
      { num: forwarded, lbl: T.statForwarded, color: "#3b82f6" },
      { num: overdue, lbl: T.statOverdue, color: "#ef4444" },
    ];
    document.getElementById("stat-grid").innerHTML = cards
      .map((c) => `<div class="stat-card"><div class="num" style="color:${c.color};">${c.num}</div><div class="lbl">${c.lbl}</div></div>`)
      .join("");
  }

  function renderChart(items) {
    // Chart.js โหลดจาก CDN ภายนอก — ถ้าโหลดไม่สำเร็จ ให้ข้ามการวาดกราฟโดยไม่กระทบส่วนอื่นของแดชบอร์ด
    if (typeof Chart === "undefined") return;
    try {
      const statCats = categoriesForStats(items);
      const counts = statCats.map((c) => items.filter((r) => r.category === c.label).length);
      const ctx = document.getElementById("category-chart");
      if (categoryChart) categoryChart.destroy();
      categoryChart = new Chart(ctx, {
        type: "bar",
        data: {
          labels: statCats.map((c) => `${c.icon} ${catTri(c.label)}`),
          datasets: [{ data: counts, backgroundColor: statCats.map((c) => c.color), borderRadius: 8 }],
        },
        options: {
          plugins: { legend: { display: false } },
          scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
        },
      });
    } catch (e) {
      console.warn("Chart render skipped:", e);
    }
  }

  function applyTableFilters(items) {
    const status = document.getElementById("filter-status").value;
    const category = document.getElementById("filter-category").value;
    const search = document.getElementById("filter-search").value.trim().toLowerCase();

    let filtered = items;
    if (status) filtered = filtered.filter((r) => r.status === status);
    if (category) filtered = filtered.filter((r) => r.category === category);
    if (search) {
      filtered = filtered.filter((r) =>
        [r.siteName, r.reporterName, r.ticketId].filter(Boolean).some((v) => v.toLowerCase().includes(search))
      );
    }
    return filtered;
  }

  function renderTable(items) {
    const filtered = applyTableFilters(items);
    const tbody = document.getElementById("requests-tbody");
    const emptyState = document.getElementById("empty-table-state");
    if (filtered.length === 0) {
      tbody.innerHTML = "";
      emptyState.innerHTML = `<div class="empty-state"><span class="emoji">🗂️</span>${T.emptyTableState}</div>`;
      return;
    }
    emptyState.innerHTML = "";

    tbody.innerHTML = filtered
      .map((r) => {
        const style = STATUS_STYLE[r.status] || STATUS_STYLE[STATUS.PENDING];
        const overdue = isOverdue(r.dueDate, r.status, STATUS.DONE);
        const cat = categories.find((c) => c.label === r.category);
        const catColor = cat?.color || "#9ca3af";
        const catIcon = cat?.icon ? `${cat.icon} ` : "";
        const thumbUrl = r.images && r.images[0] ? r.images[0].url : null;
        const thumbCell = thumbUrl
          ? `<img class="table-thumb" src="${thumbUrl}" data-id="${r.id}" title="${T.clickToViewPhoto}">`
          : `<div class="table-thumb-placeholder" title="${T.noImagesAttached}">🗂️</div>`;
        return `
          <tr data-id="${r.id}">
            <td>${thumbCell}</td>
            <td>${r.ticketId || r.id}</td>
            <td>${escapeHtml(r.project || T.unassignedProjectLabel)}</td>
            <td>${escapeHtml(r.siteName || "-")}</td>
            <td>${r.category ? `<span class="cat-badge" style="background:${catColor}22; color:${catColor};"><span class="dot" style="background:${catColor};"></span>${catIcon}${escapeHtml(catTri(r.category))}</span>` : "-"}</td>
            <td>${escapeHtml(r.reporterName || "-")}</td>
            <td>${formatDateThai(r.dateReported)}</td>
            <td class="${overdue ? "overdue" : ""}">${formatDateThai(r.dueDate)}</td>
            <td><span class="badge" style="background:${style.bg}; color:${style.text};"><span class="dot" style="background:${style.dot};"></span>${statusTri(r.status)}</span></td>
          </tr>`;
      })
      .join("");

    tbody.querySelectorAll("tr").forEach((tr) => {
      tr.addEventListener("click", () => openDetail(tr.dataset.id));
    });
    // รูปตัวอย่างในตาราง — คลิกแล้วดูรูปเต็มจอทันที ไม่ต้องเปิดหน้ารายละเอียดก่อน
    tbody.querySelectorAll(".table-thumb").forEach((img) => {
      img.addEventListener("click", (e) => {
        e.stopPropagation();
        const r = allRequests.find((x) => x.id === img.dataset.id);
        if (r?.images?.length) openLightbox(r.images, 0);
      });
    });
  }

  function escapeHtml(str) {
    const d = document.createElement("div");
    d.textContent = str ?? "";
    return d.innerHTML;
  }

  // ---------------- DETAIL MODAL ----------------
  const detailModal = document.getElementById("detail-modal");

  // ---------------- IMAGE LIGHTBOX (ดูรูปเต็มจอ) ----------------
  const lightboxModal = document.getElementById("lightbox-modal");
  const lightboxImg = document.getElementById("lightbox-img");
  const lightboxCounter = document.getElementById("lightbox-counter");
  const lightboxPrevBtn = document.getElementById("lightbox-prev");
  const lightboxNextBtn = document.getElementById("lightbox-next");
  let lightboxImages = [];
  let lightboxIndex = 0;

  function openLightbox(images, startIndex) {
    lightboxImages = (images || []).filter((img) => img?.url);
    if (!lightboxImages.length) return;
    lightboxIndex = Math.min(Math.max(startIndex, 0), lightboxImages.length - 1);
    renderLightbox();
    lightboxModal.style.display = "flex";
  }

  function renderLightbox() {
    lightboxImg.src = lightboxImages[lightboxIndex].url;
    const multi = lightboxImages.length > 1;
    lightboxPrevBtn.style.display = multi ? "flex" : "none";
    lightboxNextBtn.style.display = multi ? "flex" : "none";
    lightboxCounter.style.display = multi ? "block" : "none";
    lightboxCounter.textContent = `${lightboxIndex + 1} / ${lightboxImages.length}`;
  }

  function closeLightbox() {
    lightboxModal.style.display = "none";
  }

  document.getElementById("lightbox-close").addEventListener("click", closeLightbox);
  lightboxPrevBtn.addEventListener("click", () => {
    lightboxIndex = (lightboxIndex - 1 + lightboxImages.length) % lightboxImages.length;
    renderLightbox();
  });
  lightboxNextBtn.addEventListener("click", () => {
    lightboxIndex = (lightboxIndex + 1) % lightboxImages.length;
    renderLightbox();
  });
  // คลิกพื้นหลังมืดๆ (นอกรูป/นอกปุ่ม) เพื่อปิด
  lightboxModal.addEventListener("click", (e) => {
    if (e.target === lightboxModal) closeLightbox();
  });
  document.addEventListener("keydown", (e) => {
    if (lightboxModal.style.display === "none") return;
    if (e.key === "Escape") closeLightbox();
    else if (e.key === "ArrowLeft" && lightboxImages.length > 1) lightboxPrevBtn.click();
    else if (e.key === "ArrowRight" && lightboxImages.length > 1) lightboxNextBtn.click();
  });

  function openDetail(id) {
    const r = allRequests.find((x) => x.id === id);
    if (!r) return;
    activeDetailId = id;

    document.getElementById("d-ticketId").value = r.ticketId || r.id;
    document.getElementById("d-siteName").value = r.siteName || "";
    document.getElementById("d-reporterName").value = r.reporterName || "";
    document.getElementById("d-project").value = r.project || "";
    document.getElementById("d-category").value = r.category || "";
    document.getElementById("d-categoryOther").value = r.categoryOther || "";
    document.getElementById("d-categoryOther").style.display = r.category === "อื่นๆ" ? "block" : "none";
    document.getElementById("d-description").value = r.description || "";
    document.getElementById("d-dateReported").value = r.dateReported || "";
    document.getElementById("d-dueDate").value = r.dueDate || "";
    document.getElementById("d-status").value = r.status || STATUS.PENDING;
    document.getElementById("d-forward-field").style.display = r.status === STATUS.FORWARDED ? "block" : "none";
    document.getElementById("d-forwardDept").value = r.forwardDept || "";

    const locText = document.getElementById("d-location-text");
    const mapLink = document.getElementById("d-map-link");
    if (r.location) {
      locText.textContent = r.location.address || `${r.location.lat}, ${r.location.lng}`;
      mapLink.href = `https://www.google.com/maps?q=${r.location.lat},${r.location.lng}`;
      mapLink.style.display = "inline-block";
    } else {
      locText.textContent = T.noLocationSpecified;
      mapLink.style.display = "none";
    }

    const imgWrap = document.getElementById("d-images");
    imgWrap.innerHTML = (r.images || [])
      .map((img, idx) => `<div class="img-preview"><img src="${img.url}" data-idx="${idx}" title="${T.clickToViewPhoto}"><button type="button" class="remove-btn" data-idx="${idx}">✕</button></div>`)
      .join("") || `<div class="hint">${T.noImagesAttached}</div>`;
    imgWrap.querySelectorAll("img").forEach((imgEl) => {
      imgEl.addEventListener("click", () => openLightbox(r.images, Number(imgEl.dataset.idx)));
    });
    imgWrap.querySelectorAll(".remove-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const idx = Number(btn.dataset.idx);
        r.images = r.images.filter((_, i) => i !== idx);
        openDetail(id); // re-render
      });
    });

    // รูปภาพ "หลังซ่อม" — เก็บ state แยกต่างหาก (activeAfterImages) เพื่อรองรับการเพิ่มรูปใหม่ก่อนกดบันทึก
    activeAfterImages = (r.afterImages || []).slice();
    renderAfterImagePreviews();

    document.getElementById("d-meta").textContent =
      `${T.reportedOnPrefix} ${formatDateThai(r.dateReported)}` + (r.updatedBy ? ` · ${T.lastEditedByPrefix} ${r.updatedBy}` : "");

    detailModal.style.display = "flex";
  }

  function renderAfterImagePreviews() {
    const afterWrap = document.getElementById("d-after-images");
    const afterUploadBox = document.getElementById("d-after-upload-box");
    afterWrap.innerHTML = activeAfterImages
      .map((img, idx) => `<div class="img-preview"><img src="${img.url}" data-idx="${idx}" title="${T.clickToViewPhoto}"><button type="button" class="remove-btn" data-idx="${idx}">✕</button></div>`)
      .join("") || `<div class="hint">${T.noAfterImagesYet}</div>`;
    afterWrap.querySelectorAll("img").forEach((imgEl) => {
      imgEl.addEventListener("click", () => openLightbox(activeAfterImages, Number(imgEl.dataset.idx)));
    });
    afterWrap.querySelectorAll(".remove-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const idx = Number(btn.dataset.idx);
        activeAfterImages = activeAfterImages.filter((_, i) => i !== idx);
        renderAfterImagePreviews();
      });
    });
    afterUploadBox.style.display = activeAfterImages.length >= MAX_IMAGES ? "none" : "block";
  }

  const AFTER_MAX_BYTES = MAX_IMAGE_MB * 1024 * 1024;
  const afterUploadBoxEl = document.getElementById("d-after-upload-box");
  const afterImageInput = document.getElementById("d-after-image-input");
  afterUploadBoxEl.addEventListener("click", () => afterImageInput.click());
  afterImageInput.addEventListener("change", async (e) => {
    const files = Array.from(e.target.files || []);
    afterImageInput.value = "";
    for (const f of files) {
      if (activeAfterImages.length >= MAX_IMAGES) {
        showToast(msgMaxAfterImages(MAX_IMAGES));
        break;
      }
      if (f.size > AFTER_MAX_BYTES) {
        showToast(msgFileTooLarge(f.name, MAX_IMAGE_MB));
        continue;
      }
      try {
        const dataUrl = await compressImageToDataUrl(f);
        activeAfterImages.push({ url: dataUrl });
      } catch (err) {
        console.error(err);
        showToast(T.msgCompressFailPrefix + err.message);
      }
    }
    renderAfterImagePreviews();
  });

  document.getElementById("close-detail-modal").addEventListener("click", () => (detailModal.style.display = "none"));
  document.getElementById("cancel-detail-btn").addEventListener("click", () => (detailModal.style.display = "none"));

  document.getElementById("save-detail-btn").addEventListener("click", async () => {
    if (!activeDetailId) return;
    const r = allRequests.find((x) => x.id === activeDetailId);
    const btn = document.getElementById("save-detail-btn");
    btn.disabled = true;
    btn.textContent = T.msgSaving;

    try {
      // รูปภาพเก็บเป็น base64 ตรงใน Firestore (ไม่ใช้ Storage) ลบออกจาก array ก็เพียงพอแล้ว
      const updated = {
        siteName: document.getElementById("d-siteName").value.trim(),
        reporterName: document.getElementById("d-reporterName").value.trim(),
        project: document.getElementById("d-project").value,
        category: document.getElementById("d-category").value,
        categoryOther: document.getElementById("d-categoryOther").value.trim(),
        description: document.getElementById("d-description").value.trim(),
        dateReported: document.getElementById("d-dateReported").value,
        dueDate: document.getElementById("d-dueDate").value,
        status: document.getElementById("d-status").value,
        forwardDept: document.getElementById("d-status").value === STATUS.FORWARDED ? document.getElementById("d-forwardDept").value : "",
        images: r ? r.images : [],
        afterImages: activeAfterImages,
        updatedAt: serverTimestamp(),
        updatedBy: currentIdentity ? `${currentIdentity.id} - ${currentIdentity.name}` : tri("Admin", "แอดมิน", "管理员"),
      };

      await updateDoc(doc(db, "repairRequests", activeDetailId), updated);
      showToast(T.msgSaveSuccess);
      detailModal.style.display = "none";
    } catch (e) {
      console.error(e);
      showToast(T.errorPrefix + e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = T.btnSaveChanges;
    }
  });
}
