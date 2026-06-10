// api/resumes.js
// 管理キー(ADMIN_KEY)を知っている人だけ、保存された全履歴書を取得できる入口。
// メール認証は不要。必要な環境変数(Vercel): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ADMIN_KEY
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_KEY = process.env.ADMIN_KEY;

export default async function handler(req, res) {
  if (req.method !== "GET")
    return res.status(405).json({ error: "method_not_allowed" });
  if (!SUPABASE_URL || !SERVICE_KEY)
    return res.status(500).json({ error: "server_not_configured" });
  if (!ADMIN_KEY)
    return res.status(500).json({ error: "admin_key_not_set" });

  const key = req.headers["x-admin-key"] || "";
  if (key !== ADMIN_KEY) return res.status(401).json({ error: "unauthorized" });

  try {
    const rr = await fetch(
      `${SUPABASE_URL}/rest/v1/resumes?select=user_id,data,updated_at&order=updated_at.desc`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
    );
    if (!rr.ok) {
      const detail = await rr.text().catch(() => "");
      return res.status(502).json({
        error: "resumes_fetch_failed",
        upstream_status: rr.status,
        detail: String(detail).slice(0, 300),
      });
    }
    const rows = await rr.json();

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
    return res
      .status(500)
      .json({ error: "server_error", detail: String((e && e.message) || e).slice(0, 300) });
  }
}
