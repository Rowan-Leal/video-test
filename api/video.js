export const config = {
  runtime: "nodejs"
};

import fetch from "node-fetch";

const AGNES_BASE = "https://api.agnes.ai";

export default async function handler(req, res) {
  // CORS 设置
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  // 处理预检请求
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      message: "中转服务正常",
      time: new Date().toISOString()
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = await req.json();
    // 使用客户端传入的 Authorization（也就是你面板填的 Agnes key）
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({ error: "缺少 Authorization" });
    }

    const upstream = await fetch(`${AGNES_BASE}/v1/videos/generations`, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    const rawText = await upstream.text();
    let data;
    try {
      data = JSON.parse(rawText);
    } catch {
      return res.status(upstream.status).send(rawText);
    }

    res.status(upstream.status).json(data);
  } catch (err) {
    console.error("proxy error:", err);
    res.status(500).json({
      error: err.message || "中转请求失败"
    });
  }
}
