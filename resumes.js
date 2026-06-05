// api/resumes.js
// 管理者（ADMIN_EMAILS に登録したメール）だけ、保存された全履歴書を取得できる入口。
// RLS（行レベル保護）を越えて全件を読むため、サーバー側でのみ SERVICE キーを使う。
// 必要な環境変数（Vercel側）: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ADMIN_EMAILS
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMINS = (process.env.ADMIN_EMAILS || "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

// ログイン中のユーザーを、トークンから確認する
async function getUser(token) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!r.ok) return null;
  return await r.json();
}

export default async function handler(req, res) {
  if (req.method !== "GET")
    return res.status(405).json({ error: "Method not allowed" });
  if (!SUPABASE_URL || !SERVICE_KEY)
    return res.status(500).json({ error: "Server not fully configured." });
  if (!ADMINS.length)
    return res.status(500).json({ error: "ADMIN_EMAILS not set." });

  // 1) ログイン確認
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: "login_required" });
  const user = await getUser(token);
  if (!user || !user.id) return res.status(401).json({ error: "login_required" });

  // 2) 管理者チェック
  if (!ADMINS.includes((user.email || "").toLowerCase()))
    return res.status(403).json({ error: "forbidden" });

  try {
    // 3) 全履歴書を取得（SERVICE キーで RLS を越える）
    const rr = await fetch(
      `${SUPABASE_URL}/rest/v1/resumes?select=user_id,data,updated_at&order=updated_at.desc`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
    );
    if (!rr.ok) return res.status(502).json({ error: "fetch_failed" });
    const rows = await rr.json();

    // 4) user_id → メール の対応表をつくる
    const map = {};
    try {
      const ur = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=200`, {
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
      });
      if (ur.ok) {
        const uj = await ur.json();
        (uj.users || uj || []).forEach((u) => {
          if (u && u.id) map[u.id] = u.email || "";
        });
      }
    } catch (e) {}

    const resumes = (rows || []).map((r) => ({
      email: map[r.user_id] || r.user_id,
      updated_at: r.updated_at,
      data: r.data || {},
    }));

    return res.status(200).json({ count: resumes.length, resumes });
  } catch (e) {
    console.error("resumes error:", e);
    return res.status(500).json({ error: "server_error" });
  }
}
