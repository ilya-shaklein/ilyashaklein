// POST /api/audit  { url, lang }
// Тянет страницу, гоняет через Claude, возвращает { score, headline, issues[] }
// Требует env: ANTHROPIC_API_KEY
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method" });

  let { url = "", lang = "ru" } = req.body || {};
  url = String(url).trim();
  if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error: "url" });

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(500).json({ error: "config" });

  // 1. тянем страницу
  let pageText = "";
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const pr = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "Mozilla/5.0 (audit bot)" },
    });
    clearTimeout(t);
    const html = await pr.text();
    pageText = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 6000);
  } catch (e) {
    return res.status(400).json({ error: "fetch" });
  }
  if (!pageText) return res.status(400).json({ error: "empty" });

  // 2. Claude
  const sys =
    lang === "en"
      ? "You are a senior CRO/growth expert. Audit the landing page text for conversion. Reply ONLY with JSON, no markdown, no preamble: {\"score\": <0-10 integer>, \"headline\": \"<one short verdict line>\", \"issues\": [\"<concrete fix 1>\", \"<fix 2>\", \"<fix 3>\", \"<fix 4>\"]}. Issues must be specific and actionable, in English."
      : "Ты senior эксперт по CRO и перформанс-маркетингу. Проверь текст лендинга на конверсию. Ответь ТОЛЬКО JSON, без markdown и вступлений: {\"score\": <целое 0-10>, \"headline\": \"<одна короткая строка-вердикт>\", \"issues\": [\"<конкретная правка 1>\", \"<правка 2>\", \"<правка 3>\", \"<правка 4>\"]}. Правки - конкретные и практичные, на русском.";

  try {
    const ar = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 700,
        system: sys,
        messages: [{ role: "user", content: `URL: ${url}\n\nТекст страницы:\n${pageText}` }],
      }),
    });
    if (!ar.ok) throw new Error("api");
    const data = await ar.json();
    let txt = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("").trim();
    txt = txt.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(txt);
    return res.status(200).json({
      score: parsed.score,
      headline: parsed.headline || "",
      issues: Array.isArray(parsed.issues) ? parsed.issues.slice(0, 6) : [],
    });
  } catch (e) {
    return res.status(500).json({ error: "ai" });
  }
}
