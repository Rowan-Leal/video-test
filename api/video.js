export const config = { runtime: "nodejs" };

import fetch from "node-fetch";

const BASE = "https://apihub.agnes-ai.com";
const MODEL = "agnes-video-2.5-flash";
const RATIOS = ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"];

const SUPA_URL = process.env.SUPABASE_URL || "";
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SUPA_BUCKET = process.env.SUPABASE_BUCKET || "nuojiji-images";

function readRaw(req) {
  return new Promise((resolve) => {
    const chunks = [];
    let done = false;
    const fin = () => { if (!done) { done = true; resolve(Buffer.concat(chunks)); } };
    req.on("data", (c) => chunks.push(Buffer.from(c)));
    req.on("end", fin);
    req.on("error", fin);
    setTimeout(fin, 3000);
  });
}

function parseMultipart(buf, boundary) {
  const parts = [];
  const d = Buffer.from(`--${boundary}`);
  let pos = buf.indexOf(d);
  while (pos !== -1) {
    const s = pos + d.length;
    if (buf.slice(s, s + 2).toString() === "--") break;
    let hs = s;
    if (buf.slice(hs, hs + 2).toString() === "\r\n") hs += 2;
    const he = buf.indexOf(Buffer.from("\r\n\r\n"), hs);
    if (he === -1) break;
    const headers = buf.slice(hs, he).toString("utf8");
    const bs = he + 4;
    const nxt = buf.indexOf(d, bs);
    let be = nxt === -1 ? buf.length : nxt;
    if (be - 2 >= bs && buf.slice(be - 2, be).toString() === "\r\n") be -= 2;
    parts.push({ headers, content: buf.slice(bs, be) });
    pos = nxt;
  }
  return parts;
}

async function uploadBuf(buf, mime) {
  if (!SUPA_URL || !SUPA_KEY) return null;
  const clean = String(mime || "image/png").split(";")[0].trim();
  const ext = (clean.split("/")[1] || "png").split("+")[0].toLowerCase();
  const path = `agnes/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const up = await fetch(`${SUPA_URL}/storage/v1/object/${SUPA_BUCKET}/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SUPA_KEY}`,
      "Content-Type": clean,
      "x-upsert": "true"
    },
    body: buf
  });
  if (!up.ok) return null;
  return `${SUPA_URL}/storage/v1/object/public/${SUPA_BUCKET}/${path}`;
}

async function toPublic(v) {
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  const m = v.match(/^data:(image|audio)\/([a-zA-Z0-9+.-]+);base64,(.+)$/);
  if (!m) return null;
  return uploadBuf(Buffer.from(m[3], "base64"), `${m[1]}/${m[2]}`);
}

function pickRatio(b) {
  const r = String(b.aspect_ratio || b.ratio || "");
  if (RATIOS.includes(r)) return r;
  const s = String(b.size || b.resolution || "");
  const m = s.match(/(\d+)\s*[x×*]\s*(\d+)/i);
  if (m) {
    const w = Number(m[1]), h = Number(m[2]);
    if (w && h) {
      const t = w / h;
      let best = "16:9", diff = 99;
      for (const k of RATIOS) {
        const [a, c] = k.split(":").map(Number);
        const dd = Math.abs(t - a / c);
        if (dd < diff) { diff = dd; best = k; }
      }
      return best;
    }
  }
  if (/竖|portrait|vertical/i.test(s)) return "9:16";
  if (/方|square/i.test(s)) return "1:1";
  return "16:9";
}

function pickSeconds(b) {
  let n = Number(b.seconds ?? b.duration ?? b.duration_seconds ?? 5);
  if (!Number.isFinite(n) || n <= 0) n = 5;
  n = Math.round(n);
  if (n < 4) n = 4;
  if (n > 12) n = 12;
  return String(n);
}

function longestStr(obj, depth, best) {
  if (depth > 5 || obj == null) return best;
  if (typeof obj === "string") {
    const s = obj.trim();
    if (s.length > best.length && s.length < 2000 && !/^data:/i.test(s) && !/^https?:\/\//i.test(s)) return s;
    return best;
  }
  if (Array.isArray(obj)) { for (const v of obj) best = longestStr(v, depth + 1, best); return best; }
  if (typeof obj === "object") { for (const k in obj) best = longestStr(obj[k], depth + 1, best); return best; }
  return best;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Expose-Headers", "*");
  res.setHeader("Access-Control-Max-Age", "86400");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method === "GET") {
    return res.status(200).json({ ok: true, v: 6, model: MODEL, time: new Date().toISOString() });
  }

  try {
    const ct = String(req.headers["content-type"] || "");
    const fields = {};
    const images = [];

    if (/multipart\/form-data/i.test(ct)) {
      const buf = Buffer.isBuffer(req.body) ? req.body : await readRaw(req);
      const bm = ct.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
      const boundary = bm ? (bm[1] || bm[2]).trim() : "";
      const parts = boundary ? parseMultipart(buf, boundary) : [];
      for (const p of parts) {
        const nm = (p.headers.match(/name="([^"]*)"/i) || [])[1];
        const fn = (p.headers.match(/filename="([^"]*)"/i) || [])[1];
        const pc = ((p.headers.match(/Content-Type:\s*([^\r\n]+)/i) || [])[1] || "").trim();
        if (!nm) continue;
        if (fn || /^image\//i.test(pc)) {
          const u = await uploadBuf(p.content, pc || "image/png");
          if (u) images.push(u);
        } else {
          fields[nm] = p.content.toString("utf8").trim();
        }
      }
    } else {
      let raw = req.body;
      if (Buffer.isBuffer(raw)) raw = raw.toString("utf8");
      if (typeof raw === "string") { try { raw = JSON.parse(raw); } catch { raw = {}; } }
      Object.assign(fields, raw || {});
      if (Array.isArray(fields.images)) {
        for (const it of fields.images.slice(0, 5)) {
          const u = await toPublic(typeof it === "string" ? it : (it && (it.url || it.image_url)));
          if (u) images.push(u);
        }
      }
      const one = await toPublic(typeof fields.image === "string" ? fields.image : (fields.image && fields.image.url));
      if (one) images.push(one);
    }

    let auth = String(req.headers.authorization || "");
    if (auth && !/^bearer\s/i.test(auth)) auth = `Bearer ${auth}`;
    if (!auth && process.env.AGNES_API_KEY) auth = `Bearer ${process.env.AGNES_API_KEY}`;
    if (!auth) return res.status(401).json({ error: "缺少 Authorization / AGNES_API_KEY" });

    let prompt = String(fields.prompt || fields.input || fields.text || fields.description || fields.caption || "").trim();
    if (!prompt) prompt = longestStr(fields, 0, "").trim();
    if (!prompt) return res.status(400).json({ error: "没拿到提示词", d: { f: Object.keys(fields) } });

    const payload = {
      model: MODEL,
      prompt,
      mode: "text",
      size: "720P",
      aspect_ratio: pickRatio(fields),
      seconds: pickSeconds(fields)
    };

    const ff = await toPublic(fields.first_frame || fields.firstFrame);
    const lf = await toPublic(fields.last_frame || fields.lastFrame);

    if (ff || lf) {
      payload.mode = "keyframe";
      if (ff) payload.first_frame = ff;
      if (lf) payload.last_frame = lf;
    } else if (images.length) {
      payload.mode = "reference";
      payload.images = images.slice(0, 5);
    }

    let subStatus = 0;
    let subData = null;

    for (let attempt = 0; attempt < 3; attempt++) {
      const sub = await fetch(`${BASE}/v1/videos`, {
        method: "POST",
        headers: { Authorization: auth, "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      subStatus = sub.status;
      const t = await sub.text();
      try { subData = JSON.parse(t); } catch { subData = { message: t }; }
      const blob = JSON.stringify(subData || {});
      if (sub.ok || !/queue.?is.?full|video_queue_full/i.test(blob)) break;
      if (attempt < 2) await new Promise(r => setTimeout(r, 4000));
    }

    if (subStatus >= 400) {
      const msg = String((subData && (subData.message || subData.error)) || "");
      if (/queue is full/i.test(msg)) {
        return res.status(503).json({ error: "Agnes 排队已满，等 2-5 分钟再点一次生成就好" });
      }
      return res.status(subStatus).json({ stage: "agnes", d: subData });
    }

    const vid = subData.video_id || subData.id || subData.task_id;
    if (!vid) return res.status(500).json({ error: "Agnes 未返回任务 ID", d: subData });

    const deadline = Date.now() + 45000;
    let final = null;
    while (Date.now() < deadline) {
      const q = await fetch(
        `${BASE}/agnesapi?video_id=${encodeURIComponent(vid)}&model_name=${MODEL}`,
        { headers: { Authorization: auth } }
      );
      const qt = await q.text();
      let qd = null;
      try { qd = JSON.parse(qt); } catch {}
      if (qd && (qd.status === "completed" || qd.status === "failed")) { final = qd; break; }
      await new Promise(r => setTimeout(r, 2000));
    }

    const done = final && final.status === "completed";
    const url = done ? (final.url || final.video_url || "") : "";
    const st = final ? final.status : "processing";

    return res.status(200).json({
      id: vid,
      object: "video",
      model: MODEL,
      status: st,
      progress: final ? (final.progress || 0) : 0,
      url,
      video_url: url,
      seconds: payload.seconds,
      size: "720P",
      aspect_ratio: payload.aspect_ratio,
      mode: payload.mode,
      data: url ? [{ url, video_url: url }] : [],
      detail: st === "processing" ? "生成中，等 1 分钟再点一次生成" : undefined
    });

  } catch (err) {
    return res.status(500).json({ error: `中转失败: ${err.message}` });
  }
}
