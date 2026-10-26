export const config = { runtime: "nodejs" };

import fetch from "node-fetch";

const BASE = process.env.AGNES_BASE_URL || "https://apihub.agnes-ai.com/v1";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Expose-Headers", "*");
  res.setHeader("Access-Control-Max-Age", "86400");

  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method === "GET") {
    return res.status(200).json({ ok: true, message: "alive", time: new Date().toISOString() });
  }

  try {
    let body = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch { body = {}; }
    }
    body = body || {};

    const auth = req.headers.authorization
      || (process.env.AGNES_API_KEY ? `Bearer ${process.env.AGNES_API_KEY}` : "");

    const upstream = await fetch(`${BASE}/videos/generations`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: auth },
      body: JSON.stringify(body)
    });

    const text = await upstream.text();
    let data;
    try { data = JSON.parse(text); } catch { return res.status(upstream.status).send(text); }

    return res.status(upstream.status).json(data);
  } catch (err) {
    return res.status(500).json({ error: `中转失败: ${err.message}` });
  }
}
