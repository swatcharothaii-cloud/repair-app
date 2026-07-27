import { COMPANY, CONTRACTOR_JOB_TYPE, CONTRACTOR_JOB_TYPE_STYLE, CONTRACTOR_JOB_STATUS, MAX_IMAGE_MB } from "./config.js";
import { renderCompanyBrandBar, showToast, formatDateThai, todayStr } from "./utils.js";
import { T, jobTypeTri, contractorJobStatusTri } from "./i18n.js";
import { watchContractorJob, respondFixJob, acceptQuoteJob, rejectJob, submitDelivery } from "./contractor-jobs.js";
import { compressImageToDataUrl } from "./image-compress.js";

const MAX_DELIVERY_IMAGES = 20; // ภาพส่งมอบงาน แนบได้มากกว่าภาพก่อนซ่อมทั่วไป (ซึ่งจำกัดที่ MAX_IMAGES/5 ภาพ)
let deliveryImages = []; // [{url}] เก็บระหว่างกรอกฟอร์มส่งมอบงาน ก่อนกดส่ง

renderCompanyBrandBar("brand-bar", COMPANY);

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str == null ? "" : String(str);
  return d.innerHTML;
}

const params = new URLSearchParams(window.location.search);
const jobDocId = params.get("job") || "";
const contentEl = document.getElementById("job-content");

let currentJob = null;
// true เมื่อผู้รับเหมากด "รับงาน" แล้ว กำลังจะกรอกรายละเอียด (ใช้ร่วมกันทั้ง fix/defect/quote)
let showResponseForm = false;

if (!jobDocId) {
  contentEl.innerHTML = `<div class="hint" style="color:var(--danger);">${T.contractorJobNotFound}</div>`;
} else {
  watchContractorJob(
    jobDocId,
    (job) => {
      currentJob = job;
      render();
    },
    () => showToast(T.msgConnectFailCheckInternet)
  );
}

function render() {
  if (!currentJob) {
    contentEl.innerHTML = `<div class="hint" style="color:var(--danger);">${T.contractorJobNotFound}</div>`;
    return;
  }
  const job = currentJob;
  const isFixLike = job.type !== CONTRACTOR_JOB_TYPE.QUOTE; // fix และ defect ใช้ฟอร์มเดียวกัน
  const typeStyle = CONTRACTOR_JOB_TYPE_STYLE[job.type] || CONTRACTOR_JOB_TYPE_STYLE[CONTRACTOR_JOB_TYPE.FIX];
  const photosHtml = (job.images || [])
    .map((img, i) => `<img src="${img.url}" data-idx="${i}" title="${T.clickToViewPhoto || ""}">`)
    .join("");

  let actionHtml = "";
  if (job.status === CONTRACTOR_JOB_STATUS.WAITING) {
    if (!showResponseForm) {
      actionHtml = acceptRejectGateHtml();
    } else if (isFixLike) {
      actionHtml = fixFormHtml(job);
    } else {
      actionHtml = quoteFormHtml();
    }
  } else if (job.status === CONTRACTOR_JOB_STATUS.CONFIRMED) {
    const confirmedDetailsHtml = isFixLike
      ? `<div class="card" style="background:#d1fae5; border:1px solid #6ee7b7; margin-top:16px;">
            <strong>✅ ${T.contractorSubmittedThanks}</strong>
            <div class="meta" style="margin-top:8px;">📅 ${T.contractorSiteVisitDateLabel}: ${formatDateThai(job.siteVisitDate)}</div>
            <div class="meta">⏱️ ${T.contractorRepairDaysLabel}: ${job.repairDays}</div>
            ${job.type === CONTRACTOR_JOB_TYPE.FIX && job.repairPrice != null ? `<div class="meta">💰 ${T.contractorRepairPriceLabel}: ฿${Number(job.repairPrice || 0).toLocaleString("th-TH")}</div>` : ""}
          </div>`
      : `<div class="card" style="background:#d1fae5; border:1px solid #6ee7b7; margin-top:16px;">
            <strong>✅ ${T.contractorSubmittedThanks}</strong>
            <div class="meta" style="margin-top:8px;">⏱️ ${T.contractorQuoteDaysLabel}: ${job.quoteDays}</div>
            <div class="meta">💰 ${T.contractorQuotePriceLabel}: ฿${Number(job.quotePrice || 0).toLocaleString("th-TH")}</div>
            ${job.quoteNote ? `<div class="meta">📝 ${T.contractorQuoteNoteLabel}: ${escapeHtml(job.quoteNote)}</div>` : ""}
          </div>`;

    // หลังตกลงราคา/วันแล้ว ให้ผู้รับเหมาแจ้ง "ส่งมอบงาน" ได้ (ครั้งเดียว) แล้วรอทีมงานภายในตรวจรับ
    const deliveryPhotosHtml = (job.deliveryImages || [])
      .map((img, i) => `<img src="${img.url}" data-delivery-idx="${i}" title="${T.clickToViewPhoto || ""}">`)
      .join("");
    let deliveryHtml = "";
    if (!job.deliverySubmitted) {
      deliveryHtml = `
        <div class="card" style="margin-top:16px;">
          <strong>${T.contractorSubmitDeliveryTitle}</strong>
          <div class="field" style="margin-top:10px;">
            <label>📅 ${T.contractorDeliveryDateLabel}</label>
            <input type="date" id="f-delivery-date" value="${todayStr()}">
          </div>
          <div class="field">
            <label>🙋 ${T.contractorSupervisorNameLabel}</label>
            <input type="text" id="f-supervisor-name" placeholder="e.g. K.Somchai">
          </div>
          <div class="field">
            <label>📝 ${T.contractorDeliveryNoteLabel}</label>
            <textarea id="f-delivery-note" rows="2"></textarea>
          </div>
          <div class="field">
            <label>🖼️ ${T.contractorDeliveryPhotosLabel}</label>
            <div class="img-preview-grid" id="f-delivery-image-previews"></div>
            <div class="upload-box" id="f-delivery-upload-box">
              <input type="file" id="f-delivery-image-input" accept="image/*" multiple style="display:none">
              📷 Tap to add delivery photo / แตะเพื่อเพิ่มภาพส่งมอบงาน / 点击添加交付照片
            </div>
          </div>
          <button class="btn btn-primary btn-block" id="submit-delivery-btn">${T.contractorSubmitDeliveryBtn}</button>
        </div>`;
    } else if (!job.deliveryAccepted) {
      deliveryHtml = `
        <div class="card" style="background:#fef3c7; border:1px solid #fde68a; margin-top:16px;">
          <strong>⏳ ${T.contractorDeliverySubmittedMsg}</strong>
          <div class="meta" style="margin-top:8px;">📅 ${T.contractorDeliveryDateLabel}: ${formatDateThai(job.deliveryDate)}</div>
          ${job.supervisorName ? `<div class="meta">🙋 ${T.contractorSupervisorNameLabel}: ${escapeHtml(job.supervisorName)}</div>` : ""}
          ${job.deliveryNote ? `<div class="meta">📝 ${escapeHtml(job.deliveryNote)}</div>` : ""}
          ${deliveryPhotosHtml ? `<div class="meta" style="margin-top:8px;">🖼️ ${T.contractorDeliveryPhotosLabel}</div><div class="ticket-thumbs">${deliveryPhotosHtml}</div>` : ""}
        </div>`;
    }
    actionHtml = confirmedDetailsHtml + deliveryHtml;
  } else if (job.status === CONTRACTOR_JOB_STATUS.REJECTED) {
    actionHtml = `<div class="card" style="background:#fee2e2; border:1px solid #fca5a5; margin-top:16px;"><strong>❌ ${T.contractorRejectedMsg}</strong></div>`;
  } else if (job.status === CONTRACTOR_JOB_STATUS.DONE) {
    const doneDeliveryPhotosHtml = (job.deliveryImages || [])
      .map((img, i) => `<img src="${img.url}" data-delivery-idx="${i}" title="${T.clickToViewPhoto || ""}">`)
      .join("");
    actionHtml = `
      <div class="card" style="background:#dbeafe; border:1px solid #93c5fd; margin-top:16px;">
        <strong>🏁 ${T.contractorDeliveryAcceptedMsg}</strong>
        ${job.poNumber ? `<div class="meta" style="margin-top:8px;">🧾 ${T.contractorPoLabel}: ${escapeHtml(job.poNumber)}</div>` : ""}
        <div class="meta" style="margin-top:8px;">📅 ${T.contractorDeliveryDateLabel}: ${formatDateThai(job.deliveryDate)}</div>
        ${job.supervisorName ? `<div class="meta">🙋 ${T.contractorSupervisorNameLabel}: ${escapeHtml(job.supervisorName)}</div>` : ""}
        ${doneDeliveryPhotosHtml ? `<div class="meta" style="margin-top:8px;">🖼️ ${T.contractorDeliveryPhotosLabel}</div><div class="ticket-thumbs">${doneDeliveryPhotosHtml}</div>` : ""}
      </div>`;
  } else {
    actionHtml = `<div class="card" style="background:#dbeafe; border:1px solid #93c5fd; margin-top:16px;"><strong>🏁 ${contractorJobStatusTri(job.status)}</strong></div>`;
  }

  const defectBanner =
    job.type === CONTRACTOR_JOB_TYPE.DEFECT && job.defectRound
      ? `<div class="card" style="background:#fee2e2; border:1px solid #fca5a5; color:#991b1b; font-weight:700; margin-bottom:12px;">
          ⚠️ ${T.contractorDefectRoundPrefix} ${escapeHtml(String(job.defectRound))}
        </div>`
      : "";

  contentEl.innerHTML = `
    ${defectBanner}
    <span class="badge" style="background:${typeStyle.bg}; color:${typeStyle.text}; border:1px solid ${typeStyle.border}; font-weight:700; margin-bottom:10px;">${typeStyle.icon} ${jobTypeTri(job.type)}</span>
    <h3 style="margin:8px 0 4px;">${escapeHtml(job.siteName || job.project || "-")}</h3>
    ${job.project ? `<div class="meta">📍 Project / โปรเจกต์ / 项目: ${escapeHtml(job.project)}</div>` : ""}
    ${job.contractorName ? `<div class="meta">👷 ${T.contractorLabel}: ${escapeHtml(job.contractorName)}</div>` : ""}
    <div class="desc" style="margin-top:10px;">${escapeHtml(job.description || "")}</div>
    ${photosHtml ? `<div class="meta" style="margin-top:12px;">🖼️ Photos / รูปภาพ / 照片</div><div class="ticket-thumbs">${photosHtml}</div>` : ""}
    <div id="job-action"></div>
  `;

  contentEl.querySelectorAll(".ticket-thumbs img").forEach((img) => {
    img.addEventListener("click", () => openLightbox(job.images, Number(img.dataset.idx)));
  });

  document.getElementById("job-action").innerHTML = actionHtml;
  // ภาพส่งมอบงาน (deliveryImages) เป็นแกลเลอรีคนละชุดกับภาพก่อนซ่อม (job.images) ด้านบน — ผูก lightbox แยกกัน
  document.querySelectorAll("[data-delivery-idx]").forEach((img) => {
    img.addEventListener("click", () => openLightbox(job.deliveryImages, Number(img.dataset.deliveryIdx)));
  });
  wireActionHandlers(job);
  if (!job.deliverySubmitted) renderDeliveryImagePreviews();
}

function renderDeliveryImagePreviews() {
  const el = document.getElementById("f-delivery-image-previews");
  const uploadBox = document.getElementById("f-delivery-upload-box");
  if (!el) return; // ฟอร์มส่งมอบงานไม่ได้แสดงอยู่ตอนนี้
  el.innerHTML = deliveryImages
    .map(
      (img, i) => `<div class="img-preview"><img src="${img.url}"><button type="button" class="remove-btn" data-idx="${i}">✕</button></div>`
    )
    .join("");
  el.querySelectorAll(".remove-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      deliveryImages.splice(Number(btn.dataset.idx), 1);
      renderDeliveryImagePreviews();
    });
  });
  if (uploadBox) uploadBox.style.display = deliveryImages.length >= MAX_DELIVERY_IMAGES ? "none" : "block";
}

function acceptRejectGateHtml() {
  return `
    <div class="card" style="margin-top:16px;">
      <div class="hint" style="margin-bottom:10px;">${T.contractorAwaitingResponseMsg}</div>
      <div style="display:flex; gap:10px;">
        <button class="btn btn-primary btn-block" id="accept-job-btn">✅ ${T.contractorAcceptBtn}</button>
        <button class="btn btn-outline btn-block" id="reject-job-btn">❌ ${T.contractorRejectBtn}</button>
      </div>
    </div>
  `;
}

function fixFormHtml(job) {
  // เฉพาะงานประเภท "fix" ให้ผู้รับเหมาเสนอราคาค่าซ่อมเพิ่มเติมด้วย (defect ไม่มีช่องราคา เพราะเป็นงานแก้ไขที่ตรวจไม่ผ่าน ไม่คิดเงินเพิ่ม)
  const showPriceField = job.type === CONTRACTOR_JOB_TYPE.FIX;
  return `
    <div class="card" style="margin-top:16px;">
      <div class="field">
        <label>📅 ${T.contractorSiteVisitDateLabel}</label>
        <input type="date" id="f-visit-date" value="${job.siteVisitDate || todayStr()}">
      </div>
      <div class="field">
        <label>⏱️ ${T.contractorRepairDaysLabel}</label>
        <input type="number" id="f-repair-days" min="1" step="1" placeholder="e.g. 3">
      </div>
      ${showPriceField ? `
      <div class="field">
        <label>💰 ${T.contractorRepairPriceLabel}</label>
        <input type="number" id="f-repair-price" min="0" step="0.01" placeholder="e.g. 8000">
      </div>` : ""}
      <button class="btn btn-primary btn-block" id="submit-fix-btn">${T.contractorSubmitBtn}</button>
    </div>
  `;
}

function quoteFormHtml() {
  return `
    <div class="card" style="margin-top:16px;">
      <div class="field">
        <label>⏱️ ${T.contractorQuoteDaysLabel}</label>
        <input type="number" id="f-quote-days" min="1" step="1" placeholder="e.g. 5">
      </div>
      <div class="field">
        <label>💰 ${T.contractorQuotePriceLabel}</label>
        <input type="number" id="f-quote-price" min="0" step="0.01" placeholder="e.g. 25000">
      </div>
      <div class="field">
        <label>📝 ${T.contractorQuoteNoteLabel}</label>
        <textarea id="f-quote-note" rows="2"></textarea>
      </div>
      <button class="btn btn-primary btn-block" id="submit-quote-btn">${T.contractorSubmitBtn}</button>
    </div>
  `;
}

function wireActionHandlers(job) {
  const acceptBtn = document.getElementById("accept-job-btn");
  if (acceptBtn) {
    acceptBtn.addEventListener("click", () => {
      showResponseForm = true;
      render();
    });
  }

  const rejectBtn = document.getElementById("reject-job-btn");
  if (rejectBtn) {
    rejectBtn.addEventListener("click", async () => {
      if (!confirm(T.contractorRejectBtn + "?")) return;
      try {
        await rejectJob(job.id);
      } catch (e) {
        console.error(e);
        showToast(T.errorPrefix + e.message);
      }
    });
  }

  const fixBtn = document.getElementById("submit-fix-btn");
  if (fixBtn) {
    fixBtn.addEventListener("click", async () => {
      const siteVisitDate = document.getElementById("f-visit-date").value;
      const repairDays = document.getElementById("f-repair-days").value;
      const priceInput = document.getElementById("f-repair-price");
      const repairPrice = priceInput ? priceInput.value : "";
      const priceRequired = job.type === CONTRACTOR_JOB_TYPE.FIX;
      if (!siteVisitDate || !repairDays || (priceRequired && !repairPrice)) {
        showToast("Please fill in all fields / กรุณากรอกข้อมูลให้ครบ / 请填写所有字段");
        return;
      }
      try {
        await respondFixJob(job.id, { siteVisitDate, repairDays, repairPrice });
        showToast(T.contractorSubmittedThanks);
      } catch (e) {
        console.error(e);
        showToast(T.errorPrefix + e.message);
      }
    });
  }

  const deliveryImageInput = document.getElementById("f-delivery-image-input");
  const deliveryUploadBox = document.getElementById("f-delivery-upload-box");
  if (deliveryImageInput && deliveryUploadBox) {
    deliveryUploadBox.addEventListener("click", () => deliveryImageInput.click());
    deliveryImageInput.addEventListener("change", async (e) => {
      const files = Array.from(e.target.files || []);
      e.target.value = "";
      for (const file of files) {
        if (deliveryImages.length >= MAX_DELIVERY_IMAGES) {
          showToast(T.msgMaxDeliveryImages);
          break;
        }
        if (file.size > MAX_IMAGE_MB * 1024 * 1024) {
          showToast(`File too large / ไฟล์ใหญ่เกินไป (${MAX_IMAGE_MB}MB) / 文件过大: ${file.name}`);
          continue;
        }
        try {
          const url = await compressImageToDataUrl(file);
          deliveryImages.push({ url });
        } catch (err) {
          console.error(err);
        }
      }
      renderDeliveryImagePreviews();
    });
  }

  const submitDeliveryBtn = document.getElementById("submit-delivery-btn");
  if (submitDeliveryBtn) {
    submitDeliveryBtn.addEventListener("click", async () => {
      const deliveryDate = document.getElementById("f-delivery-date").value;
      const deliveryNote = document.getElementById("f-delivery-note").value;
      const supervisorName = document.getElementById("f-supervisor-name").value;
      if (!deliveryDate || !supervisorName.trim()) {
        showToast("Please fill in all fields / กรุณากรอกข้อมูลให้ครบ / 请填写所有字段");
        return;
      }
      if (!confirm(T.contractorSubmitDeliveryBtn + "?")) return;
      submitDeliveryBtn.disabled = true;
      try {
        await submitDelivery(job.id, { deliveryDate, deliveryNote, supervisorName, deliveryImages });
        deliveryImages = [];
        showToast(T.contractorSubmittedThanks);
      } catch (e) {
        console.error(e);
        showToast(T.errorPrefix + e.message);
      } finally {
        submitDeliveryBtn.disabled = false;
      }
    });
  }

  const submitQuoteBtn = document.getElementById("submit-quote-btn");
  if (submitQuoteBtn) {
    submitQuoteBtn.addEventListener("click", async () => {
      const quoteDays = document.getElementById("f-quote-days").value;
      const quotePrice = document.getElementById("f-quote-price").value;
      const quoteNote = document.getElementById("f-quote-note").value;
      if (!quoteDays || !quotePrice) {
        showToast("Please fill in all fields / กรุณากรอกข้อมูลให้ครบ / 请填写所有字段");
        return;
      }
      try {
        await acceptQuoteJob(job.id, { quoteDays, quotePrice, quoteNote });
        showToast(T.contractorSubmittedThanks);
      } catch (e) {
        console.error(e);
        showToast(T.errorPrefix + e.message);
      }
    });
  }
}

// ============ Image Lightbox ============
let currentImages = [];
let currentIndex = 0;
const lightboxModal = document.getElementById("lightbox-modal");
const lightboxImg = document.getElementById("lightbox-img");
const lightboxCounter = document.getElementById("lightbox-counter");

function openLightbox(images, startIndex) {
  currentImages = images || [];
  currentIndex = startIndex || 0;
  if (!currentImages.length) return;
  renderLightbox();
  lightboxModal.style.display = "flex";
}
function renderLightbox() {
  lightboxImg.src = currentImages[currentIndex]?.url || "";
  lightboxCounter.textContent = `${currentIndex + 1} / ${currentImages.length}`;
}
document.getElementById("lightbox-close").addEventListener("click", () => (lightboxModal.style.display = "none"));
document.getElementById("lightbox-prev").addEventListener("click", () => {
  currentIndex = (currentIndex - 1 + currentImages.length) % currentImages.length;
  renderLightbox();
});
document.getElementById("lightbox-next").addEventListener("click", () => {
  currentIndex = (currentIndex + 1) % currentImages.length;
  renderLightbox();
});
lightboxModal.addEventListener("click", (e) => {
  if (e.target === lightboxModal) lightboxModal.style.display = "none";
});
