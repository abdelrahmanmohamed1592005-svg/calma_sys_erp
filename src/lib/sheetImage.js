/*
  بيرسم "ورقة" من تقرير الأونر (انظر domain/ownerReport.js) صورة PNG على canvas - من غير أي مكتبة خارجية.
  الصورة هي اللي بتتبعت واتساب، فالخط كبير وواضح على الموبايل. الرسم من اليمين للشمال زي الورق بالظبط.
*/
const W = 1240, PAD = 40;
const FONT = "'IBM Plex Sans Arabic','Tajawal',system-ui,sans-serif";
const INK = "#161D27", MUTED = "#5F6672", LINE = "#8D8676", HEAD_BG = "#EDE7D6", SECTION_BG = "#F6F2E6", RUST = "#B3261E", SAGE = "#1E6B4E";
const font = (size, weight = 500) => `${weight} ${size}px ${FONT}`;
const CELL = 19, CELL_LH = 27, CELL_PAD = 10, ROW_MIN = 48, HEAD_H = 48;

/* تكسير سطر على عرض معيّن - الجزء المعزول (‎⁦...⁩‎) بيفضل قطعة واحدة */
function wrap(ctx, text, maxW) {
  const s = String(text ?? "");
  if (!s) return [];
  if (ctx.measureText(s).width <= maxW) return [s];
  const words = s.match(/⁦[^⁩]*⁩|\S+/g) || [s];
  const out = [];
  let cur = "";
  words.forEach((w) => {
    const next = cur ? cur + " " + w : w;
    if (cur && ctx.measureText(next).width > maxW) { out.push(cur); cur = w; } else cur = next;
  });
  if (cur) out.push(cur);
  return out;
}
const linesOf = (v) => (Array.isArray(v) ? v : v == null || v === "" ? [] : [v]);

function layout(ctx, sheet) {
  const inner = W - PAD * 2;
  const totalW = sheet.columns.reduce((s, c) => s + c.w, 0);
  const cols = sheet.columns.map((c) => ({ ...c, px: (inner * c.w) / totalW }));
  ctx.font = font(CELL);
  const rows = sheet.rows.map((r) => {
    const cells = cols.map((c) => linesOf(r.cells[c.key]).flatMap((l) => wrap(ctx, l, c.px - 14)));
    const n = Math.max(1, ...cells.map((l) => l.length));
    return { tone: r.tone, cells, h: Math.max(ROW_MIN, n * CELL_LH + CELL_PAD * 2) };
  });
  ctx.font = font(18);
  const notes = (sheet.notes || []).flatMap((n) => wrap(ctx, n, inner));
  return { cols, rows, notes, inner };
}

export async function renderSheetToCanvas(sheet, { scale = 2, stamp = "" } = {}) {
  if (typeof document !== "undefined" && document.fonts?.load) {
    try { await Promise.all([document.fonts.load(font(CELL)), document.fonts.load(font(CELL, 700))]); } catch { /* الخط الاحتياطي كفاية */ }
  }
  const probe = document.createElement("canvas").getContext("2d");
  probe.direction = "rtl";
  const L = layout(probe, sheet);
  const perRow = 4, BOX_H = 84, BOX_GAP = 10;
  const boxRows = Math.ceil((sheet.summary || []).length / perRow);
  const headTop = PAD + 58, tableTop = headTop + 46;
  const tableH = HEAD_H + L.rows.reduce((s, r) => s + r.h, 0);
  const summaryTop = tableTop + tableH + 22;
  const notesTop = summaryTop + boxRows * (BOX_H + BOX_GAP) + (boxRows ? 8 : 0);
  const H = notesTop + L.notes.length * 28 + 44 + PAD;

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(W * scale); canvas.height = Math.round(H * scale);
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);
  ctx.direction = "rtl"; ctx.textBaseline = "middle";
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);
  const right = W - PAD;

  // العنوان واسم الفندق
  ctx.fillStyle = INK; ctx.textAlign = "right"; ctx.font = font(32, 700);
  ctx.fillText(sheet.title, right, PAD + 20);
  if (sheet.hotelName) { ctx.textAlign = "left"; ctx.font = font(21, 600); ctx.fillStyle = MUTED; ctx.fillText(sheet.hotelName, PAD, PAD + 20); }
  // سطر الترويسة: اليوم / التاريخ / معاد الشيفت / الاسم
  let x = right;
  ctx.textAlign = "right";
  (sheet.head || []).forEach(([label, value]) => {
    ctx.font = font(19); ctx.fillStyle = MUTED;
    const lab = label + ": ";
    ctx.fillText(lab, x, headTop + 12); x -= ctx.measureText(lab).width;
    ctx.font = font(21, 700); ctx.fillStyle = INK;
    const val = String(value ?? "");
    ctx.fillText(val, x, headTop + 12); x -= ctx.measureText(val).width + 34;
  });

  // الجدول
  ctx.fillStyle = HEAD_BG; ctx.fillRect(PAD, tableTop, L.inner, HEAD_H);
  let y = tableTop + HEAD_H;
  L.rows.forEach((r) => { if (r.tone === "section") { ctx.fillStyle = SECTION_BG; ctx.fillRect(PAD, y, L.inner, r.h); } y += r.h; });
  ctx.textAlign = "center";
  let cx = right;
  L.cols.forEach((c) => {
    ctx.font = font(19, 700); ctx.fillStyle = INK;
    ctx.fillText(c.label, cx - c.px / 2, tableTop + HEAD_H / 2, c.px - 8);
    cx -= c.px;
  });
  y = tableTop + HEAD_H;
  L.rows.forEach((r) => {
    cx = right;
    L.cols.forEach((c, i) => {
      const lines = r.cells[i];
      const strong = c.key === "room" || c.key === "due";
      ctx.font = font(CELL, strong ? 700 : 500);
      ctx.fillStyle = c.key === "due" ? (r.tone === "due" ? RUST : SAGE) : INK;
      const top = y + (r.h - lines.length * CELL_LH) / 2 + CELL_LH / 2;
      lines.forEach((l, k) => ctx.fillText(l, cx - c.px / 2, top + k * CELL_LH, c.px - 8));
      cx -= c.px;
    });
    y += r.h;
  });
  ctx.strokeStyle = LINE; ctx.lineWidth = 1.2;
  ctx.strokeRect(PAD, tableTop, L.inner, tableH);
  ctx.beginPath();
  y = tableTop + HEAD_H;
  L.rows.forEach((r) => { ctx.moveTo(PAD, y); ctx.lineTo(right, y); y += r.h; });
  cx = right;
  L.cols.slice(0, -1).forEach((c) => { cx -= c.px; ctx.moveTo(cx, tableTop); ctx.lineTo(cx, tableTop + tableH); });
  ctx.stroke();

  // مربعات الملخص (العهدة / إجمالي التحصيل / ... )
  const boxW = (L.inner - BOX_GAP * (perRow - 1)) / perRow;
  (sheet.summary || []).forEach(([label, value], i) => {
    const bx = right - (i % perRow) * (boxW + BOX_GAP) - boxW, by = summaryTop + Math.floor(i / perRow) * (BOX_H + BOX_GAP);
    ctx.fillStyle = "#FBF9F3"; ctx.fillRect(bx, by, boxW, BOX_H);
    ctx.strokeStyle = "#C9C1AE"; ctx.strokeRect(bx, by, boxW, BOX_H);
    ctx.textAlign = "center";
    ctx.font = font(17); ctx.fillStyle = MUTED; ctx.fillText(label, bx + boxW / 2, by + 24, boxW - 12);
    let size = 24;
    ctx.font = font(size, 700);
    while (size > 15 && ctx.measureText(String(value)).width > boxW - 16) { size -= 1; ctx.font = font(size, 700); }
    ctx.fillStyle = INK; ctx.fillText(String(value), bx + boxW / 2, by + 56, boxW - 12);
  });

  ctx.textAlign = "right"; ctx.font = font(18); ctx.fillStyle = INK;
  L.notes.forEach((n, i) => ctx.fillText(n, right, notesTop + 14 + i * 28));
  ctx.font = font(15); ctx.fillStyle = MUTED; ctx.textAlign = "center";
  ctx.fillText(`صدر من نظام مجموعة H&S للفنادق${stamp ? " · " + stamp : ""}`, W / 2, H - PAD - 4);
  return canvas;
}

export async function sheetToPngFile(sheet, fileName, opts) {
  const canvas = await renderSheetToCanvas(sheet, opts);
  const blob = await new Promise((res) => canvas.toBlob(res, "image/png"));
  if (!blob) throw new Error("تعذر تجهيز صورة التقرير");
  return new File([blob], fileName, { type: "image/png" });
}

export function downloadFile(file) {
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url; a.download = file.name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
