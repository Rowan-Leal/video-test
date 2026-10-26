import { createClient } from '@supabase/supabase-js';

// 环境变量
const AGNES_API_KEY = process.env.AGNES_API_KEY;
const AGNES_BASE_URL = 'https://apihub.agnes-ai.com/v1';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || 'agnes-images';

// 初始化 Supabase
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false }
});

/**
 * 宽高转画幅比例
 */
function calcAspectRatio(width, height) {
  if (!width || !height) return '16:9';
  const w = Number(width), h = Number(height);
  if (!w || !h) return '16:9';
  const ratio = w / h;
  if (Math.abs(ratio - 16/9) < 0.1) return '16:9';
  if (Math.abs(ratio - 9/16) < 0.1) return '9:16';
  if (Math.abs(ratio - 1) < 0.1) return '1:1';
  if (Math.abs(ratio - 4/3) < 0.1) return '4:3';
  if (Math.abs(ratio - 21/9) < 0.1) return '21:9';
  return '16:9';
}

/**
 * 图片上传到 Supabase，返回公网URL
 * 支持 已有URL / base64 两种格式
 */
async function uploadImage(input) {
  if (typeof input === 'string' && input.startsWith('http')) return input;

  if (typeof input === 'string' && input.includes('base64,')) {
    const [meta, base64Data] = input.split(',');
    const mimeType = meta.match(/data:(.*?);base64/)?.[1] || 'image/png';
    const ext = mimeType.split('/')[1] || 'png';
    const fileName = `${Date.now()}_${Math.random().toString(36).slice(2,8)}.${ext}`;
    const buffer = Buffer.from(base64Data, 'base64');

    const { error } = await supabase.storage
      .from(SUPABASE_BUCKET)
      .upload(fileName, buffer, { contentType: mimeType });
    if (error) throw new Error(`图床上传失败: ${error.message}`);

    const { data: { publicUrl } } = supabase.storage
      .from(SUPABASE_BUCKET)
      .getPublicUrl(fileName);
    return publicUrl;
  }
  return input;
}

/**
 * 轮询 Agnes 任务状态
 */
async function pollTask(videoId, maxWaitMs = 55000) {
  const startTime = Date.now();
  const modelName = 'agnes-video-2.5-flash';

  while (Date.now() - startTime < maxWaitMs) {
    const res = await fetch(`https://apihub.agnes-ai.com/agnesapi?video_id=${videoId}&model_name=${modelName}`, {
      headers: { Authorization: `Bearer ${AGNES_API_KEY}` }
    });

    if (!res.ok) throw new Error(`查询任务失败: HTTP ${res.status}`);
    const data = await res.json();

    if (data.status === 'completed') return data;
    if (data.status === 'failed') throw new Error(`生成失败: ${data.message || '未知错误'}`);

    await new Promise(r => setTimeout(r, 3000));
  }
  throw new Error('生成超时，请缩短时长重试');
}

export default async function handler(req, res) {
  // 跨域配置
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: '仅支持POST请求' });

  try {
    // 校验配置
    if (!AGNES_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      return res.status(500).json({ error: '环境变量配置缺失' });
    }

    const body = req.body;

    // ========== 核心：修复 size 报错 ==========
    const payload = {
      model: 'agnes-video-2.5-flash',
      mode: body.mode || 'text',
      size: '720P', // 强制固定，彻底解决 invalid_size
      prompt: body.prompt || '',
      negative_prompt: body.negative_prompt || '',
      seconds: String(body.seconds || body.duration || '5'),
      seed: body.seed
    };

    // 宽高自动转画幅比例
    if (body.width && body.height) {
      payload.aspect_ratio = calcAspectRatio(body.width, body.height);
    }
    if (body.aspect_ratio) payload.aspect_ratio = body.aspect_ratio;

    // ========== 图片处理 ==========
    if (body.images && Array.isArray(body.images)) {
      const urls = [];
      for (const img of body.images) urls.push(await uploadImage(img));
      payload.images = urls;
      payload.mode = body.mode || 'reference';
    }
    if (body.image && !body.images) {
      payload.images = [await uploadImage(body.image)];
      payload.mode = body.mode || 'reference';
    }

    // ========== 提交生成任务 ==========
    const submitRes = await fetch(`${AGNES_BASE_URL}/videos`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${AGNES_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!submitRes.ok) {
      const err = await submitRes.text();
      return res.status(submitRes.status).json({ error: '提交失败', detail: err });
    }

    const submitData = await submitRes.json();
    const videoId = submitData.video_id || submitData.id;
    if (!videoId) return res.status(500).json({ error: '未获取到任务ID' });

    // ========== 轮询等待结果 ==========
    const result = await pollTask(videoId);
    const videoUrl = result.url || result.video_url;

    // 返回兼容格式
    return res.status(200).json({
      id: videoId,
      status: 'completed',
      url: videoUrl,
      video_url: videoUrl,
      raw: result
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}

export const config = { runtime: 'nodejs18.x' };
