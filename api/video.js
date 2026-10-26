export const config = { runtime: "nodejs" };

import fetch from "node-fetch";

const BASE = "https://apihub.agnes-ai.com";
const MODEL = "agnes-video-2.5-flash";
const RATIOS = ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"];

const SUPA_URL = process.env.SUPABASE_URL || "";
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SUPA_BUCKET = process.env.SUPABASE_BUCKET || "nuojiji-images";

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
        const d = Math.abs(t - a / c);
        if (d < diff) { diff = d; best = k; }
      }
      return best;
    }
  }
  if (/竖|portrait|vertical/i.test(s)) return "9:16";
  if (/方|square/i.test(s)) return "1:1";
  return "16:9";
}

function pickSeconds(b) {
  let n = Number(b.seconds ?? b.duration ?? b.duration_seconds ?? b.seconds_total ?? 5);
  if (!Number.isFinite(n) || n <= 0) n = 5;
  n = Math.round(n);
  if (n < 4) n = 4;
  if (n > 12) n = 12;
  return String(n);
}

function pickImg(x) {
  if (!x) return null;
  if (typeof x === "string") return x;
  if (typeof x === "object") return x.url || x.image_url || null;
  return null;
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

async function toPublic(v) {
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  const m = v.match(/^data:(image|audio)\/([a-zA-Z0-9+.-]+);base64,(.+)$/);
  if (!m || !SUPA_URL || !SUPA_KEY) return null;
  const kind = m[1];
  const subtype = m[2].split("+")[0].toLowerCase();
  const path = `agnes/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${subtype}`;
  const up = await fetch(`${SUPA_URL}/storage/v1/object/${SUPA_BUCKET}/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SUPA_KEY}`,
      "Content-Type": `${kind}/${m[2]}`,
      "x-upsert": "true"
    },
    body: Buffer.from(m[3], "base64")
  });
  if (!up.ok) return null;
  return `${SUPA_URL}/storage/v1/object/public/${SUPA_BUCKET}/${path}`;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Expose-Headers", "*");
  res.setHeader("Access-Control-Max-Age", "86400");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method === "GET") {
    return res.status(200).json({ ok: true, v: 4, model: MODEL, time: new Date().toISOString() });
  }

  try {
    let raw = req.body;
    if (Buffer.isBuffer(raw)) raw = raw.toString("utf8");
    const rawStr = typeof raw === "string" ? raw : JSON.stringify(raw || {});
    let body = {};
    if (typeof raw === "string") { try { body = JSON.parse(raw); } catch { body = {}; } }
    else if (raw && typeof raw === "object") { body = raw; }

    let auth = String(req.headers.authorization || "");
    if (auth && !/^bearer\s/i.test(auth)) auth = `Bearer ${auth}`;
    if (!auth && process.env.AGNES_API_KEY) auth = `Bearer ${process.env.AGNES_API_KEY}`;
    if (!auth) return res.status(401).json({ error: "缺少 Authorization / AGNES_API_KEY" });

    let prompt = String(body.prompt || body.input || body.text || body.description || body.caption || body.query || "").trim();

    if (!prompt && Array.isArray(body.messages)) {
      const last = body.messages[body.messages.length - 1];
      prompt = String((last && last.content) || "").trim();
    }
    if (!prompt) prompt = longestStr(body, 0, "").trim();
    if (!prompt && rawStr) {
      const m = rawStr.match(/name="(?:prompt|input|text)"\s*(?:;[^\r\n]*)?\r?\n\r?\n([\s\S]*?)\r?\n--/i);
      if (m) prompt = m[1].trim();
    }

    if (!prompt) {
      return res.status(400).json({
        error: "没收到提示词，把这段截图发给开发者",
        keys: Object.keys(body),
        ct: String(req.headers["content-type"] || ""),
        sample: rawStr.slice(0, 600)
      });
    }

    const payload = {
      model: MODEL,
      prompt,
      mode: "text",
      size: "720P",
      aspect_ratio: pickRatio(body),
      seconds: pickSeconds(body)
    };

    const ff = await toPublic(pickImg(body.first_frame || body.firstFrame));
    const lf = await toPublic(pickImg(body.last_frame || body.lastFrame));
    const imgs = [];
    if (Array.isArray(body.images)) {
      for (const it of body.images.slice(0, 5)) {
        const u = await toPublic(pickImg(it));
        if (u) imgs.push(u);
      }
    }
    const single = await toPublic(pickImg(body.image || body.image_url));

    if (ff || lf) {
      payload.mode = "keyframe";
      if (ff) payload.first_frame = ff;
      if (lf) payload.last_frame = lf;
    } else if (imgs.length || single) {
      payload.mode = "reference";
      payload.images = imgs.length ? imgs : [single];
    }

    const sub = await fetch(`${BASE}/v1/videos`, {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const subText = await sub.text();
    let subData;
    try { subData = JSON.parse(subText); } catch { return res.status(sub.status).send(subText); }
    if (!sub.ok) return res.status(sub.status).json(subData);

    const vid = subData.video_id || subData.id || subData.task_id;
    if (!vid) return res.status(500).json({ error: "Agnes 未返回任务 ID", raw: subData });

    const deadline = Date.now() + 50000;
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

    const okDone = final && final.status === "completed";
    const url = okDone ? (final.url || final.video_url || "") : "";
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
      detail: st === "processing" ? "生成中，稍等一下再点一次生成" : undefined
    });

  } catch (err) {
    return res.status(500).json({ error: `中转失败: ${err.message}` });
  }
}
