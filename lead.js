// POST /api/lead  { name, contact, task, lang }
// Шлёт заявку с формы в Telegram. Требует env: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method" });

  const { name = "", contact = "", task = "", lang = "ru" } = req.body || {};
  if (!name.trim() || !contact.trim()) return res.status(400).json({ error: "fields" });

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return res.status(500).json({ error: "config" });

  const text =
    `🔥 Заявка с лендинга (ilyashaklein)\n\n` +
    `Имя: ${name}\n` +
    `Контакт: ${contact}\n` +
    `Задача: ${task || "-"}\n` +
    `Язык: ${lang}`;

  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
    });
    if (!r.ok) throw new Error("tg");
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: "send" });
  }
}
