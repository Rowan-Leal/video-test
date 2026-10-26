import fetch from 'node-fetch';

const AGNES_BASE = "https://apihub.agnes-ai.com/v1";
const AGNES_KEY = process.env.AGNES_KEY;

export default async function handler(req, res) {
  // 处理拉取模型列表，解决拉取模型报错
  if(req.method === "GET" && req.url.startsWith("/v1/models")){
    return res.status(200).json({
      object: "list",
      data: [
        {
          id: "agnes-video-2.5-flash",
          object: "model",
          created: 1700000000,
          owned_by: "agnes"
        }
      ]
    })
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const body = req.body;
    const model = body.model || "agnes-video-2.5-flash";
    const prompt = body.prompt || "";
    const imageUrl = body.image_url || (body.messages?.[0]?.content?.match(/https?:\/\/[^\s]+/)?.[0]);

    if (!imageUrl) {
      return res.status(400).json({ error: "缺少图片链接 image_url" });
    }

    // 直接转发原图，不再用sharp处理图片！
    const agnesPayload = {
      model: model,
      prompt: prompt,
      image_url: imageUrl,
      aspect_ratio: "9:16"
    };
    const agnesRes = await fetch(`${AGNES_BASE}/video/generations`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${AGNES_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(agnesPayload)
    });
    const result = await agnesRes.json();
    return res.status(agnesRes.status).json(result);

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "中转服务异常", msg: err.message });
  }
}
