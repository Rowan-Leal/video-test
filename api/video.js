export const config = {
  runtime: "nodejs"
};

import fetch from "node-fetch";

const AGNES_BASE = "https://api.agnes.ai";

export default async function handler(req, res) {
  // 心跳测试
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

  const agnesKey = process.env.AGNES_API_KEY;
  if (!agnesKey) {
    return res.status(500).json({ error: "缺少 AGNES_API_KEY 环境变量" });
  }

  try {
    const body = await req.json();
    const upstream = await fetch(`${AGNES_BASE}/v1/videos/generations`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${agnesKey}`,
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
    res.status(500).json({
      error: err.message || "请求失败"
    });
  }
}
