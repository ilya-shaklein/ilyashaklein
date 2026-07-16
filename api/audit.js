// POST /api/audit  { url, lang }
// Тянет страницу через Jina Reader (рендерит JS!) -> Claude -> { score, headline, issues[] }
// Требует env: ANTHROPIC_API_KEY
// Опционально env: JINA_API_KEY (поднимает лимит с ~20 до ~200 запросов/мин)
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method" });

  let { url = "", lang = "ru" } = req.body || {};
  url = String(url).trim();
  if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error: "url" });

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(500).json({ error: "config" });

  const pageText = await getPageText(url, process.env.JINA_API_KEY);
  if (!pageText) return res.status(400).json({ error: "fetch" });

  const sys =
    lang === "en"
      ? "You are a senior CRO/growth expert. Audit the landing page for conversion. Reply ONLY with JSON, no markdown, no preamble: {\"score\": <0-10 integer>, \"headline\": \"<one short verdict line>\", \"issues\": [\"<concrete fix 1>\", \"<fix 2>\", \"<fix 3>\", \"<fix 4>\"]}. Issues must be specific and actionable, in English."
      : "Ты senior эксперт по CRO и перформанс-маркетингу. Проверь лендинг на конверсию. Ответь ТОЛЬКО JSON, без markdown и вступлений: {\"score\": <целое 0-10>, \"headline\": \"<одна короткая строка-вердикт>\", \"issues\": [\"<конкретная правка 1>\", \"<правка 2>\", \"<правка 3>\", \"<правка 4>\"]}. Правки - конкретные и практичные, на русском.";

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
        messages: [{ role: "user", content: `URL: ${url}\n\nКонтент страницы:\n${pageText}` }],
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

// Получить текст страницы. Сначала Jina Reader (исполняет JS), при сбое - прямой fetch.
async function getPageText(url, jinaKey) {
  // 1. Jina Reader - рендерит страницу в браузере, отдаёт чистый текст
  try {
    const headers = { "X-Return-Format": "markdown" };
    if (jinaKey) headers["Authorization"] = "Bearer " + jinaKey;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12000);
    const r = await fetch("https://r.jina.ai/" + url, { signal: ctrl.signal, headers });
    clearTimeout(t);
    if (r.ok) {
      const txt = (await r.text()).trim();
      if (txt) return txt.slice(0, 8000);
    }
  } catch (e) {}

  // 2. Fallback - сырой HTML напрямую (без JS-рендера)
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const pr = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "Mozilla/5.0 (audit bot)" } });
    clearTimeout(t);
    const html = await pr.text();
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 8000);
  } catch (e) {
    return "";
  }
}
