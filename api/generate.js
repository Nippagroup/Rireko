// api/generate.js
// これは「裏の処理（バックエンド）」です。Vercel上だけで動き、ブラウザには出ません。
// APIキーは Vercel の環境変数 ANTHROPIC_API_KEY から読み込むので、コードには書きません。
//
// 使うモデルは下の MODEL で切り替えできます。
//   品質重視: "claude-sonnet-4-6"（やや高い）
//   コスト重視: "claude-haiku-4-5-20251001"（安い）
const MODEL = "claude-sonnet-4-6";

export default async function handler(req, res) {
  // POST以外は受け付けない
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // APIキーが設定されていなければ止める（設定し忘れ対策）
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "API key is not configured on the server." });
  }

  try {
    const { prompt } = req.body || {};
    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ error: "prompt is required" });
    }

    // 念のため長すぎる入力は制限（コスト・乱用対策の最低限）
    const safePrompt = prompt.slice(0, 4000);

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
        messages: [{ role: "user", content: safePrompt }],
      }),
    });

    const data = await r.json();

    if (!r.ok) {
      console.error("Anthropic error:", data);
      return res.status(502).json({ error: "AI request failed" });
    }

    const text = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    return res.status(200).json({ text });
  } catch (e) {
    console.error("Server error:", e);
    return res.status(500).json({ error: "Server error" });
  }
}
