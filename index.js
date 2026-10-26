import fetch from 'node-fetch';
import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';

const AGNES_BASE = "https://apihub.agnes-ai.com/v1";
const SUPABASE_URL = "https://uhochttjkenwtnelvzkg.supabase.co";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const AGNES_KEY = process.env.AGNES_KEY;
const BUCKET_NAME = "nuojiji-images";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

export default async function handler(req, res) {
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

    // 1. 下载原图
    const imgResp = await fetch(imageUrl);
    const rawBuffer = Buffer.from(await imgResp.arrayBuffer());

    // 2. Sharp自动裁切+填充到 Agnes 要求：720×1280（9:16竖屏）
    const processedBuffer = await sharp(rawBuffer)
      .resize({
        width:720,
        height:1280,
        fit:"contain",
        background:{r:0,g:0,b:0,alpha:0}
      })
      .toBuffer();

    // 3. 生成随机文件名，上传到你的supabase图床
    const fileName = `proxy_${Date.now()}_${Math.random().toString(36).slice(2)}.png`;
    const { error: uploadErr } = await supabase
      .storage
      .from(BUCKET_NAME)
      .upload(fileName, processedBuffer, {
        contentType:"image/png",
        upsert:false
      });
    if(uploadErr){
      return res.status(400).json({error:"Supabase上传失败",detail:uploadErr});
    }

    // 4. 获取公开直链（给Agnes调用）
    const { data: urlData } = supabase
      .storage
      .from(BUCKET_NAME)
      .getPublicUrl(fileName);
    const fixedImgUrl = urlData.publicUrl;

    // 5. 转发给Agnes生成视频
    const agnesPayload = {
      model: model,
      prompt: prompt,
      image_url: fixedImgUrl,
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
    return res.status(500).json({ error: "中转服务异常", msg: err.message });
  }
}
