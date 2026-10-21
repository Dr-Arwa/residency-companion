import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  ListChecks, Users, CalendarDays, BookOpen, Settings as SettingsIcon, Plus, Search, Check,
  Phone, ChevronRight, X, Moon, Sun, Trash2, Archive, Pencil, AlertTriangle, Copy, Printer,
  Download, Upload, Camera, Bell, FileText, ArrowLeft, Filter, Home, Image as ImageIcon,
} from "lucide-react";

/* =====================================================================
   Doctor Arwa — Ophthalmology Ward Manager (prototype)
   All patients in the demo data are FICTIONAL.
   ===================================================================== */

/* ---------- small helpers ---------- */
const DB_KEY = "eyecall:db";
const DOC_PREFIX = "eyecall:doc:";
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => ymd(new Date());
const parseD = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseD(s); d.setDate(d.getDate() + n); return ymd(d); };
const diffDays = (a, b) => Math.round((parseD(a) - parseD(b)) / 864e5);
const fmtDate = (s) => (s ? parseD(s).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) : "—");
const fmtDateY = (s) => (s ? parseD(s).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—");
const fmtStamp = (iso) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
const nowISO = () => new Date().toISOString();
const clone = (o) => JSON.parse(JSON.stringify(o));
const capDate = (d, op, off) => (op && d > addDays(op, off) ? addDays(op, off) : d);

const store = {
  async get(k) { try { const r = await window.storage.get(k); return r ? r.value : null; } catch (e) { return null; } },
  async set(k, v) { try { const r = await window.storage.set(k, v); return !!r; } catch (e) { return false; } },
  async del(k) { try { await window.storage.delete(k); } catch (e) { /* ignore */ } },
};

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch (e) {
    try {
      const ta = document.createElement("textarea"); ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select(); const ok = document.execCommand("copy"); ta.remove(); return ok;
    } catch (e2) { return false; }
  }
}

function compressImage(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = reject;
    fr.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const max = 1100; const s = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.round(img.width * s), h = Math.round(img.height * s);
        const c = document.createElement("canvas"); c.width = w; c.height = h;
        c.getContext("2d").drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL("image/jpeg", 0.72));
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}

/* ---------- domain constants ---------- */
const LAB_STATUS = [["not_ordered", "Not ordered"], ["ordered", "Ordered / pending"], ["result", "Result available"], ["reviewed", "Reviewed"], ["na", "Not applicable"]];
const CONSULT_STATUS = [[0, "Not requested"], [1, "Requested"], [2, "Completed"], [3, "Recommendations pending"], [4, "Recommendations reviewed"]];
const OP_STATUS = [["scheduled", "Scheduled"], ["postponed", "Postponed"], ["cancelled", "Cancelled"], ["completed", "Completed"]];
const TASK_CATS = ["Admission", "Consent", "Labs", "Consults", "Call", "Post-op", "Shift", "Study", "Other"];
const PTABS = [["overview", "Overview"], ["checklist", "Pre-op"], ["labs", "Labs"], ["consults", "Consults"], ["op", "Operation"], ["discharge", "Discharge"], ["docs", "Docs"]];
const SECTIONS = [["overdue", "Overdue"], ["today", "Due today"], ["soon", "Due soon"], ["upcoming", "Upcoming"], ["flex", "No due date"]];
const TONE = {
  overdue: { c: "var(--od)", bg: "var(--odbg)" }, today: { c: "var(--td)", bg: "var(--tdbg)" },
  soon: { c: "var(--sn)", bg: "var(--snbg)" }, upcoming: { c: "var(--up)", bg: "var(--upbg)" },
  done: { c: "var(--ok)", bg: "var(--okbg)" }, flex: { c: "var(--up)", bg: "var(--upbg)" },
};
const DEFAULT_SETTINGS = {
  dark: false, autoArchive: true, rulesV2: true, soonDays: 3, callLeadDays: 1, defaultSurgeon: "",
  labs: ["CBC", "INR", "FBS", "Urine analysis", "Serum urea", "Creatinine", "ALT", "AST", "HBsAg", "HCV antibody"],
  diabeticLabs: ["2HPP", "HbA1c"],
  consultRules: [
    { id: "r1", minAge: 0, maxAge: 200, specs: ["ENT"] },
    { id: "r2", minAge: 0, maxAge: 18, specs: ["Pediatrics"] },
    { id: "r3", minAge: 41, maxAge: 200, specs: ["Cardiology"] },
  ],
};

const FIXED = [
  { key: "labsAll", title: "Complete required laboratory investigations", cat: "Labs", tab: "labs", pre: true, umb: "labs", ord: 1 },
  { key: "consReq", title: "Request required consultations", cat: "Consults", tab: "consults", pre: true, umb: "req", ord: 2 },
  { key: "consRev", title: "Review consultation recommendations", cat: "Consults", tab: "consults", pre: true, umb: "rev", ord: 3 },
  { key: "ticket", title: "Write admission clinical sheet (front of ticket)", cat: "Admission", tab: "checklist", afterReview: true, ord: 4 },
  { key: "diagnosis", title: "Document diagnosis and planned operation", cat: "Admission", tab: "overview", needsOp: true, ord: 5 },
  { key: "opdate", title: "Document the operation date and time", cat: "Admission", tab: "op", pre: true, needsOp: true, ord: 6 },
  { key: "instructions", title: "Write medical instructions and medications", cat: "Admission", tab: "checklist", pre: true, needsOp: true, ord: 7 },
  { key: "consent", title: "Complete consent form and required signatures", cat: "Consent", tab: "checklist", pre: true, needsOp: true, crit: true, ord: 8 },
  { key: "predischarge", title: "Write discharge note and discharge admission ticket", cat: "Admission", tab: "discharge", pre: true, needsOp: true, crit: true, ord: 9 },
  { key: "call", title: "Call the patient one day before the operation", cat: "Call", tab: "checklist", pre: true, needsOp: true, crit: true, ord: 10 },
  { key: "opnotes", title: "Document operative details", cat: "Post-op", tab: "op", post: true, ord: 11 },
  { key: "discharge", title: "Complete discharge documentation", cat: "Post-op", tab: "discharge", post: true, ord: 12 },
];

/* ---------- lab / consult helpers ---------- */
const FBS_ALIASES = ["fbs", "fastingglucose", "fastingbloodsugar", "fastingbloodglucose", "fpg", "fastingplasmaglucose"];
const labKey = (n) => { const k = (n || "").toLowerCase().replace(/[^a-z0-9]/g, ""); return FBS_ALIASES.includes(k) ? "fbs" : k; };
const newLab = (name, src) => ({ id: uid(), name, src, status: "not_ordered", orderDate: "", resultDate: "", result: "", reviewedAt: "" });
const newConsult = (spec, src) => ({ id: uid(), spec, src, status: 0, reqDate: "", findings: "", recs: "", actionRequired: false, actionText: "", actionDone: false, actionDoneAt: "" });

function suggestConsults(age, S) {
  const valid = !(age === "" || age === null || age === undefined || isNaN(Number(age)));
  const a = valid ? Number(age) : null; const out = [];
  S.consultRules.forEach((r) => {
    const forAll = Number(r.minAge) <= 0 && Number(r.maxAge) >= 200;
    if ((valid && a >= Number(r.minAge) && a < Number(r.maxAge)) || (!valid && forAll)) r.specs.forEach((s2) => { if (!out.some((x) => x.toLowerCase() === s2.toLowerCase())) out.push(s2); });
  });
  return out;
}
const labsIncluded = (p, S) => { const seen = new Set(); return [...S.labs, ...(p.diabetic ? S.diabeticLabs : [])].filter((n) => { const k = labKey(n); if (seen.has(k)) return false; seen.add(k); return true; }); };
function ensureLabs(p, S) {
  if (!p.labs.some((l) => l.src === "basic")) p.labs.unshift(newLab("Basic labs", "basic"));
}
function migrateLabs(p) {
  const old = p.labs.filter((l) => l.src === "std" || l.src === "diab");
  if (!old.length) return;
  let basic = p.labs.find((l) => l.src === "basic");
  const std = old.filter((l) => l.src === "std");
  if (!basic) {
    basic = newLab("Basic labs", "basic");
    if (std.length) {
      const rank = { not_ordered: 0, ordered: 1, result: 2, reviewed: 3, na: 3 };
      const min = std.reduce((m, l) => Math.min(m, rank[l.status] === undefined ? 0 : rank[l.status]), 3);
      basic.status = ["not_ordered", "ordered", "result", "reviewed"][min];
      const od = std.map((l) => l.orderDate).filter(Boolean).sort(); const rd = std.map((l) => l.resultDate).filter(Boolean).sort();
      basic.orderDate = od[0] || ""; basic.resultDate = rd.length ? rd[rd.length - 1] : "";
      basic.result = std.filter((l) => l.result).map((l) => `${l.name}: ${l.result}`).join("; ");
      if (basic.status === "reviewed") basic.reviewedAt = std.map((l) => l.reviewedAt).filter(Boolean).sort().pop() || nowISO();
    }
  }
  const extra = old.filter((l) => l.src === "diab" && (l.status !== "not_ordered" || l.result)).map((l) => `${l.name}: ${l.result || (LAB_STATUS.find((x) => x[0] === l.status) || [0, l.status])[1]}`);
  if (extra.length) basic.result = [basic.result, ...extra].filter(Boolean).join("; ");
  p.labs = [basic, ...p.labs.filter((l) => l.src !== "std" && l.src !== "diab" && l.src !== "basic")];
}
function ensureConsults(p, S) {
  if (p.consultOverride && p.consultOverride.on) return;
  const sug = suggestConsults(p.age, S);
  sug.forEach((s) => { if (!p.consults.some((c) => c.spec.toLowerCase() === s.toLowerCase())) p.consults.push(newConsult(s, "rule")); });
  p.consults = p.consults.filter((c) => !(c.src === "rule" && c.status === 0 && !c.actionRequired && !sug.some((s) => s.toLowerCase() === c.spec.toLowerCase())));
}
function consultLabel(c) {
  if (c.status >= 4 && c.actionRequired && c.actionDone) return "Required actions completed";
  return (CONSULT_STATUS.find((x) => x[0] === c.status) || [0, "?"])[1];
}

const blankPatient = () => ({
  id: uid(), name: "", reg: "", phones: [""], age: "", sex: "", admitDate: today(), diagnosis: "", plannedOp: "",
  opDate: "", opTime: "", opStatus: "scheduled", chronic: "", diabetic: false, allergies: "", notes: "",
  archived: false, archivedAt: "", autoArchived: false, noAutoArchive: false, listType: "admitted", opSetOn: "", snooze: {}, isDemo: false, tasks: {}, customTasks: [], labs: [], consults: [],
  consultOverride: { on: false, reason: "" }, callDone: null, opHistory: [],
  op: { name: "", date: "", surgeon: "", notes: "", complications: "", postop: "" },
  discharge: { date: "", dx: "", opPerformed: "", hospitalCourse: "", condition: "", medications: "", postop: "", followUp: "" },
  docs: [],
});

function applyDateChange(p, oldDate, reason) {
  if ((p.opDate || "") !== (oldDate || "")) {
    p.opHistory.push({ at: nowISO(), type: "date", from: oldDate || "", to: p.opDate || "", reason: reason || "" });
    p.opSetOn = p.opDate ? today() : "";
    if (p.opDate && p.opStatus === "postponed") p.opStatus = "scheduled";
  }
}

/* ---------- task derivation (the heart of the master checklist) ---------- */
function fixedDue(f, p, S, t) {
  const admit = p.admitDate || t; const op = p.opDate; const setOn = p.opSetOn || admit;
  const lim = (d) => (d < setOn ? setOn : d);
  switch (f.key) {
    case "labsAll": case "consReq": return op ? lim(addDays(op, -3)) : addDays(admit, 1);
    case "consRev": return op ? lim(addDays(op, -2)) : addDays(admit, 2);
    case "ticket": return op ? lim(addDays(op, -2)) : addDays(admit, 3);
    case "diagnosis": case "opdate": return op ? lim(addDays(op, -2)) : t;
    case "instructions": case "consent": case "predischarge": return op ? lim(addDays(op, -1)) : t;
    case "call": return op ? addDays(op, -Number(S.callLeadDays || 1)) : null;
    case "opnotes": return op || t;
    case "discharge": return op ? addDays(op, 1) : t;
    default: return t;
  }
}
const labsComplete = (p) => p.labs.every((l) => l.status === "reviewed" || l.status === "na");
const consReqComplete = (p) => p.consults.every((c) => c.status >= 1);
const consRevComplete = (p) => p.consults.every((c) => c.status >= 4 && (!c.actionRequired || c.actionDone));
const umbComplete = (p, u) => (u === "labs" ? labsComplete(p) : u === "req" ? consReqComplete(p) : consRevComplete(p));

function deriveTasks(p, S, t) {
  if (p.archived) return [];
  const out = []; const st = p.opStatus || "scheduled"; const op = p.opDate || "";
  const sched = st === "scheduled"; const closed = st === "cancelled" || st === "completed";
  const opIn = op ? diffDays(op, t) : null;
  const critical = sched && opIn !== null && opIn >= 0 && opIn <= 1;
  const sn = p.snooze || {};
  const add = (o) => {
    const full = { pid: p.id, pname: p.name, reg: p.reg, opDate: op, opTime: p.opTime, opStatus: st, urgent: false, ord: 50, time: "", ...o };
    if (!full.done && sn[full.id] && (!full.due || sn[full.id] > full.due)) { full.due = sn[full.id]; full.time = ""; full.snoozed = true; }
    out.push(full);
  };
  const addCustom = () => p.customTasks.forEach((c) => add({ id: `${p.id}|custom|${c.id}`, kind: "custom", ref: c.id, title: c.title, cat: c.cat || "Other", tab: "checklist", due: c.due || "", time: c.time || "", done: !!c.done, doneAt: c.doneAt || "", urgent: !!c.urgent && !c.done, focus: `row-cust-${c.id}`, ord: 60 }));
  if (p.listType === "waiting") { addCustom(); return out; }

  FIXED.forEach((f) => {
    if (f.post && st !== "completed") return;
    if (f.pre && closed) return;
    if (f.needsOp && !op) return;
    const due = fixedDue(f, p, S, t);
    if (f.key === "call") {
      if (!sched) return;
      const done = !!p.callDone && p.callDone.forDate === op;
      add({ id: `${p.id}|call`, kind: "call", key: "call", title: "Call patient before operation", cat: "Call", tab: f.tab, due, done, doneAt: done ? p.callDone.doneAt : "", urgent: critical && !done, focus: "row-fix-call", ord: f.ord });
      return;
    }
    const rec = p.tasks[f.key]; const done = !!(rec && rec.done);
    if (f.umb && !done && !umbComplete(p, f.umb)) return;
    if (f.afterReview && !done && !consRevComplete(p)) return;
    add({
      id: `${p.id}|fixed|${f.key}`, kind: "fixed", key: f.key,
      title: f.umb ? "Confirm: " + f.title.charAt(0).toLowerCase() + f.title.slice(1) : f.title,
      cat: f.cat, tab: f.tab, due, done, doneAt: rec ? rec.doneAt || "" : "", urgent: !done && !!f.crit && critical, focus: `row-fix-${f.key}`, ord: f.ord,
    });
  });

  if (st === "postponed") add({ id: `${p.id}|resched`, kind: "resched", title: "Set new operation date (postponed)", cat: "Admission", tab: "op", due: t, done: false, urgent: true, ord: 0 });

  if (!closed) {
    p.labs.forEach((l) => {
      const done = l.status === "reviewed" || l.status === "na";
      let title, due;
      if (l.status === "not_ordered") { title = `Order ${l.name}`; due = capDate(p.admitDate || t, op, -4); }
      else if (l.status === "ordered") { title = `Chase ${l.name} result`; due = capDate(addDays(l.orderDate || t, 1), op, -3); }
      else if (l.status === "result") { title = `Review ${l.name} result`; due = capDate(l.resultDate || t, op, -3); }
      else { title = l.status === "na" ? `${l.name} not applicable` : `${l.name} reviewed`; due = t; }
      add({ id: `${p.id}|lab|${l.id}`, kind: "lab", ref: l.id, title, cat: "Labs", tab: "labs", due, done, doneAt: l.reviewedAt || "", urgent: !done && critical, focus: `row-lab-${l.id}`, ord: 1 });
    });
    p.consults.forEach((c) => {
      const done = c.status >= 4; let title, due;
      if (c.status === 0) { title = `Request ${c.spec} consultation`; due = capDate(addDays(p.admitDate || t, 1), op, -3); }
      else if (c.status === 1) { title = `Chase ${c.spec} consultation`; due = capDate(addDays(c.reqDate || t, 1), op, -2); }
      else if (c.status < 4) { title = `Review ${c.spec} recommendations`; due = capDate(t, op, -2); }
      else { title = `${c.spec} recommendations reviewed`; due = t; }
      add({ id: `${p.id}|con|${c.id}`, kind: "consult", ref: c.id, title, cat: "Consults", tab: "consults", due, done, doneAt: "", urgent: !done && critical, focus: `row-con-${c.id}`, ord: 2 });
      if (c.actionRequired) {
        add({ id: `${p.id}|act|${c.id}`, kind: "action", ref: c.id, title: `${c.spec} action: ${c.actionText || "(describe action)"}`, cat: "Consults", tab: "consults", due: capDate(t, op, -2), done: !!c.actionDone, doneAt: c.actionDoneAt || "", urgent: !c.actionDone && critical, focus: `row-con-${c.id}`, ord: 3 });
      }
    });
  }
  addCustom();
  return out;
}

const nowHM = () => { const d = new Date(); return pad(d.getHours()) + ":" + pad(d.getMinutes()); };
const secOf = (due, t, soon, time) => {
  if (!due) return "flex";
  const d = diffDays(due, t);
  if (d === 0 && time && time < nowHM()) return "overdue";
  return d < 0 ? "overdue" : d === 0 ? "today" : d <= soon ? "soon" : "upcoming";
};
const deriveCache = new WeakMap();
function cachedDerive(p, S, t) {
  const e = deriveCache.get(p);
  if (e && e.S === S && e.t === t) return e.v;
  const v = deriveTasks(p, S, t); deriveCache.set(p, { S, t, v }); return v;
}
const deriveGeneral = (g) => ({ id: `g|${g.id}`, pid: null, pname: "General task", reg: "", kind: "general", ref: g.id, title: g.title, cat: g.cat || "Other", tab: null, due: g.due || "", time: g.time || "", done: !!g.done, doneAt: g.doneAt || "", urgent: !!g.urgent && !g.done, opDate: "", opStatus: "", ord: 60 });
const taskSort = (a, b) => (b.urgent - a.urgent) || ((a.due || "9999") + (a.time || "99:99")).localeCompare((b.due || "9999") + (b.time || "99:99")) || ((a.ord || 50) - (b.ord || 50)) || a.pname.localeCompare(b.pname);
const doneToday = (k, t) => !!(k.doneAt && ymd(new Date(k.doneAt)) === t);
function autoArchiveOne(p, S) {
  if (S.autoArchive && !p.archived && !p.noAutoArchive && p.opStatus === "completed" && p.tasks.opnotes && p.tasks.opnotes.done && p.tasks.discharge && p.tasks.discharge.done) {
    p.archived = true; p.archivedAt = nowISO(); p.autoArchived = true;
  }
}
function handoverText(patients, tasks, S, t) {
  const act = patients.filter((p) => !p.archived).sort((a, b) => (a.opDate || "9999").localeCompare(b.opDate || "9999"));
  const lines = [`WARD HANDOVER — ${fmtDateY(t)}`, ""];
  act.forEach((p, i) => {
    const open = tasks.filter((k) => k.pid === p.id && !k.done).sort(taskSort);
    lines.push(`${i + 1}. ${p.name} (${p.reg}) ${p.age}${p.sex}${p.diabetic ? " DM" : ""}${p.listType === "waiting" ? " [WAITING LIST]" : ""}`);
    if (p.diagnosis) lines.push(`   Dx: ${p.diagnosis}`);
    lines.push(`   Op: ${p.plannedOp || "—"}${p.opDate ? ` — ${fmtDate(p.opDate)} ${p.opTime || ""} [${p.opStatus}]` : ""}`);
    if (p.allergies) lines.push(`   Allergies: ${p.allergies}`);
    lines.push(open.length ? `   To do: ${open.map((k) => k.title + (secOf(k.due, t, S.soonDays, k.time) === "overdue" ? " (OVERDUE)" : "")).join("; ")}` : "   To do: nothing outstanding");
  });
  const gen = tasks.filter((k) => !k.pid && !k.done);
  if (gen.length) { lines.push("", "General tasks:"); gen.forEach((k) => lines.push(`- ${k.title}${k.due ? ` (${fmtDate(k.due)}${k.time ? " " + k.time : ""})` : ""}`)); }
  return lines.join("\n");
}
const makeDemoGeneral = () => [
  { id: uid(), isDemo: true, title: "Study: ophthalmic anatomy chapter (sample)", due: "", time: "", cat: "Study", urgent: false, done: false, doneAt: "" },
  { id: uid(), isDemo: true, title: "Shift: check ward supplies (sample)", due: "", time: "", cat: "Shift", urgent: false, done: false, doneAt: "" },
];

function dueLabel(due, t, time) {
  if (!due) return "No due date";
  const d = diffDays(due, t);
  if (d < 0) return `Overdue by ${-d} day${d === -1 ? "" : "s"}`;
  if (d === 0) return time ? (time < nowHM() ? `Overdue since ${time}` : `Due today ${time}`) : "Due today";
  if (d === 1) return time ? `Due tomorrow ${time}` : "Due tomorrow";
  return `Due ${fmtDate(due)}${time ? " " + time : ""}`;
}
function callInfo(p, S, t) {
  const op = p.opDate; const st = p.opStatus;
  if (!op) return { text: "No operation date — no reminder yet", tone: "upcoming", date: "" };
  if (st === "cancelled") return { text: "Operation cancelled — reminder closed", tone: "upcoming", date: "" };
  if (st === "completed") return { text: "Operation completed — reminder closed", tone: "upcoming", date: "" };
  if (st === "postponed") return { text: "Postponed — reminder paused until new date", tone: "today", date: "" };
  const date = addDays(op, -Number(S.callLeadDays || 1));
  if (p.callDone && p.callDone.forDate === op) return { text: `Call done ${fmtStamp(p.callDone.doneAt)}`, tone: "done", date };
  const d = diffDays(date, t);
  if (d < 0) return { text: `Call overdue by ${-d} day${d === -1 ? "" : "s"} (was ${fmtDate(date)})`, tone: "overdue", date };
  if (d === 0) return { text: "Call due today", tone: "today", date };
  return { text: `Call reminder on ${fmtDate(date)}`, tone: "soon", date };
}

/* ---------- seed data (ALL FICTIONAL) ---------- */
const SEED_TEMPLATES = [
  { id: "tp1", kind: "operative", opType: "Phacoemulsification + IOL", title: "Phaco + IOL skeleton", notes: "Anesthesia: \nIncision / technique: \nIOL (type / power): \nClosure: ", complications: "", postop: "[Per surgeon / unit protocol]" },
  { id: "tp2", kind: "operative", opType: "Pterygium excision", title: "Pterygium excision skeleton", notes: "Anesthesia: \nTechnique: \nGraft / adjuncts: \nClosure: ", complications: "", postop: "[Per surgeon / unit protocol]" },
  { id: "tp3", kind: "operative", opType: "Strabismus surgery", title: "Strabismus surgery skeleton", notes: "Anesthesia: \nMuscles operated: \nTechnique: \nClosure: ", complications: "", postop: "[Per surgeon / unit protocol]" },
  { id: "tp4", kind: "operative", opType: "Vitrectomy", title: "Vitrectomy skeleton", notes: "Anesthesia: \nPorts / technique: \nSteps performed: \nTamponade: \nClosure: ", complications: "", postop: "[Per surgeon / unit protocol]" },
  { id: "tp5", kind: "discharge", opType: "General", title: "General discharge skeleton", hospitalCourse: "Admitted for: \nOperation: \nPostoperative course: ", condition: "", medications: "[Enter per treating team]", postop: "[Enter per surgeon / unit protocol]", followUp: "Review at: " },
];

function makeDemo(S) {
  const t = today(); const ts = (daysAgo) => new Date(Date.now() - daysAgo * 864e5).toISOString();
  const mk = (o) => { const p = { ...blankPatient(), ...o, id: uid(), isDemo: true }; ensureLabs(p, S); ensureConsults(p, S); if (p.opDate) p.opSetOn = p.admitDate; return p; };
  const lab = (p, name, status, od, rd, res) => { const l = p.labs.find((x) => x.name === name); if (!l) return; l.status = status; l.orderDate = od || ""; l.resultDate = rd || ""; l.result = res || ""; if (status === "reviewed") l.reviewedAt = ts(0.5); };
  const done = (p, key, d) => { p.tasks[key] = { done: true, doneAt: ts(d), notes: "" }; };

  const a = mk({ name: "Layla Testwell (DEMO)", reg: "DEMO-1001", phones: ["0100 000 0001"], age: 27, sex: "F", admitDate: addDays(t, -1), diagnosis: "Exotropia (sample)", plannedOp: "Strabismus surgery (sample)", opDate: addDays(t, 5), opTime: "09:00", chronic: "None", allergies: "None known (sample)", notes: "Fictional sample: under 40, non-diabetic." });
  done(a, "ticket", 1); lab(a, "Basic labs", "ordered", addDays(t, -1), "", "");

  const b = mk({ name: "Omar Sampleton (DEMO)", reg: "DEMO-1002", phones: ["0100 000 0002", "0100 000 0102"], age: 58, sex: "M", admitDate: addDays(t, -2), diagnosis: "Cataract, right eye (sample)", plannedOp: "Phaco + IOL (sample)", opDate: addDays(t, 3), opTime: "10:30", chronic: "Hypertension (sample)", allergies: "Penicillin (sample)", notes: "Fictional sample: aged 40+, non-diabetic." });
  done(b, "ticket", 2); done(b, "diagnosis", 2); done(b, "opdate", 2);
  lab(b, "Basic labs", "result", addDays(t, -2), addDays(t, -1), "Sample value");
  b.consults.find((c) => c.spec === "ENT").status = 1; b.consults.find((c) => c.spec === "ENT").reqDate = addDays(t, -2);
  const bc = b.consults.find((c) => c.spec === "Cardiology"); bc.status = 3; bc.reqDate = addDays(t, -2); bc.findings = "Sample finding text."; bc.recs = "Sample recommendation text (fictional).";

  const c = mk({ name: "Fatma Exampleh (DEMO)", reg: "DEMO-1003", phones: ["0100 000 0003"], age: 63, sex: "F", admitDate: addDays(t, -3), diagnosis: "Vitreous hemorrhage, diabetic (sample)", plannedOp: "Vitrectomy (sample)", opDate: addDays(t, 4), opTime: "08:30", chronic: "Type 2 diabetes (sample)", diabetic: true, allergies: "None known (sample)", notes: "Fictional sample: diabetic, adds 2HPP and HbA1c." });
  ensureLabs(c, S); done(c, "ticket", 3); done(c, "diagnosis", 3); done(c, "opdate", 3); done(c, "instructions", 1);
  lab(c, "Basic labs", "ordered", addDays(t, -2), "", "");
  const cc = c.consults.find((x) => x.spec === "Cardiology"); cc.status = 4; cc.reqDate = addDays(t, -3); cc.recs = "Sample recommendation (fictional)."; cc.actionRequired = true; cc.actionText = "Sample follow-up action as advised by cardiology";
  const ce = c.consults.find((x) => x.spec === "ENT"); ce.status = 4; ce.reqDate = addDays(t, -3); ce.recs = "Sample ENT note (fictional).";

  const d = mk({ name: "Karim Demoud (DEMO)", reg: "DEMO-1004", phones: ["0100 000 0004"], age: 45, sex: "M", admitDate: addDays(t, -2), diagnosis: "Pterygium, left eye (sample)", plannedOp: "Pterygium excision (sample)", opDate: addDays(t, 1), opTime: "11:00", chronic: "None", allergies: "None known (sample)", notes: "Fictional sample: operation tomorrow, so the call reminder is due today." });
  ["ticket", "diagnosis", "opdate", "instructions"].forEach((k) => done(d, k, 2));
  lab(d, "Basic labs", "reviewed", addDays(t, -2), addDays(t, -1), "Sample");
  d.consults.forEach((x) => { x.status = 4; x.reqDate = addDays(t, -2); x.recs = "Sample note (fictional)."; });
  d.customTasks.push({ id: uid(), title: "Arrange post-op bed (sample task)", due: addDays(t, 1), cat: "Other", urgent: false, done: false, doneAt: "" });
  return [a, b, c, d];
}

function normalizePatient(raw) {
  const b = blankPatient();
  const p = { ...b, ...raw };
  p.op = { ...b.op, ...(raw.op || {}) }; p.discharge = { ...b.discharge, ...(raw.discharge || {}) };
  p.consultOverride = { ...b.consultOverride, ...(raw.consultOverride || {}) };
  ["labs", "consults", "customTasks", "opHistory", "docs"].forEach((k) => { if (!Array.isArray(p[k])) p[k] = []; });
  if (!Array.isArray(p.phones) || !p.phones.length) p.phones = [""];
  if (!p.tasks || typeof p.tasks !== "object") p.tasks = {};
  if (!p.snooze || typeof p.snooze !== "object") p.snooze = {};
  if (!p.listType) p.listType = "admitted";
  migrateLabs(p);
  return p;
}
function normalizeDb(raw) {
  const settings = { ...DEFAULT_SETTINGS, ...(raw.settings || {}) };
  if (!(raw.settings && raw.settings.rulesV2)) { settings.consultRules = clone(DEFAULT_SETTINGS.consultRules); settings.rulesV2 = true; }
  return {
    settings,
    patients: (raw.patients || []).map(normalizePatient),
    templates: Array.isArray(raw.templates) ? raw.templates : clone(SEED_TEMPLATES),
    generalTasks: Array.isArray(raw.generalTasks) ? raw.generalTasks : [],
    pins: Array.isArray(raw.pins) ? raw.pins : [],
    notes: Array.isArray(raw.notes) ? raw.notes : [],
  };
}
function validateBackup(obj) {
  const errors = [];
  if (!obj || typeof obj !== "object") return { ok: false, errors: ["File is not a JSON object."] };
  if (obj.app !== "DoctorArwa" && obj.app !== "EyeCall") errors.push("This is not a Doctor Arwa backup (missing app marker).");
  if (typeof obj.schema !== "number") errors.push("Missing schema version.");
  else if (obj.schema > 2) errors.push("Backup is from a newer version of Doctor Arwa.");
  if (!Array.isArray(obj.patients)) errors.push("Missing patients list.");
  else obj.patients.forEach((p, i) => {
    if (!p || typeof p.id !== "string" || typeof p.name !== "string" || typeof p.reg !== "string") errors.push(`Patient #${i + 1} is missing id, name or registration number.`);
    ["labs", "consults"].forEach((k) => { if (p && p[k] !== undefined && !Array.isArray(p[k])) errors.push(`Patient #${i + 1}: "${k}" is invalid.`); });
  });
  if (obj.templates !== undefined && !Array.isArray(obj.templates)) errors.push("Templates list is invalid.");
  if (errors.length) return { ok: false, errors };
  const db = normalizeDb(obj);
  const docs = Array.isArray(obj.documents) ? obj.documents.filter((d) => d && typeof d.id === "string" && typeof d.dataUrl === "string") : [];
  if (!obj.includesDocuments) { db.patients.forEach((p) => { p.docs = []; }); db.notes.forEach((n) => { n.imgs = []; }); }
  return { ok: true, errors: [], db, docs };
}

function dischargeText(p) {
  const d = p.discharge; const L = (k, v) => `${k}: ${v || ""}`;
  return [
    "DISCHARGE NOTE", "", L("Patient", p.name), L("Registration no.", p.reg),
    L("Age / Sex", [p.age, p.sex].filter((x) => x !== "" && x !== undefined).join(" / ")), L("Date", d.date), "",
    L("Diagnosis", d.dx), L("Operation performed", d.opPerformed), "",
    "Hospital course:", d.hospitalCourse || "", "", "Condition at discharge:", d.condition || "", "",
    "Medications:", d.medications || "", "", "Postoperative instructions:", d.postop || "", "", "Follow-up plan:", d.followUp || "",
  ].join("\n");
}

async function demoNotify(msg) {
  try {
    if (typeof Notification === "undefined") throw new Error("unsupported");
    let perm = Notification.permission;
    if (perm === "default") perm = await Notification.requestPermission();
    if (perm !== "granted") throw new Error("denied");
    if (navigator.serviceWorker) { const reg = await navigator.serviceWorker.ready; await reg.showNotification("Doctor Arwa reminder", { body: msg, icon: "icon-192.png" }); }
    else new Notification("Doctor Arwa reminder", { body: msg });
    return "sent";
  } catch (e) { return "fallback"; }
}

/* ---------- CSS ---------- */
const CSS = `
.ec{--bg:#EBF1F0;--sf:#FFFFFF;--sf2:#F3F7F6;--ink:#10302E;--mut:#587270;--ln:#D2DEDC;--pri:#0D6B66;--onpri:#fff;
--od:#B8312A;--odbg:#FCE9E7;--td:#9A5700;--tdbg:#FFF1D8;--sn:#1B67A6;--snbg:#E4EFF9;--up:#566B76;--upbg:#E9EEF1;--ok:#2B7A4B;--okbg:#E2F2E9;
font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:var(--bg);color:var(--ink);min-height:100vh;-webkit-tap-highlight-color:transparent}
.ec.dk{--bg:#0B1514;--sf:#132421;--sf2:#183029;--ink:#E3F0EE;--mut:#8FAAA6;--ln:#26443F;--pri:#3DBDB2;--onpri:#06201D;
--od:#FF8A80;--odbg:#3A1B1A;--td:#FFC266;--tdbg:#37290F;--sn:#7CC0F5;--snbg:#14293B;--up:#9FB4BF;--upbg:#1D2B32;--ok:#6FD39B;--okbg:#14301F}
.ec *{box-sizing:border-box}
.ec-in{width:100%;border:1.5px solid var(--ln);background:var(--sf);color:var(--ink);border-radius:10px;padding:10px 12px;font-size:16px;min-height:46px;font-family:inherit}
.ec-in:focus{outline:2px solid var(--pri);outline-offset:1px}
textarea.ec-in{min-height:84px;resize:vertical;line-height:1.4}
.ec-btn{min-height:46px;padding:0 16px;border-radius:12px;font-weight:650;font-size:15px;display:inline-flex;align-items:center;justify-content:center;gap:8px;border:1.5px solid var(--ln);background:var(--sf);color:var(--ink);cursor:pointer;font-family:inherit}
.ec-btn:focus-visible,.ec-chk:focus-visible,.ec-chip:focus-visible{outline:2px solid var(--pri);outline-offset:2px}
.ec-btn.pri{background:var(--pri);border-color:var(--pri);color:var(--onpri)}
.ec-btn.dgr{color:var(--od);border-color:var(--od)}
.ec-btn.sm{min-height:38px;padding:0 12px;font-size:14px;border-radius:10px}
.ec-btn[disabled]{opacity:.5}
.ec-card{background:var(--sf);border:1px solid var(--ln);border-radius:14px;padding:14px}
.ec-chk{width:46px;height:46px;flex:none;border-radius:999px;border:2.5px solid var(--ln);background:var(--sf);display:flex;align-items:center;justify-content:center;color:#fff;cursor:pointer}
.ec-chk.on{background:var(--ok);border-color:var(--ok)}
.ec-badge{display:inline-flex;align-items:center;gap:4px;font-size:12px;font-weight:700;padding:3px 8px;border-radius:999px;white-space:nowrap}
.ec-chip{border:1.5px solid var(--ln);background:var(--sf);color:var(--ink);border-radius:999px;padding:0 14px;min-height:40px;font-weight:650;font-size:14px;white-space:nowrap;cursor:pointer;font-family:inherit;display:inline-flex;align-items:center;gap:6px}
.ec-chip.on{background:var(--pri);color:var(--onpri);border-color:var(--pri)}
.ec-lbl{display:block;font-size:13px;font-weight:650;color:var(--mut);margin:0 0 4px}
.ec-mut{color:var(--mut)}
.ec-scroll{display:flex;gap:8px;overflow-x:auto;padding-bottom:4px;-webkit-overflow-scrolling:touch}
.ec-scroll::-webkit-scrollbar{display:none}
.ec-nav{position:fixed;bottom:0;left:50%;transform:translateX(-50%);width:100%;max-width:520px;background:var(--sf);border-top:1px solid var(--ln);display:flex;z-index:30;padding-bottom:env(safe-area-inset-bottom)}
.ec-nav button{flex:1;min-height:60px;background:none;border:0;color:var(--mut);font-size:10.5px;font-weight:650;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;cursor:pointer;font-family:inherit}
.ec-nav button.on{color:var(--pri)}
.ec-head{position:sticky;top:0;z-index:20;background:var(--pri);color:var(--onpri);padding:10px 14px}
.ec-sheet{position:fixed;inset:0;z-index:50;background:rgba(0,0,0,.5);display:flex;align-items:flex-end;justify-content:center}
.ec-sheet>div{background:var(--bg);color:var(--ink);width:100%;max-width:520px;max-height:94vh;overflow:auto;border-radius:18px 18px 0 0;padding:14px 14px 28px}
.ec-warn{background:var(--tdbg);color:var(--td);border-radius:10px;padding:10px 12px;font-size:13.5px;line-height:1.4}
.ec-err{color:var(--od);font-size:13px;margin-top:3px}
.ec-fab{position:fixed;right:max(16px,calc(50% - 244px));bottom:76px;width:58px;height:58px;border-radius:999px;background:var(--pri);color:var(--onpri);border:0;display:flex;align-items:center;justify-content:center;z-index:25;box-shadow:0 4px 14px rgba(0,0,0,.3);cursor:pointer}
.ec-toast{position:fixed;left:50%;transform:translateX(-50%);bottom:76px;z-index:60;background:#10302E;color:#fff;border-radius:12px;padding:10px 14px;display:flex;gap:12px;align-items:center;max-width:92%;font-size:14px;box-shadow:0 4px 14px rgba(0,0,0,.35)}
.ec-toast button{background:none;border:0;color:#7FE3D8;font-weight:700;font-size:14px;cursor:pointer}
.ec-dot{width:10px;height:10px;border-radius:99px;display:inline-block}
@media print{body *{visibility:hidden!important}.ec-print,.ec-print *{visibility:visible!important}.ec-print{position:absolute;left:0;top:0;width:100%;background:#fff!important;color:#000!important;padding:16px}}
`;

/* =====================================================================
   Small UI primitives (defined at module level so inputs never lose focus)
   ===================================================================== */
const Field = ({ label, children, err }) => (
  <div style={{ marginBottom: 12 }}>
    {label && <label className="ec-lbl">{label}</label>}
    {children}
    {err && <div className="ec-err">{err}</div>}
  </div>
);
const Badge = ({ tone, children }) => <span className="ec-badge" style={{ color: TONE[tone].c, background: TONE[tone].bg }}>{children}</span>;
const Sheet = ({ title, onClose, lock, children }) => (
  <div className="ec-sheet" onClick={lock ? undefined : onClose}>
    <div onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between" style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 18, fontWeight: 750 }}>{title}</div>
        <button className="ec-btn sm" onClick={onClose} aria-label="Close"><X size={18} /></button>
      </div>
      {children}
    </div>
  </div>
);
const Section = ({ title, right, children }) => (
  <div style={{ marginTop: 16 }}>
    <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 15, fontWeight: 750 }}>{title}</div>{right}
    </div>
    {children}
  </div>
);
const Empty = ({ children }) => <div className="ec-card ec-mut" style={{ textAlign: "center", padding: 22, fontSize: 14.5 }}>{children}</div>;

/* =====================================================================
   Task card (used by master list and patient overview)
   ===================================================================== */
function TaskCard({ k, t, S, onToggle, onOpen, compact, pinned, onPin, onDelay }) {
  const sec = k.done ? "done" : secOf(k.due, t, S.soonDays, k.time);
  const tone = TONE[sec];
  const chipStyle = { minHeight: 34, fontSize: 13, padding: "0 10px" };
  return (
    <div className="ec-card flex items-start gap-3" style={{ borderLeft: `6px solid ${tone.c}`, padding: "11px 12px 11px 10px", opacity: k.done ? 0.75 : 1 }}>
      <button className={`ec-chk ${k.done ? "on" : ""}`} aria-label={k.done ? "Re-open task" : "Mark task complete"} onClick={() => onToggle(k)}>
        {k.done && <Check size={24} />}
      </button>
      <div className="flex-1" style={{ minWidth: 0 }}>
        <div style={{ cursor: "pointer" }} onClick={() => onOpen(k)}>
          <div style={{ fontWeight: 700, fontSize: 15.5, lineHeight: 1.3, textDecoration: k.done ? "line-through" : "none" }}>{k.title}</div>
          {!compact && <div style={{ fontSize: 13.5, marginTop: 2 }}><b>{k.pname}</b> {k.reg && <span className="ec-mut">· {k.reg}</span>}</div>}
          <div className="flex flex-wrap gap-1" style={{ marginTop: 6 }}>
            {k.done ? <Badge tone="done">Done {fmtStamp(k.doneAt)}</Badge> : <Badge tone={sec}>{dueLabel(k.due, t, k.time)}</Badge>}
            {k.urgent && <span className="ec-badge" style={{ background: "var(--od)", color: "var(--bg)" }}>URGENT</span>}
            {!compact && k.opDate && k.opStatus !== "completed" && <Badge tone="upcoming">Op {fmtDate(k.opDate)}{k.opTime ? " " + k.opTime : ""}</Badge>}
            <Badge tone="upcoming">{k.cat}</Badge>
          </div>
        </div>
        {!k.done && (onPin || onDelay) && (
          <div className="flex gap-2" style={{ marginTop: 8 }}>
            {onPin && <button className={`ec-chip ${pinned ? "on" : ""}`} style={chipStyle} onClick={(e) => { e.stopPropagation(); onPin(k); }}>{pinned ? "★ In today's list" : "☆ Add to today"}</button>}
            {onDelay && <button className="ec-chip" style={chipStyle} onClick={(e) => { e.stopPropagation(); onDelay(k); }}>Tomorrow →</button>}
          </div>
        )}
      </div>
      <ChevronRight size={20} className="ec-mut" style={{ marginTop: 12, flex: "none", cursor: "pointer" }} onClick={() => onOpen(k)} />
    </div>
  );
}

/* =====================================================================
   Dashboard / Master checklist
   ===================================================================== */
function Dashboard({ tasks, patients, t, S, flt, setFlt, onToggle, onOpen, onNotify, openAdd, onHandover, pins, onPin, onDelay }) {
  const active = patients.filter((p) => !p.archived);
  const open = tasks.filter((k) => !k.done);
  const counts = { overdue: 0, today: 0, soon: 0, upcoming: 0, flex: 0 };
  open.forEach((k) => { counts[secOf(k.due, t, S.soonDays, k.time)]++; });
  const urgentCount = open.filter((k) => k.urgent).length;
  const perPatient = {};
  open.forEach((k) => { const o = perPatient[k.pid] || (perPatient[k.pid] = { n: 0, od: 0 }); o.n++; if (secOf(k.due, t, S.soonDays, k.time) === "overdue") o.od++; });

  const filtered = tasks.filter((k) => {
    if (!flt.done && k.done) return false;
    if (flt.pid !== "all" && k.pid !== flt.pid) return false;
    if (flt.cat !== "all" && k.cat !== flt.cat) return false;
    if (flt.by && (!k.due || k.due > flt.by)) return false;
    const sec = k.done ? "done" : secOf(k.due, t, S.soonDays, k.time);
    if (flt.sec === "urgent" && !k.urgent) return false;
    if (["overdue", "today", "soon", "upcoming", "flex"].includes(flt.sec) && sec !== flt.sec) return false;
    if (flt.q) { const q = flt.q.toLowerCase(); if (!(`${k.pname} ${k.reg} ${k.title}`.toLowerCase().includes(q))) return false; }
    return true;
  });
  const rank = { overdue: 0, today: 1, soon: 2, upcoming: 3 };
  const sorter = taskSort;
  const groups = SECTIONS.map(([key, label]) => [key, label, filtered.filter((k) => !k.done && secOf(k.due, t, S.soonDays, k.time) === key).sort(sorter)]);
  const doneList = filtered.filter((k) => k.done).sort((a, b) => (b.doneAt || "").localeCompare(a.doneAt || ""));
  const calls = tasks.filter((k) => k.kind === "call" && !k.done && ["overdue", "today"].includes(secOf(k.due, t, S.soonDays, k.time)));
  const set = (o) => setFlt({ ...flt, ...o });
  const filtersOn = flt.cat !== "all" || flt.pid !== "all" || flt.by || flt.done || flt.sec !== "all";

  return (
    <div style={{ padding: 14 }}>
      <div className="flex gap-2" style={{ marginBottom: 12 }}>
        {[["overdue", "Overdue", counts.overdue], ["today", "Today", counts.today], ["soon", "Soon", counts.soon], ["urgent", "Urgent", urgentCount]].map(([key, label, n]) => {
          const tn = TONE[key === "urgent" ? "overdue" : key];
          return (
            <button key={key} onClick={() => set({ sec: flt.sec === key ? "all" : key })} className="flex-1"
              style={{ background: tn.bg, color: tn.c, border: flt.sec === key ? `2.5px solid ${tn.c}` : "2.5px solid transparent", borderRadius: 14, padding: "8px 4px", cursor: "pointer", fontFamily: "inherit" }}>
              <div style={{ fontSize: 26, fontWeight: 800, lineHeight: 1 }}>{n}</div>
              <div style={{ fontSize: 12, fontWeight: 700, marginTop: 3 }}>{label}</div>
            </button>
          );
        })}
      </div>

      {calls.length > 0 && (
        <div className="ec-card" style={{ borderColor: "var(--td)", marginBottom: 12 }}>
          <div className="flex items-center justify-between" style={{ marginBottom: 6 }}>
            <div style={{ fontWeight: 750, color: "var(--td)" }}>Calls to make now ({calls.length})</div>
            <button className="ec-btn sm" onClick={() => onNotify(calls)}><Bell size={16} /> Test alert</button>
          </div>
          {calls.map((k) => {
            const p = patients.find((x) => x.id === k.pid); const ph = p && p.phones.find((x) => x.trim());
            return (
              <div key={k.id} className="flex items-center justify-between gap-2" style={{ padding: "6px 0", borderTop: "1px solid var(--ln)" }}>
                <div style={{ minWidth: 0 }}><b>{k.pname}</b><div className="ec-mut" style={{ fontSize: 13 }}>Op {fmtDate(k.opDate)} · {dueLabel(k.due, t, k.time)}</div></div>
                {ph && <a className="ec-btn sm pri" href={`tel:${ph.replace(/\s/g, "")}`}><Phone size={16} /> Call</a>}
              </div>
            );
          })}
        </div>
      )}

      <div className="flex gap-2" style={{ marginBottom: 10 }}>
        <div style={{ position: "relative", flex: 1 }}>
          <Search size={18} className="ec-mut" style={{ position: "absolute", left: 12, top: 14 }} />
          <input className="ec-in" style={{ paddingLeft: 38 }} placeholder="Search patient, reg. no. or task" value={flt.q} onChange={(e) => set({ q: e.target.value })} />
        </div>
        <button className={`ec-chip ${flt.open || filtersOn ? "on" : ""}`} onClick={() => set({ open: !flt.open })} aria-label="Filters"><Filter size={16} /> Filters</button>
      </div>

      {flt.open && (
        <div className="ec-card" style={{ marginBottom: 10 }}>
          <Field label="Patient">
            <select className="ec-in" value={flt.pid} onChange={(e) => set({ pid: e.target.value })}>
              <option value="all">All patients</option>
              {active.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="Task category">
            <select className="ec-in" value={flt.cat} onChange={(e) => set({ cat: e.target.value })}>
              <option value="all">All categories</option>
              {TASK_CATS.map((c) => <option key={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Due on or before">
            <input type="date" className="ec-in" value={flt.by} onChange={(e) => set({ by: e.target.value })} />
          </Field>
          <label className="flex items-center gap-2" style={{ minHeight: 44, fontWeight: 600 }}>
            <input type="checkbox" style={{ width: 22, height: 22 }} checked={flt.done} onChange={(e) => set({ done: e.target.checked })} /> Show completed tasks
          </label>
          <button className="ec-btn sm" onClick={() => setFlt({ q: "", sec: "all", cat: "all", pid: "all", by: "", done: false, open: true })}>Clear filters</button>
        </div>
      )}

      <div className="ec-scroll" style={{ marginBottom: 8 }}>
        <button className="ec-chip" onClick={onHandover}><FileText size={16} /> Handover</button>
        {active.filter((p) => perPatient[p.id]).sort((a, b) => (perPatient[b.id].od - perPatient[a.id].od) || (perPatient[b.id].n - perPatient[a.id].n)).map((p) => (
          <button key={p.id} className={`ec-chip ${flt.pid === p.id ? "on" : ""}`} onClick={() => set({ pid: flt.pid === p.id ? "all" : p.id })}>
            {perPatient[p.id].od > 0 && <span className="ec-dot" style={{ background: "var(--od)" }} />}
            {p.name.split(" (")[0]} · {perPatient[p.id].n}
          </button>
        ))}
      </div>

      {active.length === 0 && <Empty>No patients yet. <button className="ec-btn sm pri" style={{ marginLeft: 6 }} onClick={openAdd}>Add patient</button></Empty>}
      {active.length > 0 && filtered.length === 0 && <Empty>Nothing outstanding for these filters.</Empty>}

      {groups.map(([key, label, list]) => list.length > 0 && (
        <div key={key} style={{ marginTop: 14 }}>
          <div className="flex items-center gap-2" style={{ marginBottom: 8 }}>
            <span className="ec-dot" style={{ background: TONE[key].c }} />
            <div style={{ fontWeight: 800, fontSize: 16, color: TONE[key].c }}>{label}</div>
            <div className="ec-mut" style={{ fontWeight: 700 }}>{list.length}</div>
          </div>
          <div className="flex flex-col gap-2">{list.map((k) => <TaskCard key={k.id} k={k} t={t} S={S} onToggle={onToggle} onOpen={onOpen} pinned={pins.includes(k.id)} onPin={onPin} onDelay={onDelay} />)}</div>
        </div>
      ))}
      {flt.done && doneList.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div style={{ fontWeight: 800, fontSize: 16, color: "var(--ok)", marginBottom: 8 }}>Completed ({doneList.length})</div>
          <div className="flex flex-col gap-2">{doneList.map((k) => <TaskCard key={k.id} k={k} t={t} S={S} onToggle={onToggle} onOpen={onOpen} pinned={pins.includes(k.id)} onPin={onPin} onDelay={onDelay} />)}</div>
        </div>
      )}
      <div className="ec-mut" style={{ fontSize: 12, marginTop: 22, textAlign: "center" }}>Prototype · demo patients are fictional · not for real patient data</div>
    </div>
  );
}

/* =====================================================================
   Patients list + form
   ===================================================================== */
function PatientsScreen({ patients, tasksBy, t, S, onOpen, openAdd }) {
  const [q, setQ] = useState(""); const [view, setView] = useState("admitted"); const arch = view === "archived";
  const list = patients.filter((p) => (view === "archived" ? !!p.archived : !p.archived && (p.listType || "admitted") === view)).filter((p) => {
    if (!q) return true; const s = q.toLowerCase();
    return `${p.name} ${p.reg} ${p.phones.join(" ")} ${p.diagnosis}`.toLowerCase().includes(s);
  }).sort((a, b) => (a.opDate || "9999").localeCompare(b.opDate || "9999"));
  return (
    <div style={{ padding: 14 }}>
      <div className="flex gap-2" style={{ marginBottom: 10 }}>
        <div style={{ position: "relative", flex: 1 }}>
          <Search size={18} className="ec-mut" style={{ position: "absolute", left: 12, top: 14 }} />
          <input className="ec-in" style={{ paddingLeft: 38 }} placeholder="Search name, reg. no., phone" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <button className="ec-btn pri" onClick={openAdd}><Plus size={18} /> Add</button>
      </div>
      <div className="flex gap-2" style={{ marginBottom: 10 }}>
        <button className={`ec-chip ${view === "admitted" ? "on" : ""}`} onClick={() => setView("admitted")}>Admitted</button>
        <button className={`ec-chip ${view === "waiting" ? "on" : ""}`} onClick={() => setView("waiting")}>Waiting list</button>
        <button className={`ec-chip ${view === "archived" ? "on" : ""}`} onClick={() => setView("archived")}>Archived</button>
      </div>
      {list.length === 0 && <Empty>{arch ? "No archived patients." : "No patients found."}</Empty>}
      <div className="flex flex-col gap-2">
        {list.map((p) => {
          const tk = tasksBy[p.id] || { n: 0, od: 0 };
          return (
            <div key={p.id} className="ec-card" style={{ cursor: "pointer" }} onClick={() => onOpen(p.id)}>
              <div className="flex items-start justify-between gap-2">
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 750, fontSize: 16.5 }}>{p.name}</div>
                  <div className="ec-mut" style={{ fontSize: 13.5 }}>{p.reg} · {p.age !== "" ? p.age + " y" : "age ?"} · {p.sex || "sex ?"}{p.diabetic ? " · Diabetic" : ""}</div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  {tk.n > 0 ? <Badge tone={tk.od ? "overdue" : "soon"}>{tk.n} open{tk.od ? ` · ${tk.od} overdue` : ""}</Badge> : <Badge tone="done">All clear</Badge>}
                  {p.isDemo && <Badge tone="upcoming">DEMO</Badge>}
                </div>
              </div>
              <div style={{ fontSize: 14, marginTop: 6 }}>{p.diagnosis || <span className="ec-mut">No diagnosis entered</span>}</div>
              {p.allergies && <div style={{ fontSize: 13, color: "var(--od)", marginTop: 2 }}>Allergies: {p.allergies}</div>}
              {p.archived && <div className="ec-mut" style={{ fontSize: 13, marginTop: 2 }}>Archived {fmtStamp(p.archivedAt)}{p.autoArchived ? " (automatically after discharge)" : ""}</div>}
              <div className="ec-mut" style={{ fontSize: 13.5, marginTop: 2 }}>
                {p.plannedOp ? p.plannedOp : "No operation planned"}{p.opDate ? ` · ${fmtDate(p.opDate)} ${p.opTime || ""}` : ""}{p.opStatus !== "scheduled" && p.opDate ? ` · ${p.opStatus}` : ""}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PatientForm({ initial, all, onSave, onClose }) {
  const isNew = !initial;
  const [d, setD] = useState(() => initial ? clone(initial) : blankPatient());
  const [errs, setErrs] = useState({}); const [dupOk, setDupOk] = useState(false);
  const set = (o) => { setD({ ...d, ...o }); setDupOk(false); };
  const dup = all.find((p) => p.id !== d.id && d.reg.trim() && p.reg.trim().toLowerCase() === d.reg.trim().toLowerCase());
  const save = () => {
    const e = {};
    if (!d.name.trim()) e.name = "Full name is required.";
    if (d.age !== "" && (isNaN(Number(d.age)) || Number(d.age) < 0 || Number(d.age) > 120)) e.age = "Age must be between 0 and 120.";
    if (d.opTime && !d.opDate) e.opDate = "Enter operation date, or clear the time.";
    setErrs(e);
    if (Object.keys(e).length) return;
    if (dup && !dupOk) { setDupOk(true); return; }
    onSave({ ...d, name: d.name.trim(), reg: d.reg.trim(), age: d.age === "" ? "" : Number(d.age), phones: d.phones.map((x) => x.trim()).filter(Boolean) }, isNew);
  };
  return (
    <Sheet lock title={isNew ? "Add patient" : "Edit patient"} onClose={onClose}>
      <div className="ec-warn" style={{ marginBottom: 12 }}>Prototype: do not enter real patient data until the safety limits in Settings are resolved.</div>
      <Field label="List"><select className="ec-in" value={d.listType || "admitted"} onChange={(e) => set({ listType: e.target.value })}><option value="admitted">Admitted (on the ward)</option><option value="waiting">Waiting list (not admitted yet)</option></select></Field>
      <Field label="Full name *" err={errs.name}><input className="ec-in" value={d.name} onChange={(e) => set({ name: e.target.value })} /></Field>
      <Field label="Registration / admission number" err={errs.reg}><input className="ec-in" value={d.reg} onChange={(e) => set({ reg: e.target.value })} /></Field>
      {dup && <div className="ec-warn" style={{ marginBottom: 12 }}><AlertTriangle size={14} style={{ display: "inline" }} /> Possible duplicate: <b>{dup.name}</b> already uses this registration number.{dupOk ? " Tap Save again to keep it anyway." : ""}</div>}
      <Field label="Phone numbers" err={errs.phones}>
        {d.phones.map((ph, i) => (
          <div key={i} className="flex gap-2" style={{ marginBottom: 6 }}>
            <input className="ec-in" type="tel" inputMode="tel" value={ph} onChange={(e) => { const a = [...d.phones]; a[i] = e.target.value; set({ phones: a }); }} />
            {d.phones.length > 1 && <button className="ec-btn" onClick={() => set({ phones: d.phones.filter((_, j) => j !== i) })} aria-label="Remove phone"><X size={18} /></button>}
          </div>
        ))}
        <button className="ec-btn sm" onClick={() => set({ phones: [...d.phones, ""] })}><Plus size={16} /> Add phone</button>
      </Field>
      <div className="flex gap-2">
        <div style={{ flex: 1 }}><Field label="Age" err={errs.age}><input className="ec-in" type="number" inputMode="numeric" value={d.age} onChange={(e) => set({ age: e.target.value })} /></Field></div>
        <div style={{ flex: 1 }}><Field label="Sex" err={errs.sex}>
          <select className="ec-in" value={d.sex} onChange={(e) => set({ sex: e.target.value })}><option value="">Select</option><option value="M">Male</option><option value="F">Female</option></select>
        </Field></div>
      </div>
      {d.listType !== "waiting" && <Field label="Admission date" err={errs.admitDate}><input type="date" className="ec-in" value={d.admitDate} onChange={(e) => set({ admitDate: e.target.value })} /></Field>}
      <Field label="Diagnosis"><input className="ec-in" value={d.diagnosis} onChange={(e) => set({ diagnosis: e.target.value })} /></Field>
      <Field label="Planned operation"><input className="ec-in" value={d.plannedOp} onChange={(e) => set({ plannedOp: e.target.value })} /></Field>
      <div className="flex gap-2">
        <div style={{ flex: 1.3 }}><Field label="Operation date" err={errs.opDate}><input type="date" className="ec-in" value={d.opDate} onChange={(e) => set({ opDate: e.target.value })} /></Field></div>
        <div style={{ flex: 1 }}><Field label="Time"><input type="time" className="ec-in" value={d.opTime} onChange={(e) => set({ opTime: e.target.value })} /></Field></div>
      </div>
      <label className="flex items-center gap-2" style={{ minHeight: 46, fontWeight: 700 }}>
        <input type="checkbox" style={{ width: 24, height: 24 }} checked={d.diabetic} onChange={(e) => set({ diabetic: e.target.checked })} /> Diabetic (adds 2HPP and HbA1c to labs)
      </label>
      <Field label="Chronic diseases"><input className="ec-in" value={d.chronic} onChange={(e) => set({ chronic: e.target.value })} /></Field>
      <Field label="Allergies"><input className="ec-in" value={d.allergies} onChange={(e) => set({ allergies: e.target.value })} /></Field>
      <Field label="General notes"><textarea className="ec-in" value={d.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
      <button className="ec-btn pri" style={{ width: "100%" }} onClick={save}>{dup && dupOk ? "Save anyway" : "Save patient"}</button>
    </Sheet>
  );
}

/* =====================================================================
   Patient detail tabs
   ===================================================================== */
function OverviewTab({ p, S, t, ptasks, onToggle, onOpen, onEdit, onArchive, onDelete, onAssign, onAdmit, upd }) {
  const open = ptasks.filter((k) => !k.done).sort(taskSort);
  const Row = ({ k, v }) => <div className="flex gap-2" style={{ padding: "6px 0", borderTop: "1px solid var(--ln)" }}><div className="ec-mut" style={{ width: 110, flex: "none", fontSize: 13.5 }}>{k}</div><div style={{ flex: 1, fontSize: 15 }}>{v || <span className="ec-mut">—</span>}</div></div>;
  return (
    <div>
      <div className="ec-card">
        <Row k="Registration" v={<>{p.reg} {(p.listType || "admitted") === "waiting" && <Badge tone="today">Waiting list</Badge>}</>} />
        <Row k="Age / sex" v={`${p.age !== "" ? p.age + " y" : "?"} · ${p.sex === "M" ? "Male" : p.sex === "F" ? "Female" : "?"}`} />
        <Row k="Phone" v={p.phones.filter(Boolean).map((ph, i) => <div key={i}><a href={`tel:${ph.replace(/\s/g, "")}`} style={{ color: "var(--pri)", fontWeight: 700 }}>{ph}</a></div>)} />
        <Row k="Admitted" v={fmtDateY(p.admitDate)} />
        <Row k="Diagnosis" v={p.diagnosis} />
        <Row k="Planned op" v={p.plannedOp} />
        <Row k="Operation" v={p.opDate ? `${fmtDate(p.opDate)} ${p.opTime || ""} · ${p.opStatus}` : ""} />
        <Row k="Chronic" v={<>{p.diabetic && <Badge tone="today">Diabetic</Badge>} {p.chronic}</>} />
        <Row k="Allergies" v={p.allergies ? <span style={{ color: "var(--od)", fontWeight: 700 }}>{p.allergies}</span> : ""} />
        <Row k="Notes" v={p.notes} />
      </div>
      <Section title={`Open tasks (${open.length})`}>
        {open.length === 0 ? <Empty>No open tasks for this patient.</Empty> :
          <div className="flex flex-col gap-2">{open.map((k) => <TaskCard key={k.id} k={k} t={t} S={S} compact onToggle={onToggle} onOpen={onOpen} />)}</div>}
      </Section>
      <div className="flex flex-wrap gap-2" style={{ marginTop: 16 }}>
        {(p.listType || "admitted") === "waiting" && <button className="ec-btn pri" onClick={onAdmit}>Admit patient</button>}
        {(p.listType || "admitted") === "admitted" && !p.opDate && !p.archived && <button className="ec-btn pri" onClick={onAssign}><CalendarDays size={16} /> Assign to operation list</button>}
        <button className="ec-btn" onClick={onEdit}><Pencil size={16} /> Edit details</button>
        <button className="ec-btn" onClick={onArchive}><Archive size={16} /> {p.archived ? "Restore" : "Archive"}</button>
        <button className="ec-btn dgr" onClick={onDelete}><Trash2 size={16} /> Delete</button>
      </div>
    </div>
  );
}

function FixedRow({ f, p, S, t, upd }) {
  const [openN, setOpenN] = useState(false);
  const st = p.opStatus; const closed = st === "cancelled" || st === "completed";
  const rec = p.tasks[f.key] || {};
  const isCall = f.key === "call";
  const done = isCall ? !!p.callDone && p.callDone.forDate === p.opDate : !!rec.done;
  const doneAt = isCall ? (done ? p.callDone.doneAt : "") : rec.doneAt;
  let lock = "";
  if (f.needsOp && !p.opDate) lock = "Appears once the patient is assigned to the operation list (has an operation date).";
  else if (f.post && st !== "completed") lock = "Available after the operation is marked completed.";
  else if (f.pre && closed) lock = `Closed — operation ${st}.`;
  else if (isCall && !p.opDate) lock = "Enter an operation date to create this reminder.";
  else if (isCall && st === "postponed") lock = "Paused — set a new operation date.";
  const due = fixedDue(f, p, S, t); const sec = done ? "done" : due ? secOf(due, t, S.soonDays) : "upcoming";
  let progress = "";
  if (f.umb === "labs") progress = `${p.labs.filter((l) => l.status === "reviewed" || l.status === "na").length}/${p.labs.length} tests reviewed or N/A`;
  if (f.umb === "req") progress = `${p.consults.filter((c) => c.status >= 1).length}/${p.consults.length} consultations requested`;
  if (f.umb === "rev") progress = `${p.consults.filter((c) => c.status >= 4 && (!c.actionRequired || c.actionDone)).length}/${p.consults.length} reviewed with actions documented`;
  const toggle = () => upd((q) => {
    if (isCall) { q.callDone = done ? null : { forDate: q.opDate, doneAt: nowISO() }; }
    else q.tasks[f.key] = { ...(q.tasks[f.key] || {}), done: !done, doneAt: !done ? nowISO() : "" };
  });
  const setNote = (v) => upd((q) => { q.tasks[f.key] = { ...(q.tasks[f.key] || {}), notes: v }; }, { quiet: true });
  return (
    <div id={`row-fix-${f.key}`} className="ec-card" style={{ opacity: lock ? 0.6 : 1, borderLeft: `6px solid ${TONE[sec].c}` }}>
      <div className="flex items-start gap-3">
        <button className={`ec-chk ${done ? "on" : ""}`} disabled={!!lock} onClick={toggle} aria-label="Toggle task">{done && <Check size={24} />}</button>
        <div className="flex-1" style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, lineHeight: 1.3, textDecoration: done ? "line-through" : "none" }}>{f.title}</div>
          {lock ? <div className="ec-mut" style={{ fontSize: 13, marginTop: 4 }}>{lock}</div> : (
            <div className="flex flex-wrap gap-1" style={{ marginTop: 6 }}>
              {done ? <Badge tone="done">Done {fmtStamp(doneAt)}</Badge> : due && <Badge tone={sec}>{dueLabel(due, t)}</Badge>}
              {f.umb && !done && <Badge tone={umbComplete(p, f.umb) ? "done" : "today"}>{progress}</Badge>}
            </div>
          )}
          {isCall && !lock && <div style={{ fontSize: 13.5, marginTop: 6 }}><b>Reminder:</b> {callInfo(p, S, t).text}<br /><span className="ec-mut">Operation {fmtDate(p.opDate)} {p.opTime || ""}</span></div>}
          {f.umb && !done && <div className="ec-mut" style={{ fontSize: 12.5, marginTop: 6 }}>Appears in the master list for confirmation once every item is finished. It is never ticked automatically.</div>}
          {f.post && !lock && S.autoArchive && !done && <div className="ec-mut" style={{ fontSize: 12.5, marginTop: 6 }}>When both "operative details" and "discharge" are ticked, the patient is archived automatically (Settings).</div>}
          {f.afterReview && !done && <div className="ec-mut" style={{ fontSize: 12.5, marginTop: 6 }}>Shows in the master list once every consultation recommendation is reviewed. Write the sheet in the notes below.</div>}
          {!lock && <button className="ec-btn sm" style={{ marginTop: 8 }} onClick={() => setOpenN(!openN)}>{openN ? "Hide" : rec.notes ? (f.key === "ticket" ? "Clinical sheet notes ●" : "Notes ●") : (f.key === "ticket" ? "Write clinical sheet notes" : "Add notes")}</button>}
          {openN && <textarea className="ec-in" style={{ marginTop: 8 }} value={rec.notes || ""} onChange={(e) => setNote(e.target.value)} />}
        </div>
      </div>
    </div>
  );
}

function ChecklistTab({ p, S, t, upd }) {
  const [nt, setNt] = useState({ title: "", due: "", time: "", cat: "Other", urgent: false });
  const add = () => {
    if (!nt.title.trim()) return;
    upd((q) => { q.customTasks.push({ id: uid(), title: nt.title.trim(), due: nt.due || (nt.time ? today() : ""), time: nt.time, cat: nt.cat, urgent: nt.urgent, done: false, doneAt: "" }); });
    setNt({ title: "", due: "", time: "", cat: "Other", urgent: false });
  };
  return (
    <div>
      <div className="flex flex-col gap-2">{FIXED.map((f) => <FixedRow key={f.key} f={f} p={p} S={S} t={t} upd={upd} />)}</div>
      <Section title="Custom tasks">
        <div className="flex flex-col gap-2">
          {p.customTasks.map((c) => (
            <div id={`row-cust-${c.id}`} key={c.id} className="ec-card flex items-center gap-3">
              <button className={`ec-chk ${c.done ? "on" : ""}`} onClick={() => upd((q) => { const x = q.customTasks.find((y) => y.id === c.id); x.done = !x.done; x.doneAt = x.done ? nowISO() : ""; })}>{c.done && <Check size={24} />}</button>
              <div className="flex-1"><div style={{ fontWeight: 700, textDecoration: c.done ? "line-through" : "none" }}>{c.title}</div>
                <div className="ec-mut" style={{ fontSize: 13 }}>{c.cat} · {c.due ? `due ${fmtDate(c.due)}${c.time ? " " + c.time : ""}` : "no due date"}{c.urgent ? " · urgent" : ""}{c.done ? ` · done ${fmtStamp(c.doneAt)}` : ""}</div></div>
              <button className="ec-btn sm" aria-label="Delete task" onClick={() => upd((q) => { q.customTasks = q.customTasks.filter((y) => y.id !== c.id); })}><Trash2 size={16} /></button>
            </div>
          ))}
        </div>
        <div className="ec-card" style={{ marginTop: 8 }}>
          <Field label="New task"><input className="ec-in" value={nt.title} placeholder="e.g. Ask anesthesia to review" onChange={(e) => setNt({ ...nt, title: e.target.value })} /></Field>
          <div className="flex gap-2">
            <div style={{ flex: 1.3 }}><Field label="Due date (optional)"><input type="date" className="ec-in" value={nt.due} onChange={(e) => setNt({ ...nt, due: e.target.value })} /></Field></div>
            <div style={{ flex: 1 }}><Field label="Due time"><input type="time" className="ec-in" value={nt.time} onChange={(e) => setNt({ ...nt, time: e.target.value })} /></Field></div>
          </div>
          <Field label="Category"><select className="ec-in" value={nt.cat} onChange={(e) => setNt({ ...nt, cat: e.target.value })}>{TASK_CATS.map((c) => <option key={c}>{c}</option>)}</select></Field>
          <label className="flex items-center gap-2" style={{ minHeight: 44, fontWeight: 600 }}><input type="checkbox" style={{ width: 22, height: 22 }} checked={nt.urgent} onChange={(e) => setNt({ ...nt, urgent: e.target.checked })} /> Mark urgent</label>
          <button className="ec-btn pri" onClick={add}><Plus size={16} /> Add task</button>
        </div>
      </Section>
    </div>
  );
}

function LabsTab({ p, S, t, upd }) {
  const [nm, setNm] = useState(""); const [msg, setMsg] = useState("");
  const setStatus = (id, s) => upd((q) => {
    const l = q.labs.find((x) => x.id === id); l.status = s;
    if (s === "ordered" && !l.orderDate) l.orderDate = today();
    if ((s === "result" || s === "reviewed") && !l.resultDate) l.resultDate = today();
    l.reviewedAt = s === "reviewed" ? nowISO() : "";
  });
  const field = (id, k, v) => upd((q) => { q.labs.find((x) => x.id === id)[k] = v; }, { quiet: true });
  const addLab = () => {
    const n = nm.trim(); if (!n) return;
    if (p.labs.some((l) => labKey(l.name) === labKey(n))) { setMsg(`"${n}" already exists${labKey(n) === "fbs" ? " (FBS is the fasting glucose test — no duplicate needed)" : ""}.`); return; }
    upd((q) => { q.labs.push(newLab(n, "custom")); }); setNm(""); setMsg("");
  };
  return (
    <div>
      <div className="ec-warn" style={{ marginBottom: 12 }}>Basic labs is ONE item covering the panel listed on its card (editable in Settings). It is a workflow default — follow local hospital protocols and the treating team's decisions.{p.diabetic ? " Diabetic: HbA1c and 2HPP are included in it." : ""}</div>
      <div className="flex flex-col gap-2">
        {p.labs.map((l) => {
          const done = l.status === "reviewed" || l.status === "na";
          const tone = done ? "done" : l.status === "not_ordered" ? "overdue" : l.status === "ordered" ? "today" : "soon";
          return (
            <div id={`row-lab-${l.id}`} key={l.id} className="ec-card" style={{ borderLeft: `6px solid ${TONE[tone].c}` }}>
              <div className="flex items-center justify-between gap-2" style={{ marginBottom: 8 }}>
                <div style={{ fontWeight: 750, fontSize: 16 }}>{l.name}{l.src === "diab" && <span className="ec-mut" style={{ fontSize: 12 }}> (diabetic)</span>}</div>
                <Badge tone={tone}>{LAB_STATUS.find((x) => x[0] === l.status)[1]}</Badge>
              </div>
              {l.src === "basic" && <div className="ec-mut" style={{ fontSize: 13, marginBottom: 8 }}>Includes: {labsIncluded(p, S).join(", ")}</div>}
              <select className="ec-in" value={l.status} onChange={(e) => setStatus(l.id, e.target.value)}>
                {LAB_STATUS.map(([v, lb]) => <option key={v} value={v}>{lb}</option>)}
              </select>
              {l.status !== "not_ordered" && l.status !== "na" && (
                <div style={{ marginTop: 8 }}>
                  <div className="flex gap-2">
                    <div style={{ flex: 1 }}><label className="ec-lbl">Order date</label><input type="date" className="ec-in" value={l.orderDate} onChange={(e) => field(l.id, "orderDate", e.target.value)} /></div>
                    <div style={{ flex: 1 }}><label className="ec-lbl">Result date</label><input type="date" className="ec-in" value={l.resultDate} onChange={(e) => field(l.id, "resultDate", e.target.value)} /></div>
                  </div>
                  <label className="ec-lbl" style={{ marginTop: 8 }}>Result value / note</label>
                  <input className="ec-in" value={l.result} onChange={(e) => field(l.id, "result", e.target.value)} />
                  {l.status === "result" && <button className="ec-btn pri" style={{ marginTop: 8, width: "100%" }} onClick={() => setStatus(l.id, "reviewed")}><Check size={18} /> Mark result reviewed</button>}
                  {l.status === "reviewed" && <div className="ec-mut" style={{ fontSize: 13, marginTop: 6 }}>Reviewed {fmtStamp(l.reviewedAt)}</div>}
                </div>
              )}
              {l.src === "custom" && <button className="ec-btn sm dgr" style={{ marginTop: 8 }} onClick={() => upd((q) => { q.labs = q.labs.filter((x) => x.id !== l.id); })}><Trash2 size={14} /> Remove test</button>}
            </div>
          );
        })}
      </div>
      <div className="ec-card" style={{ marginTop: 10 }}>
        <Field label="Add another test for this patient"><input className="ec-in" value={nm} placeholder="e.g. ESR" onChange={(e) => setNm(e.target.value)} /></Field>
        {msg && <div className="ec-err" style={{ marginBottom: 8 }}>{msg}</div>}
        <button className="ec-btn pri" onClick={addLab}><Plus size={16} /> Add test</button>
      </div>
    </div>
  );
}

function ConsultsTab({ p, S, t, upd }) {
  const [spec, setSpec] = useState("ENT"); const [custom, setCustom] = useState(""); const [reasonErr, setReasonErr] = useState("");
  const sug = suggestConsults(p.age, S); const ov = p.consultOverride;
  const setC = (id, o) => upd((q) => { Object.assign(q.consults.find((x) => x.id === id), o); }, { quiet: true });
  const setStatus = (id, s) => upd((q) => { const c = q.consults.find((x) => x.id === id); c.status = s; if (s >= 1 && !c.reqDate) c.reqDate = today(); });
  const addC = () => {
    const name = spec === "Other" ? custom.trim() : spec; if (!name) return;
    if (p.consults.some((c) => c.spec.toLowerCase() === name.toLowerCase())) return;
    upd((q) => { q.consults.push(newConsult(name, "manual")); }); setCustom("");
  };
  return (
    <div>
      <div className="ec-warn" style={{ marginBottom: 12 }}>Suggested consultations come from <b>local workflow rules</b> (editable in Settings), not universal medical recommendations.</div>
      <div className="ec-card" style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 14 }}><b>Suggested for this patient:</b> {sug.length ? sug.join(", ") : "none"}{p.age === "" ? " (enter age for age-based rules)" : ""}</div>
        <label className="flex items-center gap-2" style={{ minHeight: 46, fontWeight: 700 }}>
          <input type="checkbox" style={{ width: 24, height: 24 }} checked={ov.on} onChange={(e) => {
            const on = e.target.checked; setReasonErr("");
            upd((q) => { q.consultOverride.on = on; if (!on) { q.consultOverride.reason = ""; ensureConsults(q, S); } });
          }} /> Override suggested consultations
        </label>
        {ov.on && (<>
          <label className="ec-lbl">Reason for override (required)</label>
          <input className="ec-in" value={ov.reason} onChange={(e) => upd((q) => { q.consultOverride.reason = e.target.value; }, { quiet: true })} />
          {!ov.reason.trim() && <div className="ec-err">Document why the suggestion was overridden.</div>}
          <div className="ec-mut" style={{ fontSize: 12.5, marginTop: 6 }}>With override on, rule-based consultations are no longer added or removed automatically. You can remove consultations that are still "Not requested".</div>
        </>)}
      </div>
      <div className="flex flex-col gap-2">
        {p.consults.length === 0 && <Empty>No consultations. Add one below.</Empty>}
        {p.consults.map((c) => {
          const tone = c.status >= 4 && (!c.actionRequired || c.actionDone) ? "done" : c.status === 0 ? "overdue" : "today";
          return (
            <div id={`row-con-${c.id}`} key={c.id} className="ec-card" style={{ borderLeft: `6px solid ${TONE[tone].c}` }}>
              <div className="flex items-center justify-between gap-2" style={{ marginBottom: 8 }}>
                <div style={{ fontWeight: 750, fontSize: 16 }}>{c.spec}<span className="ec-mut" style={{ fontSize: 12 }}> {c.src === "rule" ? "(by ward rule)" : "(added manually)"}</span></div>
                <Badge tone={tone}>{consultLabel(c)}</Badge>
              </div>
              <select className="ec-in" value={c.status} onChange={(e) => setStatus(c.id, Number(e.target.value))}>
                {CONSULT_STATUS.map(([v, lb]) => <option key={v} value={v}>{lb}</option>)}
              </select>
              {c.status >= 1 && (
                <div style={{ marginTop: 8 }}>
                  <label className="ec-lbl">Date requested</label>
                  <input type="date" className="ec-in" value={c.reqDate} onChange={(e) => setC(c.id, { reqDate: e.target.value })} />
                  <label className="ec-lbl" style={{ marginTop: 8 }}>Findings</label>
                  <textarea className="ec-in" value={c.findings} onChange={(e) => setC(c.id, { findings: e.target.value })} />
                  <label className="ec-lbl" style={{ marginTop: 8 }}>Recommendations</label>
                  <textarea className="ec-in" value={c.recs} onChange={(e) => setC(c.id, { recs: e.target.value })} />
                  <label className="flex items-center gap-2" style={{ minHeight: 46, fontWeight: 650 }}>
                    <input type="checkbox" style={{ width: 24, height: 24 }} checked={c.actionRequired} onChange={(e) => upd((q) => { const x = q.consults.find((y) => y.id === c.id); x.actionRequired = e.target.checked; if (!e.target.checked) { x.actionDone = false; x.actionDoneAt = ""; } })} /> Recommendations need a further action
                  </label>
                  {c.actionRequired && (<>
                    <input className="ec-in" placeholder="Describe the action" value={c.actionText} onChange={(e) => setC(c.id, { actionText: e.target.value })} />
                    <label className="flex items-center gap-2" style={{ minHeight: 46, fontWeight: 650 }}>
                      <input type="checkbox" style={{ width: 24, height: 24 }} checked={c.actionDone} onChange={(e) => upd((q) => { const x = q.consults.find((y) => y.id === c.id); x.actionDone = e.target.checked; x.actionDoneAt = e.target.checked ? nowISO() : ""; })} /> Action completed / documented {c.actionDone && <span className="ec-mut" style={{ fontWeight: 400, fontSize: 12 }}>{fmtStamp(c.actionDoneAt)}</span>}
                    </label>
                  </>)}
                </div>
              )}
              {c.status === 0 && (c.src !== "rule" || ov.on) && <button className="ec-btn sm dgr" style={{ marginTop: 8 }} onClick={() => upd((q) => { q.consults = q.consults.filter((x) => x.id !== c.id); })}><Trash2 size={14} /> Remove</button>}
            </div>
          );
        })}
      </div>
      <div className="ec-card" style={{ marginTop: 10 }}>
        <Field label="Add consultation">
          <select className="ec-in" value={spec} onChange={(e) => setSpec(e.target.value)}>
            {["ENT", "Cardiology", "Pediatrics", "Other"].map((s) => <option key={s} value={s}>{s === "Other" ? "Other / custom specialty" : s}</option>)}
          </select>
        </Field>
        {spec === "Other" && <Field label="Specialty name"><input className="ec-in" value={custom} onChange={(e) => setCustom(e.target.value)} /></Field>}
        <button className="ec-btn pri" onClick={addC}><Plus size={16} /> Add consultation</button>
      </div>
    </div>
  );
}

function TemplateSaveSheet({ kind, fields, p, onSave, onClose }) {
  const [opType, setOpType] = useState(""); const [title, setTitle] = useState(""); const [err, setErr] = useState("");
  const submit = () => {
    if (!opType.trim() || !title.trim()) { setErr("Enter an operation type and a template title."); return; }
    const blob = Object.values(fields).join(" ").toLowerCase();
    if ((p.name && blob.includes(p.name.toLowerCase())) || (p.reg && blob.includes(p.reg.toLowerCase()))) { setErr("The text contains this patient's name or registration number. Remove personal details before saving as a template."); return; }
    onSave({ id: uid(), kind, opType: opType.trim(), title: title.trim(), ...fields });
  };
  return (
    <Sheet lock title="Save as reusable template" onClose={onClose}>
      <div className="ec-warn" style={{ marginBottom: 12 }}>Only the text fields are saved. Patient name, registration number and phone numbers are never copied. Remove any personal details from the text first.</div>
      <Field label="Operation type"><input className="ec-in" value={opType} placeholder="e.g. Pterygium excision" onChange={(e) => setOpType(e.target.value)} /></Field>
      <Field label="Template title"><input className="ec-in" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
      {err && <div className="ec-err" style={{ marginBottom: 8 }}>{err}</div>}
      <button className="ec-btn pri" style={{ width: "100%" }} onClick={submit}>Save template</button>
    </Sheet>
  );
}

function OpTab({ p, S, t, upd, templates, askConfirm, saveTemplate, toast }) {
  const o = p.op; const [reason, setReason] = useState(""); const [tpl, setTpl] = useState(""); const [saveOpen, setSaveOpen] = useState(false);
  const setO = (k, v) => upd((q) => { q.op[k] = v; }, { quiet: true });
  const setDate = (v) => upd((q) => { const old = q.opDate; q.opDate = v; applyDateChange(q, old, reason || "Changed in Operation tab"); });
  const setStatus = (s) => {
    const go = () => upd((q) => {
      q.opHistory.push({ at: nowISO(), type: "status", from: q.opStatus, to: s, reason });
      q.opStatus = s;
      if (s === "completed") { if (!q.op.date) q.op.date = q.opDate || today(); if (!q.op.name) q.op.name = q.plannedOp || ""; if (!q.op.surgeon) q.op.surgeon = S.defaultSurgeon || ""; }
    });
    if (s === "cancelled" || s === "completed") askConfirm({ title: `Mark operation ${s}?`, body: s === "cancelled" ? "Pre-operative tasks and the call reminder will be closed (kept in history, not deleted). You can re-schedule later." : "Pre-operative tasks will be closed and post-operative tasks (operative details, discharge) will appear in the master list.", yes: "Confirm", onYes: go });
    else go();
    setReason("");
  };
  const opTpls = templates.filter((x) => x.kind === "operative");
  const applyTpl = () => {
    const tp = templates.find((x) => x.id === tpl); if (!tp) return;
    const fill = () => upd((q) => { q.op.notes = tp.notes || ""; q.op.complications = tp.complications || ""; q.op.postop = tp.postop || ""; if (!q.op.name) q.op.name = tp.opType || ""; });
    if (o.notes || o.complications || o.postop) askConfirm({ title: "Replace operative text?", body: "This replaces the current notes, complications and instructions with the template text. You can edit it afterwards.", yes: "Replace", onYes: fill });
    else fill();
  };
  return (
    <div>
      <div className="ec-card">
        <div style={{ fontWeight: 750, marginBottom: 8 }}>Operation schedule</div>
        <Field label="Planned operation"><input className="ec-in" value={p.plannedOp} onChange={(e) => upd((q) => { q.plannedOp = e.target.value; }, { quiet: true })} /></Field>
        <div className="flex gap-2">
          <div style={{ flex: 1.3 }}><Field label="Date"><input type="date" className="ec-in" value={p.opDate} onChange={(e) => setDate(e.target.value)} /></Field></div>
          <div style={{ flex: 1 }}><Field label="Time"><input type="time" className="ec-in" value={p.opTime} onChange={(e) => upd((q) => { q.opTime = e.target.value; }, { quiet: true })} /></Field></div>
        </div>
        <Field label="Reason for change (optional, saved in history)"><input className="ec-in" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <label className="ec-lbl">Operation status</label>
        <div className="flex flex-wrap gap-2">
          {OP_STATUS.map(([v, lb]) => <button key={v} className={`ec-chip ${p.opStatus === v ? "on" : ""}`} onClick={() => p.opStatus !== v && setStatus(v)}>{lb}</button>)}
        </div>
        <div style={{ marginTop: 10, fontSize: 13.5 }}><b>Call reminder:</b> {callInfo(p, S, t).text}</div>
        <div className="ec-mut" style={{ fontSize: 12.5, marginTop: 4 }}>Changing the date moves the call reminder automatically. Only one call task exists per patient.</div>
      </div>

      <Section title="Operative record">
        <div className="ec-card">
          {p.opStatus !== "completed" && <div className="ec-mut" style={{ fontSize: 13, marginBottom: 8 }}>You can fill this in at any time. Marking the operation completed adds "Document operative details" to the master list.</div>}
          <div className="ec-card" style={{ background: "var(--sf2)", marginBottom: 10 }}>
            <label className="ec-lbl">Start from a library template</label>
            <select className="ec-in" value={tpl} onChange={(e) => setTpl(e.target.value)}>
              <option value="">Choose template…</option>
              {opTpls.map((x) => <option key={x.id} value={x.id}>{x.opType} — {x.title}</option>)}
            </select>
            <button className="ec-btn sm" style={{ marginTop: 8 }} disabled={!tpl} onClick={applyTpl}>Use template (editable)</button>
          </div>
          <Field label="Operation name"><input className="ec-in" value={o.name} onChange={(e) => setO("name", e.target.value)} /></Field>
          <div className="flex gap-2">
            <div style={{ flex: 1 }}><Field label="Operation date"><input type="date" className="ec-in" value={o.date} onChange={(e) => setO("date", e.target.value)} /></Field></div>
            <div style={{ flex: 1 }}><Field label="Surgeon / doctor"><input className="ec-in" value={o.surgeon} onChange={(e) => setO("surgeon", e.target.value)} /></Field></div>
          </div>
          <Field label="Operative notes"><textarea className="ec-in" style={{ minHeight: 120 }} value={o.notes} onChange={(e) => setO("notes", e.target.value)} /></Field>
          <Field label="Complications (if any)"><textarea className="ec-in" value={o.complications} onChange={(e) => setO("complications", e.target.value)} /></Field>
          <Field label="Postoperative instructions"><textarea className="ec-in" value={o.postop} onChange={(e) => setO("postop", e.target.value)} /></Field>
          <div className="flex flex-wrap gap-2">
            <button className="ec-btn" onClick={() => setSaveOpen(true)}><FileText size={16} /> Save as template</button>
            <button className="ec-btn" onClick={() => upd((q) => { if (q.discharge.postop === "" ) q.discharge.postop = q.op.postop; if (!q.discharge.opPerformed) q.discharge.opPerformed = q.op.name; }, {})}>Copy op name + instructions to discharge</button>
          </div>
        </div>
      </Section>

      {p.opHistory.length > 0 && (
        <Section title="Schedule history">
          <div className="ec-card">
            {[...p.opHistory].reverse().map((h, i) => (
              <div key={i} style={{ fontSize: 13.5, padding: "6px 0", borderTop: i ? "1px solid var(--ln)" : "none" }}>
                <b>{h.type === "date" ? `Date: ${h.from ? fmtDateY(h.from) : "none"} → ${h.to ? fmtDateY(h.to) : "none"}` : `Status: ${h.from} → ${h.to}`}</b>
                <div className="ec-mut">{fmtStamp(h.at)}{h.reason ? ` · ${h.reason}` : ""}</div>
              </div>
            ))}
          </div>
        </Section>
      )}
      {saveOpen && <TemplateSaveSheet kind="operative" p={p} fields={{ notes: o.notes, complications: o.complications, postop: o.postop }} onClose={() => setSaveOpen(false)} onSave={(tp) => { saveTemplate(tp); setSaveOpen(false); toast("Template saved to the library"); }} />}
    </div>
  );
}

function DischargeTab({ p, S, t, upd, templates, askConfirm, saveTemplate, toast }) {
  const d = p.discharge; const [tpl, setTpl] = useState(""); const [saveOpen, setSaveOpen] = useState(false);
  const setD = (k, v) => upd((q) => { q.discharge[k] = v; }, { quiet: true });
  const dTpls = templates.filter((x) => x.kind === "discharge");
  const applyTpl = () => {
    const tp = templates.find((x) => x.id === tpl); if (!tp) return;
    const fill = () => upd((q) => { ["hospitalCourse", "condition", "medications", "postop", "followUp"].forEach((k) => { q.discharge[k] = tp[k] || ""; }); });
    if (d.hospitalCourse || d.condition || d.medications || d.postop || d.followUp) askConfirm({ title: "Replace discharge text?", body: "Current hospital course, condition, medications, instructions and follow-up will be replaced by the template text.", yes: "Replace", onYes: fill });
    else fill();
  };
  const text = dischargeText(p);
  return (
    <div>
      <div className="ec-warn" style={{ marginBottom: 12 }}>Doctor Arwa never fills in clinical findings, doses or instructions for you. Empty fields stay blank in the printed note.</div>
      <div className="ec-card">
        <div className="ec-card" style={{ background: "var(--sf2)", marginBottom: 10 }}>
          <label className="ec-lbl">Start from a discharge template</label>
          <select className="ec-in" value={tpl} onChange={(e) => setTpl(e.target.value)}>
            <option value="">Choose template…</option>
            {dTpls.map((x) => <option key={x.id} value={x.id}>{x.opType} — {x.title}</option>)}
          </select>
          <button className="ec-btn sm" style={{ marginTop: 8 }} disabled={!tpl} onClick={applyTpl}>Use template (editable)</button>
        </div>
        <Field label="Date"><input type="date" className="ec-in" value={d.date} onChange={(e) => setD("date", e.target.value)} /></Field>
        <Field label="Diagnosis"><input className="ec-in" value={d.dx} onChange={(e) => setD("dx", e.target.value)} /></Field>
        <Field label="Operation performed (if applicable)"><input className="ec-in" value={d.opPerformed} onChange={(e) => setD("opPerformed", e.target.value)} /></Field>
        <button className="ec-btn sm" style={{ marginBottom: 12 }} onClick={() => upd((q) => { if (!q.discharge.dx) q.discharge.dx = q.diagnosis; if (!q.discharge.opPerformed) q.discharge.opPerformed = q.op.name || (q.opStatus === "completed" ? q.plannedOp : ""); if (!q.discharge.date) q.discharge.date = today(); })}>Fill empty diagnosis / operation / date from record</button>
        <Field label="Hospital course"><textarea className="ec-in" value={d.hospitalCourse} onChange={(e) => setD("hospitalCourse", e.target.value)} /></Field>
        <Field label="Condition at discharge"><textarea className="ec-in" value={d.condition} onChange={(e) => setD("condition", e.target.value)} /></Field>
        <Field label="Medications"><textarea className="ec-in" value={d.medications} onChange={(e) => setD("medications", e.target.value)} /></Field>
        <Field label="Postoperative instructions"><textarea className="ec-in" value={d.postop} onChange={(e) => setD("postop", e.target.value)} /></Field>
        <Field label="Follow-up plan"><textarea className="ec-in" value={d.followUp} onChange={(e) => setD("followUp", e.target.value)} /></Field>
        <button className="ec-btn" onClick={() => setSaveOpen(true)}><FileText size={16} /> Save text as template</button>
      </div>
      <Section title="Discharge note">
        <div className="ec-print ec-card" style={{ background: "#fff", color: "#000" }}>
          <div style={{ fontWeight: 800, fontSize: 18, borderBottom: "2px solid #000", paddingBottom: 6, marginBottom: 8 }}>Discharge note</div>
          {[["Patient", p.name], ["Registration no.", p.reg], ["Age / sex", [p.age, p.sex].filter((x) => x !== "").join(" / ")], ["Date", d.date ? fmtDateY(d.date) : ""], ["Diagnosis", d.dx], ["Operation performed", d.opPerformed]].map(([k, v]) => (
            <div key={k} style={{ display: "flex", gap: 8, padding: "3px 0", fontSize: 14.5 }}><b style={{ width: 130, flex: "none" }}>{k}:</b><span style={{ flex: 1, borderBottom: v ? "none" : "1px dotted #777", minHeight: 18 }}>{v}</span></div>
          ))}
          {[["Hospital course", d.hospitalCourse], ["Condition at discharge", d.condition], ["Medications", d.medications], ["Postoperative instructions", d.postop], ["Follow-up plan", d.followUp]].map(([k, v]) => (
            <div key={k} style={{ marginTop: 10 }}><b style={{ fontSize: 14.5 }}>{k}:</b><div style={{ whiteSpace: "pre-wrap", fontSize: 14.5, minHeight: 36, borderBottom: v ? "none" : "1px dotted #777" }}>{v}</div></div>
          ))}
        </div>
        <div className="flex flex-wrap gap-2" style={{ marginTop: 10 }}>
          <button className="ec-btn pri" onClick={async () => toast((await copyText(text)) ? "Discharge note copied" : "Copy blocked here — select the text and copy manually")}><Copy size={16} /> Copy text</button>
          <button className="ec-btn" onClick={() => { try { window.print(); } catch (e) { toast("Printing is not available here"); } }}><Printer size={16} /> Print</button>
        </div>
        <div className="ec-mut" style={{ fontSize: 12.5, marginTop: 6 }}>If printing does not open on your phone, use Copy text and paste it into a document or message.</div>
      </Section>
      {saveOpen && <TemplateSaveSheet kind="discharge" p={p} fields={{ hospitalCourse: d.hospitalCourse, condition: d.condition, medications: d.medications, postop: d.postop, followUp: d.followUp }} onClose={() => setSaveOpen(false)} onSave={(tp) => { saveTemplate(tp); setSaveOpen(false); toast("Template saved to the library"); }} />}
    </div>
  );
}

function DocThumb({ id, cache, onClick }) {
  const [src, setSrc] = useState(cache.current[id] || null); const [missing, setMissing] = useState(false);
  useEffect(() => {
    let live = true;
    if (cache.current[id]) { setSrc(cache.current[id]); return; }
    store.get(DOC_PREFIX + id).then((raw) => {
      if (!live) return;
      if (raw) { try { const o = JSON.parse(raw); cache.current[id] = o.dataUrl; setSrc(o.dataUrl); return; } catch (e) { /* fallthrough */ } }
      setMissing(true);
    });
    return () => { live = false; };
  }, [id]);
  if (src) return <img src={src} alt="Attached document" onClick={onClick} style={{ width: "100%", height: 110, objectFit: "cover", borderRadius: 10, cursor: "pointer" }} />;
  return <div className="ec-mut" style={{ height: 110, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, textAlign: "center", border: "1px dashed var(--ln)", borderRadius: 10 }}>{missing ? "Image not available" : "Loading…"}</div>;
}

function DocsTab({ p, upd, cache, saveDocData, delDocData, askConfirm, toast }) {
  const [type, setType] = useState("Admission ticket"); const [busy, setBusy] = useState(false); const [view, setView] = useState(null);
  const onFile = async (e) => {
    const files = Array.from(e.target.files || []); e.target.value = "";
    if (!files.length) return;
    setBusy(true); let okN = 0, mem = 0, bad = 0;
    for (const f of files) {
      if (!f.type.startsWith("image/")) { bad++; continue; }
      try {
        const dataUrl = await compressImage(f); const id = uid();
        const ok = await saveDocData(id, dataUrl);
        upd((q) => { q.docs.push({ id, type, name: f.name || "photo", addedAt: nowISO(), persisted: ok }); });
        if (ok) okN++; else mem++;
      } catch (err) { bad++; }
    }
    setBusy(false);
    toast(`${okN + mem} photo(s) attached${mem ? ` (${mem} for this session only: storage unavailable)` : ""}${bad ? `, ${bad} skipped` : ""}`);
  };
  return (
    <div>
      <div className="ec-warn" style={{ marginBottom: 12 }}>Photos are compressed and kept inside this app's own storage only. Nothing is uploaded anywhere. Storage is not encrypted and may not be permanent — keep the original photos elsewhere.</div>
      <div className="ec-card">
        <Field label="Document type"><select className="ec-in" value={type} onChange={(e) => setType(e.target.value)}>{["Admission ticket", "Lab result", "Consultation note", "Consent form", "Other"].map((x) => <option key={x}>{x}</option>)}</select></Field>
        <label className="ec-btn pri" style={{ width: "100%" }}>
          <Camera size={18} /> {busy ? "Processing…" : "Take photos / choose images (multiple)"}
          <input type="file" accept="image/*" multiple style={{ display: "none" }} onChange={onFile} disabled={busy} />
        </label>
      </div>
      <Section title={`Attached (${p.docs.length})`}>
        {p.docs.length === 0 ? <Empty>No documents attached.</Empty> : (
          <div className="grid grid-cols-2 gap-2">
            {p.docs.map((d) => (
              <div key={d.id} className="ec-card" style={{ padding: 8 }}>
                <DocThumb id={d.id} cache={cache} onClick={() => setView(d)} />
                <div style={{ fontSize: 13, fontWeight: 700, marginTop: 6 }}>{d.type}</div>
                <div className="ec-mut" style={{ fontSize: 12 }}>{fmtStamp(d.addedAt)}{d.persisted === false ? " · session only" : ""}</div>
                <button className="ec-btn sm dgr" style={{ marginTop: 6 }} onClick={() => askConfirm({ title: "Delete this image?", body: "The attached image will be removed from this patient.", yes: "Delete", danger: true, onYes: () => { delDocData(d.id); upd((q) => { q.docs = q.docs.filter((x) => x.id !== d.id); }); } })}><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
        )}
      </Section>
      {view && <Sheet title={view.type} onClose={() => setView(null)}><img src={cache.current[view.id]} alt="Document" style={{ width: "100%", borderRadius: 10 }} /></Sheet>}
    </div>
  );
}

function PatientDetail({ p, S, t, nav, setNav, ptasks, onToggle, onOpen, upd, templates, onEdit, onArchive, onDelete, onAssign, onAdmit, askConfirm, saveTemplate, toast, cache, saveDocData, delDocData }) {
  useEffect(() => {
    if (!nav.focus) return;
    const id = setTimeout(() => { try { const el = document.getElementById(nav.focus); if (el) el.scrollIntoView({ block: "center", behavior: "smooth" }); } catch (e) { /* ignore */ } }, 80);
    return () => clearTimeout(id);
  }, [nav.ptab, nav.focus]);
  const open = ptasks.filter((k) => !k.done).length;
  const common = { p, S, t, upd };
  return (
    <div>
      <div style={{ padding: "12px 14px", background: "var(--sf)", borderBottom: "1px solid var(--ln)" }}>
        <div className="flex items-center gap-2">
          <button className="ec-btn sm" onClick={() => setNav({ ...nav, pid: null, focus: null })} aria-label="Back"><ArrowLeft size={18} /></button>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: 17, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</div>
            <div className="ec-mut" style={{ fontSize: 13 }}>{p.reg} · {p.age !== "" ? p.age + " y" : ""} {p.sex}{p.archived ? " · ARCHIVED" : ""}</div>
          </div>
          <Badge tone={open ? "today" : "done"}>{open} open</Badge>
        </div>
        <div className="ec-scroll" style={{ marginTop: 10 }}>
          {PTABS.map(([k, lb]) => <button key={k} className={`ec-chip ${nav.ptab === k ? "on" : ""}`} onClick={() => setNav({ ...nav, ptab: k, focus: null })}>{lb}</button>)}
        </div>
      </div>
      <div style={{ padding: 14 }}>
        {nav.ptab === "overview" && <OverviewTab {...common} ptasks={ptasks} onToggle={onToggle} onOpen={onOpen} onEdit={onEdit} onArchive={onArchive} onDelete={onDelete} onAssign={onAssign} onAdmit={onAdmit} />}
        {nav.ptab === "checklist" && <ChecklistTab {...common} />}
        {nav.ptab === "labs" && <LabsTab {...common} />}
        {nav.ptab === "consults" && <ConsultsTab {...common} />}
        {nav.ptab === "op" && <OpTab {...common} templates={templates} askConfirm={askConfirm} saveTemplate={saveTemplate} toast={toast} />}
        {nav.ptab === "discharge" && <DischargeTab {...common} templates={templates} askConfirm={askConfirm} saveTemplate={saveTemplate} toast={toast} />}
        {nav.ptab === "docs" && <DocsTab p={p} upd={upd} cache={cache} saveDocData={saveDocData} delDocData={delDocData} askConfirm={askConfirm} toast={toast} />}
      </div>
    </div>
  );
}

/* =====================================================================
   Operation schedule
   ===================================================================== */
function AssignOpSheet({ p, onSave, onClose }) {
  const t0 = today();
  const [d, setD] = useState({ opDate: p.opDate || "", opTime: p.opTime || "", plannedOp: p.plannedOp || "" });
  const [err, setErr] = useState("");
  const save = () => { if (!d.opDate) { setErr("Choose the operation date."); return; } onSave(d); };
  return (
    <Sheet lock title="Assign to operation list" onClose={onClose}>
      <div style={{ fontWeight: 700, marginBottom: 10 }}>{p.name} <span className="ec-mut">· {p.reg}</span></div>
      <Field label="Planned operation"><input className="ec-in" value={d.plannedOp} onChange={(e) => setD({ ...d, plannedOp: e.target.value })} /></Field>
      <div className="flex gap-2" style={{ marginBottom: 8 }}>
        {[["Today", 0], ["Tomorrow", 1], ["In 2 days", 2], ["In 1 week", 7]].map(([lb, n]) => <button key={lb} className={`ec-chip ${d.opDate === addDays(t0, n) ? "on" : ""}`} onClick={() => setD({ ...d, opDate: addDays(t0, n) })}>{lb}</button>)}
      </div>
      <div className="flex gap-2">
        <div style={{ flex: 1.3 }}><Field label="Operation date *"><input type="date" className="ec-in" value={d.opDate} onChange={(e) => setD({ ...d, opDate: e.target.value })} /></Field></div>
        <div style={{ flex: 1 }}><Field label="Time"><input type="time" className="ec-in" value={d.opTime} onChange={(e) => setD({ ...d, opTime: e.target.value })} /></Field></div>
      </div>
      <div className="ec-mut" style={{ fontSize: 13, marginBottom: 10 }}>Once assigned, the pre-op tasks (diagnosis and operation, date and time, medical instructions, consent, discharge note + ticket the day before, and the call reminder) appear in the task list.</div>
      {err && <div className="ec-err" style={{ marginBottom: 8 }}>{err}</div>}
      <div className="flex gap-2"><button className="ec-btn" style={{ flex: 1 }} onClick={onClose}>Cancel</button><button className="ec-btn pri" style={{ flex: 1 }} onClick={save}>Assign</button></div>
    </Sheet>
  );
}

function ScheduleScreen({ patients, S, t, onOpen, tasksBy, toast, onAssign }) {
  const act = patients.filter((p) => !p.archived && (p.listType || "admitted") === "admitted");
  const withOp = act.filter((p) => p.opDate).sort((a, b) => (a.opDate + (a.opTime || "")).localeCompare(b.opDate + (b.opTime || "")));
  const noOp = act.filter((p) => !p.opDate);
  const live = (p) => p.opStatus === "scheduled" || p.opStatus === "postponed";
  const groups = [
    ["Past date — update status", "overdue", withOp.filter((p) => live(p) && diffDays(p.opDate, t) < 0)],
    ["Today", "today", withOp.filter((p) => live(p) && diffDays(p.opDate, t) === 0)],
    ["Tomorrow", "soon", withOp.filter((p) => live(p) && diffDays(p.opDate, t) === 1)],
    ["Next 7 days", "soon", withOp.filter((p) => live(p) && diffDays(p.opDate, t) >= 2 && diffDays(p.opDate, t) <= 7)],
    ["Later", "upcoming", withOp.filter((p) => live(p) && diffDays(p.opDate, t) > 7)],
    ["Completed / cancelled", "done", withOp.filter((p) => !live(p))],
  ];
  const copyList = async () => {
    const list = withOp.filter((p) => p.opStatus === "scheduled" && diffDays(p.opDate, t) >= 0 && diffDays(p.opDate, t) <= 1);
    if (!list.length) { toast("No scheduled operations today or tomorrow"); return; }
    const lines = [`OR LIST — ${fmtDateY(t)}`, ""];
    list.forEach((p) => lines.push(`${fmtDate(p.opDate)} ${p.opTime || ""} — ${p.name} (${p.reg}), ${p.age}${p.sex}${p.diabetic ? ", DM" : ""}`, `   Dx: ${p.diagnosis || "—"}`, `   Op: ${p.plannedOp || "—"}`, `   Allergies: ${p.allergies || "—"}`, `   Open tasks: ${(tasksBy[p.id] || { n: 0 }).n}`, ""));
    toast((await copyText(lines.join("\n"))) ? "OR list copied (contains patient names)" : "Copy blocked here");
  };
  const Card = ({ p }) => {
    const ci = callInfo(p, S, t); const d = parseD(p.opDate); const near = live(p) && diffDays(p.opDate, t) >= 0 && diffDays(p.opDate, t) <= 2;
    const ph = p.phones.find((x) => x.trim()); const n = (tasksBy[p.id] || { n: 0 }).n;
    return (
      <div className="ec-card flex gap-3" style={{ borderColor: near ? "var(--td)" : "var(--ln)", borderWidth: near ? 2 : 1 }}>
        <div style={{ width: 56, flex: "none", textAlign: "center", background: "var(--sf2)", borderRadius: 10, padding: "6px 0", cursor: "pointer" }} onClick={() => onOpen(p.id)}>
          <div className="ec-mut" style={{ fontSize: 12, fontWeight: 700 }}>{d.toLocaleDateString("en-GB", { month: "short" })}</div>
          <div style={{ fontSize: 24, fontWeight: 800, lineHeight: 1.1 }}>{d.getDate()}</div>
          <div style={{ fontSize: 12, fontWeight: 700 }}>{p.opTime || "—"}</div>
        </div>
        <div className="flex-1" style={{ minWidth: 0 }}>
          <div style={{ cursor: "pointer" }} onClick={() => onOpen(p.id)}>
            <div style={{ fontWeight: 750 }}>{p.name}</div>
            <div className="ec-mut" style={{ fontSize: 13 }}>{p.reg} · {p.plannedOp || "operation not named"}</div>
          </div>
          <div className="flex flex-wrap gap-1 items-center" style={{ marginTop: 6 }}>
            <Badge tone={ci.tone}>{ci.text}</Badge>
            {p.opStatus !== "scheduled" && <Badge tone={p.opStatus === "completed" ? "done" : "today"}>{p.opStatus}</Badge>}
            {p.opStatus === "scheduled" && <Badge tone={n ? "today" : "done"}>{n ? `${n} open task${n > 1 ? "s" : ""}` : "Ready"}</Badge>}
          </div>
          {ph && live(p) && <a className="ec-btn sm" style={{ marginTop: 8 }} href={`tel:${ph.replace(/\s/g, "")}`}><Phone size={14} /> {ph}</a>}
        </div>
      </div>
    );
  };
  return (
    <div style={{ padding: 14 }}>
      <div className="flex items-center justify-between gap-2" style={{ marginBottom: 10 }}>
        <div className="ec-mut" style={{ fontSize: 13 }}>Operation list in date order. Highlighted = within 2 days.</div>
        <button className="ec-btn sm" onClick={copyList}><Copy size={14} /> Copy OR list</button>
      </div>
      {withOp.length === 0 && <Empty>No operations scheduled yet. Assign an admitted patient below.</Empty>}
      {groups.map(([label, tone, list]) => list.length > 0 && (
        <div key={label} style={{ marginBottom: 16 }}>
          <div className="flex items-center gap-2" style={{ marginBottom: 8 }}><span className="ec-dot" style={{ background: TONE[tone].c }} /><div style={{ fontWeight: 800, color: TONE[tone].c }}>{label}</div><div className="ec-mut" style={{ fontWeight: 700 }}>{list.length}</div></div>
          <div className="flex flex-col gap-2">{list.map((p) => <Card key={p.id} p={p} />)}</div>
        </div>
      ))}
      <div style={{ fontWeight: 800, margin: "6px 0 8px" }}>Admitted, not on the operation list ({noOp.length})</div>
      {noOp.length === 0 ? <Empty>Every admitted patient has an operation date.</Empty> : (
        <div className="flex flex-col gap-2">{noOp.map((p) => (
          <div key={p.id} className="ec-card flex items-center justify-between gap-2">
            <div style={{ minWidth: 0, cursor: "pointer" }} onClick={() => onOpen(p.id, "overview")}><b>{p.name}</b><div className="ec-mut" style={{ fontSize: 13 }}>{p.reg} · {p.diagnosis || "no diagnosis yet"}</div></div>
            <button className="ec-btn sm pri" onClick={() => onAssign(p)}>Assign</button>
          </div>))}</div>
      )}
    </div>
  );
}

/* =====================================================================
   Operation library
   ===================================================================== */
function TemplateEditor({ init, onSave, onClose }) {
  const [d, setD] = useState(init); const [err, setErr] = useState("");
  const set = (o) => setD({ ...d, ...o });
  const save = () => { if (!d.opType.trim() || !d.title.trim()) { setErr("Operation type and title are required."); return; } onSave(d); };
  return (
    <Sheet lock title={init.__new ? "New template" : "Edit template"} onClose={onClose}>
      <div className="ec-warn" style={{ marginBottom: 12 }}>Templates must not contain patient names, registration numbers or phone numbers.</div>
      <Field label="Type"><select className="ec-in" value={d.kind} onChange={(e) => set({ kind: e.target.value })}><option value="operative">Operative note</option><option value="discharge">Discharge note</option></select></Field>
      <Field label="Operation type"><input className="ec-in" value={d.opType} onChange={(e) => set({ opType: e.target.value })} /></Field>
      <Field label="Template title"><input className="ec-in" value={d.title} onChange={(e) => set({ title: e.target.value })} /></Field>
      {d.kind === "operative" ? (<>
        <Field label="Operative notes"><textarea className="ec-in" style={{ minHeight: 120 }} value={d.notes || ""} onChange={(e) => set({ notes: e.target.value })} /></Field>
        <Field label="Complications"><textarea className="ec-in" value={d.complications || ""} onChange={(e) => set({ complications: e.target.value })} /></Field>
        <Field label="Postoperative instructions"><textarea className="ec-in" value={d.postop || ""} onChange={(e) => set({ postop: e.target.value })} /></Field>
      </>) : (<>
        <Field label="Hospital course"><textarea className="ec-in" value={d.hospitalCourse || ""} onChange={(e) => set({ hospitalCourse: e.target.value })} /></Field>
        <Field label="Condition at discharge"><textarea className="ec-in" value={d.condition || ""} onChange={(e) => set({ condition: e.target.value })} /></Field>
        <Field label="Medications"><textarea className="ec-in" value={d.medications || ""} onChange={(e) => set({ medications: e.target.value })} /></Field>
        <Field label="Postoperative instructions"><textarea className="ec-in" value={d.postop || ""} onChange={(e) => set({ postop: e.target.value })} /></Field>
        <Field label="Follow-up plan"><textarea className="ec-in" value={d.followUp || ""} onChange={(e) => set({ followUp: e.target.value })} /></Field>
      </>)}
      {err && <div className="ec-err" style={{ marginBottom: 8 }}>{err}</div>}
      <button className="ec-btn pri" style={{ width: "100%" }} onClick={save}>Save template</button>
    </Sheet>
  );
}

function LibraryScreen({ templates, patients, setTemplates, askConfirm, applyToPatient, toast }) {
  const [q, setQ] = useState(""); const [kind, setKind] = useState("all"); const [edit, setEdit] = useState(null); const [use, setUse] = useState(null); const [pid, setPid] = useState("");
  const list = templates.filter((x) => (kind === "all" || x.kind === kind) && (!q || `${x.opType} ${x.title} ${x.notes || ""} ${x.hospitalCourse || ""}`.toLowerCase().includes(q.toLowerCase())));
  const byType = {}; list.forEach((x) => { (byType[x.opType] = byType[x.opType] || []).push(x); });
  const active = patients.filter((p) => !p.archived);
  return (
    <div style={{ padding: 14 }}>
      <div className="flex gap-2" style={{ marginBottom: 10 }}>
        <div style={{ position: "relative", flex: 1 }}>
          <Search size={18} className="ec-mut" style={{ position: "absolute", left: 12, top: 14 }} />
          <input className="ec-in" style={{ paddingLeft: 38 }} placeholder="Search templates" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <button className="ec-btn pri" onClick={() => setEdit({ __new: true, id: uid(), kind: "operative", opType: "", title: "", notes: "", complications: "", postop: "" })}><Plus size={18} /> New</button>
      </div>
      <div className="flex gap-2" style={{ marginBottom: 10 }}>
        {[["all", "All"], ["operative", "Operative notes"], ["discharge", "Discharge"]].map(([k, lb]) => <button key={k} className={`ec-chip ${kind === k ? "on" : ""}`} onClick={() => setKind(k)}>{lb}</button>)}
      </div>
      <div className="ec-warn" style={{ marginBottom: 12 }}>The starter templates are empty skeletons with headings only — no clinical content. Edit them to match your unit's practice.</div>
      {list.length === 0 && <Empty>No templates found.</Empty>}
      {Object.keys(byType).sort().map((ot) => (
        <div key={ot} style={{ marginBottom: 14 }}>
          <div style={{ fontWeight: 800, marginBottom: 6 }}>{ot}</div>
          <div className="flex flex-col gap-2">
            {byType[ot].map((x) => (
              <div key={x.id} className="ec-card">
                <div className="flex items-center justify-between gap-2"><b>{x.title}</b><Badge tone={x.kind === "operative" ? "soon" : "today"}>{x.kind === "operative" ? "Operative" : "Discharge"}</Badge></div>
                <div className="ec-mut" style={{ fontSize: 13, marginTop: 4, whiteSpace: "pre-wrap" }}>{((x.kind === "operative" ? x.notes : x.hospitalCourse) || "(empty)").slice(0, 110)}</div>
                <div className="flex flex-wrap gap-2" style={{ marginTop: 8 }}>
                  <button className="ec-btn sm pri" onClick={() => { setUse(x); setPid(""); }}>Use for patient</button>
                  <button className="ec-btn sm" onClick={() => setEdit(clone(x))}><Pencil size={14} /> Edit</button>
                  <button className="ec-btn sm dgr" onClick={() => askConfirm({ title: "Delete template?", body: `"${x.title}" will be removed from the library.`, yes: "Delete", danger: true, onYes: () => setTemplates((arr) => arr.filter((y) => y.id !== x.id)) })}><Trash2 size={14} /></button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
      {edit && <TemplateEditor init={edit} onClose={() => setEdit(null)} onSave={(d) => { const { __new, ...rest } = d; setTemplates((arr) => arr.some((y) => y.id === rest.id) ? arr.map((y) => (y.id === rest.id ? rest : y)) : [...arr, rest]); setEdit(null); toast("Template saved"); }} />}
      {use && (
        <Sheet title="Use template for patient" onClose={() => setUse(null)}>
          <div className="ec-mut" style={{ fontSize: 14, marginBottom: 10 }}>Template text is copied into the patient's record where fields are empty, then you can edit it. No personal information is copied between patients.</div>
          <Field label="Patient"><select className="ec-in" value={pid} onChange={(e) => setPid(e.target.value)}><option value="">Choose patient…</option>{active.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.reg})</option>)}</select></Field>
          <button className="ec-btn pri" style={{ width: "100%" }} disabled={!pid} onClick={() => { applyToPatient(pid, use); setUse(null); }}>Apply and open</button>
        </Sheet>
      )}
    </div>
  );
}

/* =====================================================================
   Settings & backup
   ===================================================================== */
function RuleRow({ r, onChange, onRemove }) {
  const [txt, setTxt] = useState(r.specs.join(", "));
  return (
    <div className="ec-card" style={{ marginBottom: 8, background: "var(--sf2)" }}>
      <div className="flex gap-2">
        <div style={{ flex: 1 }}><label className="ec-lbl">Age from (≥)</label><input className="ec-in" type="number" inputMode="numeric" value={r.minAge} onChange={(e) => onChange({ ...r, minAge: e.target.value })} /></div>
        <div style={{ flex: 1 }}><label className="ec-lbl">Age below (&lt;)</label><input className="ec-in" type="number" inputMode="numeric" value={r.maxAge} onChange={(e) => onChange({ ...r, maxAge: e.target.value })} /></div>
      </div>
      <label className="ec-lbl" style={{ marginTop: 8 }}>Consultations (comma separated)</label>
      <input className="ec-in" value={txt} onChange={(e) => setTxt(e.target.value)} onBlur={() => onChange({ ...r, specs: txt.split(",").map((s) => s.trim()).filter(Boolean) })} />
      <button className="ec-btn sm dgr" style={{ marginTop: 8 }} onClick={onRemove}><Trash2 size={14} /> Remove rule</button>
    </div>
  );
}

function SettingsScreen({ db, setSettings, storageOK, saveState, persisted, lastBackup, buildBackup, doImport, askConfirm, toast, applyDefaults, loadDemo, deleteDemo, resetAll, onNotifyTest }) {
  const S = db.settings;
  const [labTxt, setLabTxt] = useState(S.labs.join("\n")); const [dlabTxt, setDlabTxt] = useState(S.diabeticLabs.join("\n"));
  const [withDocs, setWithDocs] = useState(true); const [exp, setExp] = useState(null); const [impTxt, setImpTxt] = useState(""); const [busy, setBusy] = useState(false);
  const demoCount = db.patients.filter((p) => p.isDemo).length;
  const saveLabs = () => {
    const clean = (s) => { const seen = new Set(); return s.split("\n").map((x) => x.trim()).filter((x) => { if (!x) return false; const k = labKey(x); if (seen.has(k)) return false; seen.add(k); return true; }); };
    const a = clean(labTxt); const b = clean(dlabTxt).filter((x) => !a.some((y) => labKey(y) === labKey(x)));
    setSettings({ labs: a, diabeticLabs: b }); setLabTxt(a.join("\n")); setDlabTxt(b.join("\n")); toast("Lab lists saved (duplicates such as a second fasting glucose were removed)");
  };
  const makeExport = async () => {
    setBusy(true); const r = await buildBackup(withDocs); setExp(r); setBusy(false);
    try {
      const blob = new Blob([r.json], { type: "application/json" }); const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = `doctor-arwa-backup-${today()}.json`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 3000);
    } catch (e) { /* fallback is the copy box below */ }
  };
  const onFile = (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ""; if (!f) return; const fr = new FileReader(); fr.onload = () => doImport(String(fr.result)); fr.readAsText(f); };
  const Switch = ({ label, on, onClick }) => (
    <button className="flex items-center justify-between" style={{ width: "100%", minHeight: 50, background: "none", border: 0, color: "var(--ink)", fontWeight: 650, fontSize: 15, fontFamily: "inherit", cursor: "pointer" }} onClick={onClick}>
      {label}<span style={{ width: 50, height: 28, borderRadius: 99, background: on ? "var(--pri)" : "var(--ln)", position: "relative", display: "inline-block" }}><span style={{ position: "absolute", top: 3, left: on ? 25 : 3, width: 22, height: 22, borderRadius: 99, background: "#fff" }} /></span>
    </button>
  );
  return (
    <div style={{ padding: 14 }}>
      <div className="ec-card">
        <Switch label="Dark mode" on={S.dark} onClick={() => setSettings({ dark: !S.dark })} />
        <Switch label="Auto-archive after discharge + operative details" on={S.autoArchive} onClick={() => setSettings({ autoArchive: !S.autoArchive })} />
        <Field label="'Due soon' window (days)"><input className="ec-in" type="number" inputMode="numeric" value={S.soonDays} onChange={(e) => setSettings({ soonDays: Math.max(1, Number(e.target.value) || 1) })} /></Field>
        <Field label="Call patient this many days before operation"><input className="ec-in" type="number" inputMode="numeric" value={S.callLeadDays} onChange={(e) => setSettings({ callLeadDays: Math.max(1, Number(e.target.value) || 1) })} /></Field>
        <Field label="Default surgeon / responsible doctor (optional)"><input className="ec-in" value={S.defaultSurgeon} onChange={(e) => setSettings({ defaultSurgeon: e.target.value })} /></Field>
      </div>

      <Section title="Consultation rules">
        <div className="ec-warn" style={{ marginBottom: 8 }}>Local ward workflow defaults — not universal medical recommendations. Matching rules combine (a 10-year-old gets ENT and Pediatrics). Changes affect new patients and anyone you apply defaults to.</div>
        {S.consultRules.map((r) => <RuleRow key={r.id} r={r} onChange={(nr) => setSettings({ consultRules: S.consultRules.map((x) => (x.id === r.id ? nr : x)) })} onRemove={() => setSettings({ consultRules: S.consultRules.filter((x) => x.id !== r.id) })} />)}
        <button className="ec-btn sm" onClick={() => setSettings({ consultRules: [...S.consultRules, { id: uid(), minAge: 0, maxAge: 200, specs: [] }] })}><Plus size={14} /> Add rule</button>
      </Section>

      <Section title="Basic labs panel (one checklist item)">
        <div className="ec-warn" style={{ marginBottom: 8 }}>Each patient gets ONE item named "Basic labs"; this list is the panel it covers (shown as a reminder). Diabetic patients automatically get the extra tests below added to that same item. Workflow defaults only — follow local hospital protocols and the treating team's decisions. FBS is the fasting glucose test; don't add a second one.</div>
        <div className="ec-card">
          <Field label="Tests in the Basic labs panel (one per line)"><textarea className="ec-in" style={{ minHeight: 170 }} value={labTxt} onChange={(e) => setLabTxt(e.target.value)} /></Field>
          <Field label="Extra tests added to Basic labs for diabetic patients"><textarea className="ec-in" value={dlabTxt} onChange={(e) => setDlabTxt(e.target.value)} /></Field>
          <div className="flex flex-wrap gap-2">
            <button className="ec-btn pri" onClick={saveLabs}>Save lists</button>
            <button className="ec-btn" onClick={() => askConfirm({ title: "Add missing tests and consultations to all active patients?", body: "Missing lab tests and rule-based consultations are added to every active patient. Nothing is removed except rule-based consultations still 'Not requested' that no longer match.", yes: "Apply", onYes: applyDefaults })}>Apply to existing patients</button>
          </div>
        </div>
      </Section>

      <Section title="Reminders">
        <div className="ec-card">
          <div style={{ fontSize: 14, lineHeight: 1.5 }}>Call reminders are calculated automatically (operation date minus {S.callLeadDays} day) and shown on the dashboard when you open the app.</div>
          <button className="ec-btn" style={{ marginTop: 8 }} onClick={onNotifyTest}><Bell size={16} /> Send test notification</button>
          <div className="ec-warn" style={{ marginTop: 10 }}>
            <b>Honest limit:</b> as an installed web app, Doctor Arwa cannot fire timed alerts while it is closed. Reminders appear when you open the app, and the test button only works while the app is open. Reliable background alerts need a native Android wrapper (Capacitor) — a later upgrade. Until then, open Home or Tasks at the start of each shift.
          </div>
        </div>
      </Section>

      <Section title="Backup and restore">
        <div className="ec-card">
          <div className="flex items-center gap-2" style={{ marginBottom: 6 }}>
            <span className="ec-dot" style={{ background: storageOK ? "var(--ok)" : "var(--od)" }} />
            <div style={{ fontWeight: 700, fontSize: 14 }}>{storageOK ? `App storage active (${saveState === "saving" ? "saving…" : saveState === "error" ? "last save failed" : "saved"})` : "Storage unavailable — changes are lost when you close this"}</div>
          </div>
          <div className="ec-mut" style={{ fontSize: 12.5, marginBottom: 6 }}>Protected from automatic clearing by Chrome: {persisted === null ? "unknown" : persisted ? "yes" : "no — keep backups"} · Last backup: {lastBackup ? fmtStamp(lastBackup) : "never"}</div>
          <label className="flex items-center gap-2" style={{ minHeight: 46, fontWeight: 600 }}><input type="checkbox" style={{ width: 22, height: 22 }} checked={withDocs} onChange={(e) => setWithDocs(e.target.checked)} /> Include attached photos (larger file)</label>
          <button className="ec-btn pri" disabled={busy} onClick={makeExport}><Download size={16} /> {busy ? "Preparing…" : "Export backup (JSON)"}</button>
          {exp && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 13.5 }}>{exp.patients} patients, {exp.templates} templates, {exp.docsIncluded} photos included ({Math.round(exp.json.length / 1024)} KB).{exp.docsMissing > 0 && <b style={{ color: "var(--od)" }}> {exp.docsMissing} photo(s) could not be read and were NOT included.</b>}{!exp.withDocs && exp.docsTotal > 0 && <b style={{ color: "var(--td)" }}> {exp.docsTotal} photo(s) were deliberately left out.</b>}</div>
              <div className="ec-mut" style={{ fontSize: 12.5, margin: "4px 0 6px" }}>A download was started — check your phone's Downloads folder. If no file appears, copy the text below and save it in a note or file yourself.</div>
              <button className="ec-btn sm" onClick={async () => toast((await copyText(exp.json)) ? "Backup copied" : "Copy blocked — select the text manually")}><Copy size={14} /> Copy backup text</button>
              <textarea className="ec-in" readOnly style={{ marginTop: 8, fontSize: 11, minHeight: 90 }} value={exp.json.length > 400000 ? "(Backup is large — use the download, or export without photos to copy text.)" : exp.json} onFocus={(e) => e.target.select()} />
            </div>
          )}
          <div style={{ borderTop: "1px solid var(--ln)", marginTop: 14, paddingTop: 12 }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Import backup</div>
            <label className="ec-btn" style={{ width: "100%" }}><Upload size={16} /> Choose backup file<input type="file" accept=".json,application/json" style={{ display: "none" }} onChange={onFile} /></label>
            <div className="ec-mut" style={{ fontSize: 13, margin: "8px 0 4px" }}>…or paste backup text:</div>
            <textarea className="ec-in" value={impTxt} onChange={(e) => setImpTxt(e.target.value)} />
            <button className="ec-btn" style={{ marginTop: 8 }} disabled={!impTxt.trim()} onClick={() => doImport(impTxt)}>Check pasted backup</button>
            <div className="ec-mut" style={{ fontSize: 12.5, marginTop: 6 }}>The file is validated first. You will see a summary and must confirm before anything is replaced.</div>
          </div>
        </div>
      </Section>

      <Section title="Demo data">
        <div className="ec-card">
          <div style={{ fontSize: 14, marginBottom: 8 }}>{demoCount} fictional demo patient(s) currently stored.</div>
          <div className="flex flex-wrap gap-2">
            <button className="ec-btn" onClick={loadDemo}>Load demo patients</button>
            <button className="ec-btn dgr" disabled={!demoCount} onClick={() => askConfirm({ title: "Delete all demo patients?", body: "Only fictional demo patients are removed. Your own patients are untouched.", yes: "Delete demo", danger: true, onYes: deleteDemo })}>Delete all demo patients</button>
          </div>
          <button className="ec-btn dgr" style={{ marginTop: 10 }} onClick={() => askConfirm({ title: "Erase EVERYTHING?", body: "All patients, templates, settings and attached photos in this app will be permanently deleted. Export a backup first if you need one.", yes: "Erase all data", danger: true, onYes: resetAll })}><Trash2 size={16} /> Erase all data</button>
        </div>
      </Section>

      <Section title="What this prototype is — and is not">
        <div className="ec-card" style={{ fontSize: 13.5, lineHeight: 1.55 }}>
          <b>Privacy / security.</b> Stored data is not encrypted by Doctor Arwa and this app has not been security-certified. Do not use it for real patient records until it is rebuilt as a secured app and approved under your hospital's rules.<br /><br />
          <b>Storage.</b> Data is stored only on this phone (browser database, IndexedDB). Nothing is sent to a server. It is lost if you clear Chrome's site data, uninstall the app or lose the phone — export a backup regularly. Data is not encrypted by Doctor Arwa.<br /><br />
          <b>Offline.</b> After the first load the app is cached and works without internet. Updates download automatically the next time you open it online.<br /><br />
          <b>Photos.</b> Stored compressed on this phone, not uploaded anywhere. Backups include them only if you tick the box above.<br /><br />
          <b>Clinical content.</b> All rules, lists and templates are editable workflow defaults, not medical advice.
        </div>
      </Section>
    </div>
  );
}

/* =====================================================================
   Task sheet, Home (today's list), picker, image notes
   ===================================================================== */
function TaskSheet({ init, patients, onSave, onDelete, onOpenPatient, onClose }) {
  const [d, setD] = useState(init); const [err, setErr] = useState("");
  const set = (o) => setD({ ...d, ...o }); const isEdit = !!d.ref; const t0 = today();
  const save = () => { if (!d.title.trim()) { setErr("Enter a task title."); return; } onSave({ ...d, title: d.title.trim() }); };
  return (
    <Sheet lock title={isEdit ? "Edit task" : "Add task"} onClose={onClose}>
      <Field label="Task"><input className="ec-in" autoFocus value={d.title} placeholder="e.g. Study cornea chapter, check OR consumables" onChange={(e) => set({ title: e.target.value })} /></Field>
      <Field label="Patient (optional)">
        <select className="ec-in" disabled={isEdit} value={d.pid || ""} onChange={(e) => set({ pid: e.target.value })}>
          <option value="">No patient — general / shift / study task</option>
          {patients.filter((p) => !p.archived).map((p) => <option key={p.id} value={p.id}>{p.name} ({p.reg})</option>)}
        </select>
      </Field>
      <label className="ec-lbl">Due date and time (both optional — leave empty for a flexible task)</label>
      <div className="flex gap-2" style={{ marginBottom: 8 }}>
        <button className={`ec-chip ${d.due === t0 ? "on" : ""}`} onClick={() => set({ due: t0 })}>Today</button>
        <button className={`ec-chip ${d.due === addDays(t0, 1) ? "on" : ""}`} onClick={() => set({ due: addDays(t0, 1) })}>Tomorrow</button>
        <button className={`ec-chip ${!d.due ? "on" : ""}`} onClick={() => set({ due: "", time: "" })}>No date</button>
      </div>
      <div className="flex gap-2">
        <div style={{ flex: 1.3 }}><Field><input type="date" className="ec-in" value={d.due} onChange={(e) => set({ due: e.target.value })} /></Field></div>
        <div style={{ flex: 1 }}><Field><input type="time" className="ec-in" value={d.time} onChange={(e) => set({ time: e.target.value })} /></Field></div>
      </div>
      <Field label="Category"><select className="ec-in" value={d.cat} onChange={(e) => set({ cat: e.target.value })}>{TASK_CATS.map((c) => <option key={c}>{c}</option>)}</select></Field>
      <label className="flex items-center gap-2" style={{ minHeight: 46, fontWeight: 650 }}><input type="checkbox" style={{ width: 24, height: 24 }} checked={d.urgent} onChange={(e) => set({ urgent: e.target.checked })} /> Mark urgent</label>
      {err && <div className="ec-err" style={{ marginBottom: 8 }}>{err}</div>}
      <button className="ec-btn pri" style={{ width: "100%" }} onClick={save}>{isEdit ? "Save changes" : "Add task"}</button>
      {isEdit && (
        <div className="flex flex-wrap gap-2" style={{ marginTop: 10 }}>
          {d.pid && <button className="ec-btn" onClick={() => onOpenPatient(d.pid)}>Open patient record</button>}
          <button className="ec-btn dgr" onClick={() => onDelete(d)}><Trash2 size={16} /> Delete task</button>
        </div>
      )}
    </Sheet>
  );
}

function HomeScreen({ tasks, pins, t, S, onToggle, onOpen, onPin, onDelay, openPicker, openAdd, goTasks }) {
  const picked = tasks.filter((k) => pins.includes(k.id));
  const openL = picked.filter((k) => !k.done).sort(taskSort);
  const doneL = picked.filter((k) => k.done && doneToday(k, t));
  const total = openL.length + doneL.length; const pct = total ? Math.round((doneL.length / total) * 100) : 0;
  const hot = tasks.filter((k) => !k.done && !pins.includes(k.id) && ["overdue", "today"].includes(secOf(k.due, t, S.soonDays, k.time))).length;
  return (
    <div style={{ padding: 14 }}>
      <div className="ec-card" style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 20, fontWeight: 800 }}>Today's To-Do List</div>
        <div className="ec-mut" style={{ fontSize: 13.5 }}>{parseD(t).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}</div>
        <div style={{ height: 10, borderRadius: 99, background: "var(--ln)", margin: "10px 0 4px", overflow: "hidden" }}><div style={{ width: `${pct}%`, height: "100%", background: "var(--ok)" }} /></div>
        <div style={{ fontSize: 13, fontWeight: 650 }}>{doneL.length} of {total} done</div>
        <div className="flex gap-2" style={{ marginTop: 10 }}>
          <button className="ec-btn pri" style={{ flex: 1 }} onClick={openPicker}><ListChecks size={18} /> Select today's list</button>
          <button className="ec-btn" onClick={openAdd}><Plus size={18} /> Task</button>
        </div>
      </div>
      {total === 0 && <Empty>Your list is empty. Tap <b>Select today's list</b> to hand-pick tasks from your backlog, or add a new task.</Empty>}
      <div className="flex flex-col gap-2">{openL.map((k) => <TaskCard key={k.id} k={k} t={t} S={S} onToggle={onToggle} onOpen={onOpen} pinned onPin={onPin} onDelay={onDelay} />)}</div>
      {doneL.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontWeight: 800, color: "var(--ok)", marginBottom: 8 }}>Done today ({doneL.length})</div>
          <div className="flex flex-col gap-2">{doneL.map((k) => <TaskCard key={k.id} k={k} t={t} S={S} onToggle={onToggle} onOpen={onOpen} />)}</div>
        </div>
      )}
      {hot > 0 && <button className="ec-btn" style={{ width: "100%", marginTop: 16, color: "var(--td)" }} onClick={goTasks}><AlertTriangle size={16} /> {hot} overdue / due-today task{hot > 1 ? "s" : ""} not in this list — open Tasks</button>}
    </div>
  );
}

function TodayPicker({ tasks, pins, t, S, onSave, onClose }) {
  const [sel, setSel] = useState(() => new Set(pins)); const [q, setQ] = useState("");
  const open = tasks.filter((k) => !k.done);
  const list = open.filter((k) => !q || `${k.pname} ${k.reg} ${k.title}`.toLowerCase().includes(q.toLowerCase()));
  const toggle = (id) => { const n = new Set(sel); if (n.has(id)) n.delete(id); else n.add(id); setSel(n); };
  const hotIds = open.filter((k) => k.urgent || ["overdue", "today"].includes(secOf(k.due, t, S.soonDays, k.time))).map((k) => k.id);
  return (
    <Sheet lock title="Select today's to-do list" onClose={onClose}>
      <div className="flex gap-2" style={{ marginBottom: 10 }}>
        <button className="ec-btn" style={{ flex: 1 }} onClick={onClose}>Cancel</button>
        <button className="ec-btn pri" style={{ flex: 2 }} onClick={() => onSave([...sel].filter((id) => open.some((k) => k.id === id)))}>Save ({[...sel].filter((id) => open.some((k) => k.id === id)).length} selected)</button>
      </div>
      <div className="flex gap-2" style={{ marginBottom: 10 }}>
        <button className="ec-chip" onClick={() => setSel(new Set([...sel, ...hotIds]))}>+ Overdue, today &amp; urgent</button>
        <button className="ec-chip" onClick={() => setSel(new Set())}>Clear</button>
      </div>
      <input className="ec-in" style={{ marginBottom: 10 }} placeholder="Search backlog" value={q} onChange={(e) => setQ(e.target.value)} />
      {list.length === 0 && <Empty>No open tasks in the backlog.</Empty>}
      {SECTIONS.map(([key, label]) => {
        const g = list.filter((k) => secOf(k.due, t, S.soonDays, k.time) === key).sort(taskSort);
        if (!g.length) return null;
        return (
          <div key={key} style={{ marginBottom: 12 }}>
            <div style={{ fontWeight: 800, color: TONE[key].c, marginBottom: 6 }}>{label} ({g.length})</div>
            <div className="flex flex-col gap-2">{g.map((k) => {
              const on = sel.has(k.id);
              return (
                <button key={k.id} onClick={() => toggle(k.id)} className="ec-card flex items-center gap-3" style={{ textAlign: "left", cursor: "pointer", fontFamily: "inherit", color: "var(--ink)", borderColor: on ? "var(--pri)" : "var(--ln)", borderWidth: on ? 2 : 1, padding: 10 }}>
                  <span className={`ec-chk ${on ? "on" : ""}`} style={{ width: 32, height: 32, borderRadius: 8, background: on ? "var(--pri)" : "var(--sf)", borderColor: on ? "var(--pri)" : "var(--ln)", color: "var(--onpri)" }}>{on && <Check size={20} />}</span>
                  <span style={{ minWidth: 0 }}><span style={{ display: "block", fontWeight: 700, fontSize: 14.5 }}>{k.title}</span><span className="ec-mut" style={{ fontSize: 12.5 }}>{k.pname}{k.reg ? ` · ${k.reg}` : ""} · {dueLabel(k.due, t, k.time)}</span></span>
                </button>
              );
            })}</div>
          </div>
        );
      })}
    </Sheet>
  );
}

function NoteEditor({ init, saveDocData, delDocData, cache, onSave, onClose, toast }) {
  const [d, setD] = useState(() => clone(init)); const [busy, setBusy] = useState(false);
  const added = useRef([]); const removed = useRef([]);
  const addFiles = async (e) => {
    const files = Array.from(e.target.files || []); e.target.value = ""; if (!files.length) return;
    setBusy(true); let bad = 0;
    for (const f of files) {
      if (!f.type.startsWith("image/")) { bad++; continue; }
      try { const url = await compressImage(f); const id = uid(); const ok = await saveDocData(id, url); added.current.push(id); setD((prev) => ({ ...prev, imgs: [...prev.imgs, { id, addedAt: nowISO(), persisted: ok }] })); } catch (err) { bad++; }
    }
    setBusy(false); if (bad) toast(`${bad} file(s) skipped`);
  };
  const rm = (img) => { if (added.current.includes(img.id)) { added.current = added.current.filter((x) => x !== img.id); delDocData(img.id); } else removed.current.push(img.id); setD((prev) => ({ ...prev, imgs: prev.imgs.filter((x) => x.id !== img.id) })); };
  const cancel = () => { added.current.forEach(delDocData); onClose(); };
  const save = () => { if (!d.text.trim() && d.imgs.length === 0) { toast("Add some text or a photo first"); return; } removed.current.forEach(delDocData); onSave({ ...d, text: d.text.trim(), updatedAt: nowISO() }); };
  return (
    <Sheet lock title={init.__new ? "New image note" : "Edit image note"} onClose={cancel}>
      <Field label="Note"><textarea className="ec-in" style={{ minHeight: 100 }} value={d.text} placeholder="Reminder, idea, something to look up…" onChange={(e) => setD({ ...d, text: e.target.value })} /></Field>
      <label className="ec-btn pri" style={{ width: "100%", marginBottom: 10 }}><Camera size={18} /> {busy ? "Processing…" : "Take photos / add images"}<input type="file" accept="image/*" multiple style={{ display: "none" }} onChange={addFiles} disabled={busy} /></label>
      {d.imgs.length > 0 && <div className="grid grid-cols-2 gap-2" style={{ marginBottom: 12 }}>{d.imgs.map((im) => (
        <div key={im.id} className="ec-card" style={{ padding: 6 }}><DocThumb id={im.id} cache={cache} /><button className="ec-btn sm dgr" style={{ marginTop: 6 }} onClick={() => rm(im)}><Trash2 size={14} /></button></div>
      ))}</div>}
      <div className="ec-mut" style={{ fontSize: 12.5, marginBottom: 10 }}>Photos are compressed and kept in app storage only. Avoid photographing identifiable patient details unless that is allowed by your hospital.</div>
      <div className="flex gap-2"><button className="ec-btn" style={{ flex: 1 }} onClick={cancel}>Cancel</button><button className="ec-btn pri" style={{ flex: 1 }} onClick={save}>Save note</button></div>
    </Sheet>
  );
}

function NotesScreen({ notes, cache, saveDocData, delDocData, setNotes, askConfirm, toast }) {
  const [q, setQ] = useState(""); const [edit, setEdit] = useState(null); const [view, setView] = useState(null);
  const list = [...notes].filter((n) => !q || n.text.toLowerCase().includes(q.toLowerCase())).sort((a, b) => (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt));
  const fresh = () => setEdit({ __new: true, id: uid(), text: "", imgs: [], createdAt: nowISO() });
  return (
    <div style={{ padding: 14 }}>
      <div className="flex gap-2" style={{ marginBottom: 10 }}>
        <input className="ec-in" placeholder="Search notes" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="ec-btn pri" onClick={fresh}><Plus size={18} /> New</button>
      </div>
      <div className="ec-mut" style={{ fontSize: 13, marginBottom: 10 }}>A quick memo board: snap or upload one or more photos with a text note.</div>
      {list.length === 0 && <Empty>No image notes yet. Tap <b>New</b> to add one.</Empty>}
      <div className="flex flex-col gap-2">
        {list.map((n) => (
          <div key={n.id} className="ec-card">
            {n.imgs.length > 0 && <div className="grid grid-cols-3 gap-2" style={{ marginBottom: 8 }}>{n.imgs.map((im) => <DocThumb key={im.id} id={im.id} cache={cache} onClick={() => setView(im)} />)}</div>}
            {n.text && <div style={{ whiteSpace: "pre-wrap", fontSize: 15 }}>{n.text}</div>}
            <div className="ec-mut" style={{ fontSize: 12.5, marginTop: 6 }}>{fmtStamp(n.updatedAt || n.createdAt)}</div>
            <div className="flex gap-2" style={{ marginTop: 8 }}>
              <button className="ec-btn sm" onClick={() => setEdit(clone(n))}><Pencil size={14} /> Edit</button>
              <button className="ec-btn sm dgr" onClick={() => askConfirm({ title: "Delete this note?", body: "The note and its photos will be removed.", yes: "Delete", danger: true, onYes: () => { n.imgs.forEach((im) => delDocData(im.id)); setNotes((arr) => arr.filter((x) => x.id !== n.id)); } })}><Trash2 size={14} /></button>
            </div>
          </div>
        ))}
      </div>
      {edit && <NoteEditor init={edit} cache={cache} saveDocData={saveDocData} delDocData={delDocData} toast={toast} onClose={() => setEdit(null)} onSave={(d) => { const { __new, ...rest } = d; setNotes((arr) => (arr.some((x) => x.id === rest.id) ? arr.map((x) => (x.id === rest.id ? rest : x)) : [rest, ...arr])); setEdit(null); toast("Note saved"); }} />}
      {view && <Sheet title="Photo" onClose={() => setView(null)}><img src={cache.current[view.id]} alt="Note" style={{ width: "100%", borderRadius: 10 }} /></Sheet>}
    </div>
  );
}

/* =====================================================================
   App
   ===================================================================== */
export default function App() {
  const [db, setDb] = useState(null);
  const [storageOK, setStorageOK] = useState(true);
  const [saveState, setSaveState] = useState("saved");
  const [nav, setNav] = useState({ tab: "home", pid: null, ptab: "overview", focus: null });
  const [flt, setFlt] = useState({ q: "", sec: "all", cat: "all", pid: "all", by: "", done: false, open: false });
  const [form, setForm] = useState(null);
  const [conf, setConf] = useState(null);
  const [toastMsg, setToastMsg] = useState(null);
  const [t, setT] = useState(today());
  const [, setTick] = useState(0);
  const [taskForm, setTaskForm] = useState(null);
  const [handover, setHandover] = useState(false);
  const [assign, setAssign] = useState(null);
  const [picker, setPicker] = useState(false);
  const [lastBackup, setLastBackup] = useState(null);
  const [persisted, setPersisted] = useState(null);
  const undoRef = useRef(null);
  const cache = useRef({});
  const loaded = useRef(false);
  const notified = useRef(new Set());

  /* load */
  useEffect(() => {
    (async () => {
      store.get("eyecall:lastbackup").then((v) => { if (v) setLastBackup(v); });
      try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().then(setPersisted); } catch (e) { /* ignore */ }
      const raw = await store.get(DB_KEY);
      if (raw) {
        try { setDb(normalizeDb(JSON.parse(raw))); loaded.current = true; return; }
        catch (e) { await store.set(DB_KEY + ":corrupt:" + Date.now(), raw); }
      }
      const ok = await store.set("eyecall:probe", "1");
      setStorageOK(ok);
      const base = { settings: clone(DEFAULT_SETTINGS), patients: [], templates: clone(SEED_TEMPLATES), generalTasks: [], pins: [], notes: [] };
      base.patients = makeDemo(base.settings);
      base.generalTasks = makeDemoGeneral();
      base.pins = [`g|${base.generalTasks[0].id}`, `${base.patients[3].id}|call`];
      setDb(base); loaded.current = true;
    })();
  }, []);
  /* save (debounced) */
  useEffect(() => {
    if (!db || !loaded.current) return;
    setSaveState("saving");
    const id = setTimeout(async () => {
      const ok = await store.set(DB_KEY, JSON.stringify(db));
      setSaveState(ok ? "saved" : "error"); setStorageOK(ok);
    }, 500);
    return () => clearTimeout(id);
  }, [db]);
  /* clock tick so overdue status updates after midnight */
  useEffect(() => { const id = setInterval(() => { setT(today()); setTick((x) => x + 1); }, 60000); return () => clearInterval(id); }, []);
  /* toast timeout */
  useEffect(() => { if (!toastMsg) return; const id = setTimeout(() => setToastMsg(null), 6000); return () => clearTimeout(id); }, [toastMsg]);

  const toast = useCallback((msg, undo) => setToastMsg({ msg, undo: !!undo }), []);
  const mutate = useCallback((fn, opts = {}) => {
    setDb((prev) => { if (opts.undo) undoRef.current = prev; const next = clone(prev); fn(next); next.patients.forEach((p) => autoArchiveOne(p, next.settings)); return next; });
  }, []);
  /* patient-level update: clones ONLY the edited patient, so other patients keep their cached task lists (faster) */
  const updP = useCallback((pid, fn, opts = {}) => {
    setDb((prev) => {
      const i = prev.patients.findIndex((x) => x.id === pid); if (i < 0) return prev;
      if (opts.undo) undoRef.current = prev;
      const p = clone(prev.patients[i]); fn(p, prev); autoArchiveOne(p, prev.settings);
      const patients = prev.patients.slice(); patients[i] = p; return { ...prev, patients };
    });
  }, []);
  const askConfirm = useCallback((c) => setConf(c), []);

  const S = db ? db.settings : DEFAULT_SETTINGS;
  const patients = db ? db.patients : [];
  const allTasks = useMemo(() => [...patients.flatMap((p) => cachedDerive(p, S, t)), ...(db ? db.generalTasks : []).map(deriveGeneral)], [db, t]);
  const tasksBy = useMemo(() => { const m = {}; allTasks.forEach((k) => { if (k.done) return; const o = m[k.pid] || (m[k.pid] = { n: 0, od: 0 }); o.n++; if (secOf(k.due, t, S.soonDays, k.time) === "overdue") o.od++; }); return m; }, [allTasks, t]);

  /* auto-archive notice */
  useEffect(() => {
    if (!db || !loaded.current) return;
    const n = db.patients.find((p) => p.autoArchived && p.archived && p.archivedAt && Date.now() - new Date(p.archivedAt).getTime() < 10000 && !notified.current.has(p.id + p.archivedAt));
    if (n) { notified.current.add(n.id + n.archivedAt); setNav((x) => (x.pid === n.id ? { ...x, pid: null, focus: null } : x)); toast(`${n.name.split(" (")[0]} archived automatically (discharge + operative details done). Find them in Patients → Archived.`); }
  }, [db]);
  /* drop stale picks from today's list */
  useEffect(() => {
    if (!db || !loaded.current) return;
    const live = new Map(allTasks.map((k) => [k.id, k]));
    const stale = (db.pins || []).filter((id) => { const k = live.get(id); return !k || (k.done && !doneToday(k, t)); });
    if (stale.length) mutate((x) => { x.pins = x.pins.filter((id) => !stale.includes(id)); });
  }, [allTasks, t]);

  if (!db) return <div className="ec" style={{ padding: 30, textAlign: "center" }}><style>{CSS}</style>Loading Doctor Arwa…</div>;

  /* ---- task actions ---- */
  const openTask = (k) => {
    if (k.kind === "general" || k.kind === "custom") { setTaskForm({ ref: k.ref, pid: k.pid || "", title: k.title, due: k.due || "", time: k.time || "", cat: k.cat, urgent: !!k.urgent }); return; }
    setNav({ tab: "patients", pid: k.pid, ptab: k.tab, focus: k.focus || null });
  };
  const onToggle = (k) => {
    if (k.kind === "resched") { openTask(k); return; }
    if (k.kind === "general") {
      mutate((x) => { const g = x.generalTasks.find((y) => y.id === k.ref); if (g) { g.done = !k.done; g.doneAt = g.done ? nowISO() : ""; } }, { undo: true });
      toast(k.done ? "Task re-opened" : `Completed: ${k.title}`, true); return;
    }
    if (k.done) {
      if (["fixed", "custom", "call", "action"].includes(k.kind)) {
        updP(k.pid, (p) => {
          if (k.kind === "fixed") p.tasks[k.key] = { ...(p.tasks[k.key] || {}), done: false, doneAt: "" };
          else if (k.kind === "call") p.callDone = null;
          else if (k.kind === "custom") { const c = p.customTasks.find((x) => x.id === k.ref); if (c) { c.done = false; c.doneAt = ""; } }
          else { const c = p.consults.find((x) => x.id === k.ref); if (c) { c.actionDone = false; c.actionDoneAt = ""; } }
        }, { undo: true });
        toast("Task re-opened", true);
      } else openTask(k);
      return;
    }
    updP(k.pid, (p) => {
      const n = nowISO();
      if (k.kind === "fixed") p.tasks[k.key] = { ...(p.tasks[k.key] || {}), done: true, doneAt: n };
      else if (k.kind === "call") p.callDone = { forDate: p.opDate, doneAt: n };
      else if (k.kind === "custom") { const c = p.customTasks.find((x) => x.id === k.ref); if (c) { c.done = true; c.doneAt = n; } }
      else if (k.kind === "action") { const c = p.consults.find((x) => x.id === k.ref); if (c) { c.actionDone = true; c.actionDoneAt = n; } }
      else if (k.kind === "lab") {
        const l = p.labs.find((x) => x.id === k.ref); if (!l) return; const d0 = today();
        if (l.status === "not_ordered") { l.status = "ordered"; l.orderDate = d0; }
        else if (l.status === "ordered") { l.status = "result"; l.resultDate = d0; }
        else if (l.status === "result") { l.status = "reviewed"; l.reviewedAt = n; }
      } else if (k.kind === "consult") {
        const c = p.consults.find((x) => x.id === k.ref); if (!c) return;
        if (c.status === 0) { c.status = 1; c.reqDate = today(); }
        else if (c.status === 1) c.status = 2;
        else c.status = 4;
      }
    }, { undo: true });
    toast(k.kind === "lab" || k.kind === "consult" ? `Step done: ${k.title}. Next step (if any) is now in the list.` : `Completed: ${k.title}`, true);
  };

  /* ---- today's list, delay, tasks, assignment ---- */
  const pins = db.pins || [];
  const togglePin = (k) => mutate((x) => { const i = x.pins.indexOf(k.id); if (i >= 0) x.pins.splice(i, 1); else x.pins.push(k.id); });
  const delayTask = (k) => {
    const tomorrow = addDays(t, 1);
    if (k.due && k.due > tomorrow) { toast("This task is already due after tomorrow"); return; }
    mutate((x) => {
      if (k.kind === "general") { const g = x.generalTasks.find((y) => y.id === k.ref); if (g) { g.due = tomorrow; g.time = ""; } }
      else if (k.kind === "custom") { const p = x.patients.find((y) => y.id === k.pid); const c = p && p.customTasks.find((y) => y.id === k.ref); if (c) { c.due = tomorrow; c.time = ""; } }
      else { const p = x.patients.find((y) => y.id === k.pid); if (p) { if (!p.snooze) p.snooze = {}; p.snooze[k.id] = tomorrow; } }
      x.pins = x.pins.filter((i) => i !== k.id);
    }, { undo: true });
    toast(`Moved to tomorrow: ${k.title}`, true);
  };
  const saveTask = (d) => {
    const due = d.due || (d.time ? today() : "");
    const fields = { title: d.title, due, time: d.time || "", cat: d.cat, urgent: d.urgent };
    if (d.ref) {
      if (d.pid) updP(d.pid, (p) => { const c = p.customTasks.find((x) => x.id === d.ref); if (c) Object.assign(c, fields); });
      else mutate((x) => { const g = x.generalTasks.find((y) => y.id === d.ref); if (g) Object.assign(g, fields); });
      toast("Task updated");
    } else {
      const id = uid(); const task = { id, ...fields, done: false, doneAt: "" };
      const pinId = d.pid ? `${d.pid}|custom|${id}` : `g|${id}`;
      const pin = nav.tab === "home";
      if (d.pid) updP(d.pid, (p) => { p.customTasks.push(task); }); else mutate((x) => { x.generalTasks.push(task); });
      if (pin) mutate((x) => { x.pins.push(pinId); });
      toast(pin ? "Task added to today's list" : "Task added");
    }
    setTaskForm(null);
  };
  const deleteTask = (d) => askConfirm({
    title: "Delete this task?", body: d.title, yes: "Delete", danger: true,
    onYes: () => { if (d.pid) updP(d.pid, (p) => { p.customTasks = p.customTasks.filter((x) => x.id !== d.ref); }); else mutate((x) => { x.generalTasks = x.generalTasks.filter((y) => y.id !== d.ref); }); setTaskForm(null); toast("Task deleted"); },
  });
  const assignOp = (pid, d) => {
    updP(pid, (p) => {
      const old = p.opDate; if (p.opStatus !== "scheduled") p.opHistory.push({ at: nowISO(), type: "status", from: p.opStatus, to: "scheduled", reason: "Assigned to operation list" });
      p.opDate = d.opDate; p.opTime = d.opTime; if (d.plannedOp) p.plannedOp = d.plannedOp; p.opStatus = "scheduled";
      applyDateChange(p, old, "Assigned to operation list"); if (!p.opSetOn) p.opSetOn = today();
    });
    setAssign(null); toast("Added to the operation list — pre-op tasks created");
  };
  const admitPatient = (pid) => { updP(pid, (p) => { p.listType = "admitted"; p.admitDate = today(); ensureLabs(p, S); ensureConsults(p, S); }); toast("Patient admitted — admission tasks created"); };
  const allDocIds = () => [...patients.flatMap((p) => p.docs), ...(db.notes || []).flatMap((n) => n.imgs || [])].map((d) => d.id);

  /* ---- patients ---- */
  const savePatient = (d, isNew) => {
    mutate((db2) => {
      const SS = db2.settings;
      if (isNew) {
        const p = normalizePatient({ ...blankPatient(), ...d });
        if (p.opDate) { p.opHistory.push({ at: nowISO(), type: "date", from: "", to: p.opDate, reason: "Initial date" }); p.opSetOn = today(); }
        if (p.listType !== "waiting") { ensureLabs(p, SS); ensureConsults(p, SS); } db2.patients.push(p);
      } else {
        const p = db2.patients.find((x) => x.id === d.id); if (!p) return; const old = p.opDate;
        ["name", "reg", "phones", "age", "sex", "admitDate", "diagnosis", "plannedOp", "opDate", "opTime", "chronic", "diabetic", "allergies", "notes", "listType"].forEach((k) => { p[k] = d[k]; });
        applyDateChange(p, old, "Edited in patient details"); if (p.listType !== "waiting") { ensureLabs(p, SS); ensureConsults(p, SS); }
      }
    });
    setForm(null); toast(isNew ? "Patient added" : "Patient updated");
    if (isNew) setNav({ tab: "patients", pid: d.id, ptab: "overview", focus: null });
  };
  const deletePatient = (p) => askConfirm({
    title: `Delete ${p.name}?`, body: "This permanently removes the patient, all tasks, labs, consultations, notes and attached photos. This cannot be undone. Consider Archive instead.", yes: "Delete permanently", danger: true,
    onYes: () => { p.docs.forEach((d) => delDocData(d.id)); mutate((x) => { x.patients = x.patients.filter((y) => y.id !== p.id); }); setNav({ ...nav, pid: null }); toast("Patient deleted"); },
  });

  /* ---- documents ---- */
  const saveDocData = async (id, dataUrl) => { cache.current[id] = dataUrl; return store.set(DOC_PREFIX + id, JSON.stringify({ id, dataUrl })); };
  const delDocData = (id) => { delete cache.current[id]; store.del(DOC_PREFIX + id); };

  /* ---- templates ---- */
  const setTemplates = (fn) => mutate((x) => { x.templates = typeof fn === "function" ? fn(x.templates) : fn; });
  const saveTemplate = (tp) => setTemplates((arr) => [...arr, tp]);
  const applyToPatient = (pid, tp) => {
    updP(pid, (p) => {
      if (tp.kind === "operative") { ["notes", "complications", "postop"].forEach((k) => { if (!p.op[k] && tp[k]) p.op[k] = tp[k]; }); }
      else { ["hospitalCourse", "condition", "medications", "postop", "followUp"].forEach((k) => { if (!p.discharge[k] && tp[k]) p.discharge[k] = tp[k]; }); }
    });
    setNav({ tab: "patients", pid, ptab: tp.kind === "operative" ? "op" : "discharge", focus: null });
    toast("Template text added to empty fields — edit before use");
  };

  /* ---- settings / backup ---- */
  const setSettings = (o) => setDb((prev) => ({ ...prev, settings: { ...prev.settings, ...o } }));
  const setNotes = (fn) => mutate((x) => { x.notes = fn(x.notes); });
  const applyDefaults = () => { mutate((x) => { x.patients.forEach((p) => { if (!p.archived) { ensureLabs(p, x.settings); ensureConsults(p, x.settings); } }); }); toast("Defaults applied to active patients"); };
  const loadDemo = () => { mutate((x) => { x.patients.push(...makeDemo(x.settings)); x.generalTasks.push(...makeDemoGeneral()); }); toast("Demo patients added"); };
  const deleteDemo = () => { mutate((x) => { x.patients.filter((p) => p.isDemo).forEach((p) => p.docs.forEach((d) => delDocData(d.id))); x.patients = x.patients.filter((p) => !p.isDemo); x.generalTasks = x.generalTasks.filter((g) => !g.isDemo); }); setNav({ ...nav, pid: null }); toast("Demo patients deleted"); };
  const resetAll = () => {
    allDocIds().forEach(delDocData);
    setDb({ settings: clone(DEFAULT_SETTINGS), patients: [], templates: clone(SEED_TEMPLATES), generalTasks: [], pins: [], notes: [] }); setNav({ tab: "home", pid: null, ptab: "overview", focus: null }); toast("All data erased");
  };
  const buildBackup = async (withDocs) => {
    const docs = []; let missing = 0; let total = 0;
    for (const d of [...db.patients.flatMap((p) => p.docs), ...(db.notes || []).flatMap((n) => n.imgs || [])]) {
      total++;
      if (!withDocs) continue;
      let url = cache.current[d.id];
      if (!url) { const raw = await store.get(DOC_PREFIX + d.id); if (raw) { try { url = JSON.parse(raw).dataUrl; } catch (e) { /* skip */ } } }
      if (url) docs.push({ id: d.id, dataUrl: url }); else missing++;
    }
    const payload = { app: "DoctorArwa", schema: 2, exportedAt: nowISO(), includesDocuments: withDocs, settings: db.settings, patients: db.patients, templates: db.templates, generalTasks: db.generalTasks, pins: db.pins, notes: db.notes, documents: docs };
    const stamp = nowISO(); store.set("eyecall:lastbackup", stamp); setLastBackup(stamp);
    return { json: JSON.stringify(payload, null, 1), patients: db.patients.length, templates: db.templates.length, docsIncluded: docs.length, docsMissing: missing, docsTotal: total, withDocs };
  };
  const doImport = (text) => {
    let obj; try { obj = JSON.parse(text); } catch (e) { askConfirm({ title: "Not a valid backup", body: "The text could not be read as JSON. Nothing was changed.", yes: "OK", info: true }); return; }
    const v = validateBackup(obj);
    if (!v.ok) { askConfirm({ title: "Backup rejected", body: v.errors.slice(0, 5).join("\n") + "\n\nNothing was changed.", yes: "OK", info: true }); return; }
    askConfirm({
      title: "Replace ALL current data?", danger: true, yes: "Replace with backup",
      body: `Backup from ${obj.exportedAt ? fmtStamp(obj.exportedAt) : "unknown date"} contains ${v.db.patients.length} patients, ${v.db.templates.length} templates and ${v.docs.length} photos${obj.includesDocuments ? "" : " (photos were not included in this backup, so attachments will be empty)"}.\n\nEverything currently in the app will be overwritten.`,
      onYes: async () => {
        allDocIds().forEach(delDocData);
        for (const d of v.docs) await saveDocData(d.id, d.dataUrl);
        setDb(v.db); setNav({ tab: "home", pid: null, ptab: "overview", focus: null }); toast("Backup restored");
      },
    });
  };
  const onNotify = async (calls) => {
    const msg = calls && calls.length ? `${calls.length} patient call(s) due: ${calls.map((c) => c.pname.split(" (")[0]).join(", ")}` : "This is a test reminder from Doctor Arwa.";
    const r = await demoNotify(msg);
    toast(r === "sent" ? "System notification sent (only works while the app is open)" : "System notifications are blocked here — in-app alerts only");
  };

  const curP = nav.pid ? patients.find((p) => p.id === nav.pid) : null;
  const goTab = (tab) => setNav({ tab, pid: null, ptab: "overview", focus: null });
  const NAV = [["home", "Home", Home], ["dash", "Tasks", ListChecks], ["patients", "Patients", Users], ["schedule", "Op List", CalendarDays], ["library", "Library", BookOpen], ["notes", "Notes", ImageIcon], ["settings", "Settings", SettingsIcon]];
  const dateStr = parseD(t).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  const heading = { home: "Today", dash: "All tasks", patients: "Patients", schedule: "Operation list", library: "Library", notes: "Image notes", settings: "Settings" }[nav.tab];

  return (
    <div className={`ec ${S.dark ? "dk" : ""}`} style={{ paddingBottom: 80 }}>
      <style>{CSS}</style>
      <div style={{ maxWidth: 520, margin: "0 auto", minHeight: "100vh" }}>
        <div className="ec-head">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="14" fill="none" stroke="currentColor" strokeWidth="2.5" /><circle cx="16" cy="16" r="7" fill="currentColor" /><circle cx="19" cy="13" r="2.2" fill="var(--pri)" /></svg>
              <div>
                <div style={{ fontWeight: 800, fontSize: 18, lineHeight: 1.1 }}>Doctor Arwa <span style={{ fontWeight: 500, fontSize: 13, opacity: 0.85 }}>· {heading}</span></div>
                <div style={{ fontSize: 12, opacity: 0.85 }}>{dateStr} · {storageOK ? (saveState === "saving" ? "saving…" : saveState === "error" ? "save failed" : "saved") : "NOT SAVED (no storage)"}</div>
              </div>
            </div>
            <button onClick={() => setSettings({ dark: !S.dark })} aria-label="Toggle dark mode" style={{ background: "rgba(255,255,255,.18)", border: 0, color: "inherit", width: 42, height: 42, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>{S.dark ? <Sun size={20} /> : <Moon size={20} />}</button>
          </div>
        </div>

        {(() => {
          const real = patients.some((p) => !p.isDemo); if (!real) return null;
          const days = lastBackup ? diffDays(t, ymd(new Date(lastBackup))) : null; if (days !== null && days < 7) return null;
          return <div className="ec-warn" style={{ margin: 12 }}><AlertTriangle size={14} style={{ display: "inline" }} /> {days === null ? "You have never exported a backup." : `Your last backup was ${days} days ago.`} <button className="ec-btn sm" style={{ marginLeft: 8 }} onClick={() => goTab("settings")}>Back up now</button></div>;
        })()}
        {!storageOK && <div className="ec-warn" style={{ margin: 12 }}><AlertTriangle size={14} style={{ display: "inline" }} /> Storage is unavailable in this browser (private mode?). The app works, but everything resets when you close it.</div>}

        {nav.tab === "home" && <HomeScreen tasks={allTasks} pins={pins} t={t} S={S} onToggle={onToggle} onOpen={openTask} onPin={togglePin} onDelay={delayTask} openPicker={() => setPicker(true)} openAdd={() => setTaskForm({ ref: null, pid: "", title: "", due: "", time: "", cat: "Other", urgent: false })} goTasks={() => goTab("dash")} />}
        {nav.tab === "dash" && <Dashboard tasks={allTasks} patients={patients} t={t} S={S} flt={flt} setFlt={setFlt} onToggle={onToggle} onOpen={openTask} onNotify={onNotify} openAdd={() => setForm({})} onHandover={() => setHandover(true)} pins={pins} onPin={togglePin} onDelay={delayTask} />}
                {nav.tab === "patients" && !curP && <PatientsScreen patients={patients} tasksBy={tasksBy} t={t} S={S} openAdd={() => setForm({})} onOpen={(id) => setNav({ tab: "patients", pid: id, ptab: "overview", focus: null })} />}
        {nav.tab === "patients" && curP && (
          <PatientDetail p={curP} S={S} t={t} nav={nav} setNav={setNav} ptasks={allTasks.filter((k) => k.pid === curP.id)} onToggle={onToggle} onOpen={openTask}
            upd={(fn, o) => updP(curP.id, fn, o)} templates={db.templates} askConfirm={askConfirm} saveTemplate={saveTemplate} toast={toast}
            cache={cache} saveDocData={saveDocData} delDocData={delDocData}
            onEdit={() => setForm({ p: curP })} onAssign={() => setAssign(curP)} onAdmit={() => admitPatient(curP.id)}
            onArchive={() => { updP(curP.id, (p) => { p.archived = !p.archived; if (p.archived) { p.archivedAt = nowISO(); p.autoArchived = false; } else { p.noAutoArchive = true; p.autoArchived = false; } }); toast(curP.archived ? "Patient restored" : "Patient archived — tasks hidden from the master list"); }}
            onDelete={() => deletePatient(curP)} />
        )}
        {nav.tab === "schedule" && <ScheduleScreen patients={patients} S={S} t={t} tasksBy={tasksBy} toast={toast} onAssign={(p) => setAssign(p)} onOpen={(id, ptab) => setNav({ tab: "patients", pid: id, ptab: ptab || "op", focus: null })} />}
                {nav.tab === "library" && <LibraryScreen templates={db.templates} patients={patients} setTemplates={setTemplates} askConfirm={askConfirm} applyToPatient={applyToPatient} toast={toast} />}
        {nav.tab === "notes" && <NotesScreen notes={db.notes || []} cache={cache} saveDocData={saveDocData} delDocData={delDocData} setNotes={setNotes} askConfirm={askConfirm} toast={toast} />}
        {nav.tab === "settings" && <SettingsScreen db={db} setSettings={setSettings} storageOK={storageOK} saveState={saveState} persisted={persisted} lastBackup={lastBackup} buildBackup={buildBackup} doImport={doImport} askConfirm={askConfirm} toast={toast} applyDefaults={applyDefaults} loadDemo={loadDemo} deleteDemo={deleteDemo} resetAll={resetAll} onNotifyTest={() => onNotify(null)} />}
      </div>

      {nav.tab === "patients" && !curP && <button className="ec-fab" aria-label="Add patient" onClick={() => setForm({})}><Plus size={28} /></button>}

      {(nav.tab === "dash" || nav.tab === "home") && <button className="ec-fab" aria-label="Add task" onClick={() => setTaskForm({ ref: null, pid: "", title: "", due: "", time: "", cat: "Other", urgent: false })}><Plus size={28} /></button>}

      <div className="ec-nav">
        {NAV.map(([k, lb, Icon]) => (
          <button key={k} className={nav.tab === k ? "on" : ""} onClick={() => goTab(k)}>
            <span style={{ position: "relative" }}><Icon size={22} />{k === "dash" && allTasks.some((x) => !x.done && secOf(x.due, t, S.soonDays, x.time) === "overdue") && <span className="ec-dot" style={{ position: "absolute", top: -3, right: -6, background: "var(--od)", width: 9, height: 9 }} />}</span>
            {lb}
          </button>
        ))}
      </div>

      {form && <PatientForm initial={form.p || null} all={patients} onSave={savePatient} onClose={() => setForm(null)} />}

      {taskForm && <TaskSheet init={taskForm} patients={patients} onClose={() => setTaskForm(null)} onSave={saveTask} onDelete={deleteTask} onOpenPatient={(pid) => { setTaskForm(null); setNav({ tab: "patients", pid, ptab: "checklist", focus: null }); }} />}
      {assign && <AssignOpSheet p={assign} onClose={() => setAssign(null)} onSave={(d) => assignOp(assign.id, d)} />}
      {picker && <TodayPicker tasks={allTasks} pins={pins} t={t} S={S} onClose={() => setPicker(false)} onSave={(ids) => { mutate((x) => { x.pins = ids; }); setPicker(false); toast(`Today's list saved (${ids.length} tasks)`); }} />}
      {handover && (
        <Sheet title="Handover list" onClose={() => setHandover(false)}>
          <div className="ec-warn" style={{ marginBottom: 10 }}>Contains patient names and numbers. Share only through channels your hospital allows.</div>
          <textarea className="ec-in" readOnly style={{ minHeight: 280, fontSize: 13 }} value={handoverText(patients, allTasks, S, t)} onFocus={(e) => e.target.select()} />
          <button className="ec-btn pri" style={{ width: "100%", marginTop: 8 }} onClick={async () => toast((await copyText(handoverText(patients, allTasks, S, t))) ? "Handover copied" : "Copy blocked — select the text manually")}><Copy size={16} /> Copy handover</button>
        </Sheet>
      )}
      {conf && (
        <div className="ec-sheet" style={{ alignItems: "center", zIndex: 70 }} onClick={() => setConf(null)}>
          <div style={{ borderRadius: 18, maxWidth: 420, width: "92%", padding: 18 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 8, color: conf.danger ? "var(--od)" : "var(--ink)" }}>{conf.title}</div>
            <div style={{ fontSize: 14.5, lineHeight: 1.5, whiteSpace: "pre-wrap", marginBottom: 16 }}>{conf.body}</div>
            <div className="flex gap-2">
              {!conf.info && <button className="ec-btn" style={{ flex: 1 }} onClick={() => setConf(null)}>Cancel</button>}
              <button className={`ec-btn ${conf.danger ? "dgr" : "pri"}`} style={{ flex: 1 }} onClick={() => { const c = conf; setConf(null); if (c.onYes) c.onYes(); }}>{conf.yes || "OK"}</button>
            </div>
          </div>
        </div>
      )}

      {toastMsg && (
        <div className="ec-toast" role="status">
          <span>{toastMsg.msg}</span>
          {toastMsg.undo && <button onClick={() => { if (undoRef.current) setDb(undoRef.current); setToastMsg(null); }}>Undo</button>}
        </div>
      )}
    </div>
  );
}
