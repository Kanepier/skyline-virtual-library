import express from "express";
import OpenAI from "openai";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, "data");
const REQUESTS_FILE = path.join(DATA_DIR, "book-requests.json");
app.use(express.json({ limit: "30kb" }));
app.use(express.static(path.join(__dirname, "public")));

const characterNames = {
  deman: "Dế Mèn trong tác phẩm Dế Mèn phiêu lưu ký",
  tam: "Tấm trong truyện cổ tích Tấm Cám",
  fox: "Cáo trong Hoàng tử bé"
};
const instructions = `Bạn là Trợ lý Thủ thư thông minh tại Thư viện trường Sky-Line, đồng thời có thể nhập vai nhân vật văn học.
Luôn trả lời bằng tiếng Việt thân thiện, khích lệ, đúng chuẩn mực sư phạm và phù hợp học sinh phổ thông.
Nếu được yêu cầu nhập vai, giữ giọng điệu phù hợp nhân vật nhưng không khẳng định các tình tiết không chắc chắn là sự thật trong tác phẩm.
Khuyến khích học sinh suy nghĩ, giải thích lý do và liên hệ bài học với cuộc sống; không làm học sinh xấu hổ khi trả lời sai.
Không yêu cầu học sinh cung cấp địa chỉ, số điện thoại, mật khẩu, thông tin liên hệ hoặc dữ liệu riêng tư.
Với câu hỏi về sách, nếu không chắc chi tiết, hãy nói rõ sự không chắc chắn thay vì bịa.
Nếu được yêu cầu tạo thử thách đọc hiểu, tạo câu hỏi phù hợp độ tuổi, kèm đáp án và giải thích ngắn; không tiết lộ đáp án trước khi học sinh thử trả lời.`;

let openai = null;
if (process.env.OPENAI_API_KEY) {
  openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

async function readRequests() {
  try {
    const raw = await fs.readFile(REQUESTS_FILE, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}
async function writeRequests(requests) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(REQUESTS_FILE, JSON.stringify(requests, null, 2), "utf8");
}

app.get("/api/status", (_req, res) => {
  res.json({ aiConnected: Boolean(openai), storage: "local-json-file" });
});

app.post("/api/chat", async (req, res) => {
  if (!openai) return res.status(503).json({ error: "Chưa cấu hình OPENAI_API_KEY trên máy chủ." });
  const message = String(req.body?.message || "").trim().slice(0, 3000);
  const character = characterNames[String(req.body?.character || "")] || "một người bạn thủ thư";
  const history = Array.isArray(req.body?.history) ? req.body.history.slice(-10) : [];
  if (!message) return res.status(400).json({ error: "Vui lòng nhập câu hỏi." });

  const safeHistory = history
    .filter(m => ["user", "assistant"].includes(m?.role) && typeof m?.content === "string")
    .map(m => ({ role: m.role, content: m.content.slice(0, 1500) }));

  try {
    const response = await openai.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-5.5",
      instructions: `${instructions}\nNhân vật đang được chọn: ${character}. Hãy trò chuyện trực tiếp với học sinh trong vai này khi phù hợp.`,
      input: safeHistory.length ? safeHistory : message,
      max_output_tokens: 700
    });
    res.json({ reply: response.output_text || "Mình chưa nghĩ ra câu trả lời phù hợp. Em thử hỏi theo cách khác nhé!" });
  } catch (error) {
    console.error("OpenAI API error:", error?.message || error);
    res.status(502).json({ error: "AI tạm thời chưa phản hồi. Vui lòng thử lại sau." });
  }
});

app.get("/api/book-requests", async (_req, res) => {
  try {
    const requests = await readRequests();
    res.json({ requests: requests.slice(0, 100) });
  } catch {
    res.status(500).json({ error: "Không đọc được danh sách đề xuất." });
  }
});

app.post("/api/book-requests", async (req, res) => {
  const title = String(req.body?.title || "").trim().slice(0, 160);
  if (!title) return res.status(400).json({ error: "Tên sách là bắt buộc." });
  const request = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title,
    author: String(req.body?.author || "").trim().slice(0, 120),
    grade: String(req.body?.grade || "").slice(0, 40),
    genre: String(req.body?.genre || "").slice(0, 60),
    reason: String(req.body?.reason || "").trim().slice(0, 700),
    student: String(req.body?.student || "Bạn đọc Sky-Line").trim().slice(0, 30),
    date: new Date().toLocaleDateString("vi-VN"),
    status: "Chờ thư viện xem xét"
  };
  try {
    const requests = await readRequests();
    requests.unshift(request);
    await writeRequests(requests.slice(0, 1000));
    res.status(201).json({ ok: true, requests: requests.slice(0, 100) });
  } catch (error) {
    console.error("Book request save error:", error?.message || error);
    res.status(500).json({ error: "Chưa lưu được đề xuất. Vui lòng thử lại." });
  }
});

app.listen(PORT, () => {
  console.log(`Sky-Line Virtual Library đang chạy tại http://localhost:${PORT}`);
  console.log(openai ? "AI: đã cấu hình API key." : "AI: chưa cấu hình. Thêm OPENAI_API_KEY vào môi trường máy chủ.");
});
