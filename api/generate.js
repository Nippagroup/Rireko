// api/generate.js
// ログイン確認 ＋ 回数制限（無料 月5回 / 買い切りクレジット）つきで Claude を安全に呼ぶ。
// 必要な環境変数（Vercel側）: ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
const MODEL = "claude-sonnet-4-6";
const FREE_PER_MONTH = 5;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function monthAnchor() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}
function sameMonth(anchor) {
  return anchor && String(anchor).slice(0, 7) === monthAnchor().slice(0, 7);
}

// ログイン中のユーザーを、トークンから確認する
async function getUser(token) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!r.ok) return null;
  return await r.json();
}
async function getProfile(uid) {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?id=eq.${uid}&select=ai_used_this_month,month_anchor,paid_credits`,
    { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
  );
  if (!r.ok) return null;
  const rows = await r.json();
  return rows[0] || null;
}
async function ensureProfile(uid) {
  const p = await getProfile(uid);
  if (p) return p;
  await fetch(`${SUPABASE_URL}/rest/v1/profiles`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ id: uid }),
  });
  return { ai_used_this_month: 0, month_anchor: monthAnchor(), paid_credits: 0 };
}
async function updateProfile(uid, fields) {
  await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${uid}`, {
    method: "PATCH",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(fields),
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!process.env.ANTHROPIC_API_KEY || !SUPABASE_URL || !SERVICE_KEY)
    return res.status(500).json({ error: "Server not fully configured." });

  // 1) ログイン確認
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: "login_required" });
  const user = await getUser(token);
  if (!user || !user.id) return res.status(401).json({ error: "login_required" });

  // 2) 回数チェック
  const p = await ensureProfile(user.id);
  const used = sameMonth(p.month_anchor) ? (p.ai_used_this_month || 0) : 0;
  const credits = p.paid_credits || 0;

  let mode;
  if (used < FREE_PER_MONTH) mode = "free";
  else if (credits > 0) mode = "paid";
  else return res.status(403).json({ error: "limit_reached" });

  // 3) Claude 呼び出し
  try {
    const { prompt } = req.body || {};
    if (!prompt || typeof prompt !== "string")
      return res.status(400).json({ error: "prompt required" });

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1000,
        messages: [{ role: "user", content: prompt.slice(0, 4000) }],
      }),
    });
    const data = await r.json();
    if (!r.ok) {
      console.error("Anthropic error:", data);
      return res.status(502).json({ error: "ai_failed" });
    }
    const text = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    // 4) 成功したときだけ回数を記録
    if (mode === "free")
      await updateProfile(user.id, { ai_used_this_month: used + 1, month_anchor: monthAnchor() });
    else await updateProfile(user.id, { paid_credits: credits - 1 });

    return res.status(200).json({
      text,
      mode,
      used: mode === "free" ? used + 1 : used,
      free_limit: FREE_PER_MONTH,
      credits: mode === "paid" ? credits - 1 : credits,
    });
  } catch (e) {
    console.error("Server error:", e);
    return res.status(500).json({ error: "server_error" });
  }
}
