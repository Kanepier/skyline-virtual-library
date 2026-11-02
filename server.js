
import express from "express";
import OpenAI from "openai";
import pg from "pg";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { Pool } = pg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, "data");
const REQUESTS_FILE = path.join(DATA_DIR, "book-requests.json");

app.use(express.json({ limit: "30kb" }));
app.use(express.static(path.join(__dirname, "public")));

// Kết nối Neon PostgreSQL nếu đã cấu hình DATABASE_URL.
const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL
    })
  : null;

// Cấu hình AI
let openai = null;

if (process.env.OPENAI_API_KEY) {
  openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  });
}

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

// Đọc dữ liệu từ file JSON khi chạy ở môi trường không có Neon.
async function readLocalRequests() {
  try {
    const raw = await fs.readFile(REQUESTS_FILE, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function writeLocalRequests(requests) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(
    REQUESTS_FILE,
    JSON.stringify(requests, null, 2),
    "utf8"
  );
}

// Khởi tạo bảng và chuyển dữ liệu JSON cũ sang Neon nếu có.
async function initializeDatabase() {
  if (!pool) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS book_requests (
      id TEXT PRIMARY KEY,
      title VARCHAR(160) NOT NULL,
      author VARCHAR(120) NOT NULL DEFAULT '',
      grade VARCHAR(40) NOT NULL DEFAULT '',
      genre VARCHAR(60) NOT NULL DEFAULT '',
      reason VARCHAR(700) NOT NULL DEFAULT '',
      student VARCHAR(30) NOT NULL DEFAULT 'Bạn đọc Sky-Line',
      date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Chờ thư viện xem xét',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Nếu file JSON cũ có dữ liệu, đưa dữ liệu đó vào Neon.
  const oldRequests = await readLocalRequests();

  for (const request of oldRequests) {
    await pool.query(
      `INSERT INTO book_requests
       (id, title, author, grade, genre, reason, student, date, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO NOTHING`,
      [
        request.id,
        request.title,
        request.author || "",
        request.grade || "",
        request.genre || "",
        request.reason || "",
        request.student || "Bạn đọc Sky-Line",
        request.date || new Date().toLocaleDateString("vi-VN"),
        request.status || "Chờ thư viện xem xét"
      ]
    );
  }

  console.log("Neon PostgreSQL: đã kết nối và sẵn sàng.");
}

// Đọc danh sách đề xuất.
async function readRequests() {
  if (!pool) {
    return readLocalRequests();
  }

  const result = await pool.query(`
    SELECT id, title, author, grade, genre, reason, student, date, status
    FROM book_requests
    ORDER BY created_at DESC
    LIMIT 1000
  `);

  return result.rows;
}

// Lưu một đề xuất mới.
async function saveRequest(request) {
  if (!pool) {
    const requests = await readLocalRequests();
    requests.unshift(request);
    await writeLocalRequests(requests.slice(0, 1000));
    return;
  }

  await pool.query(
    `INSERT INTO book_requests
     (id, title, author, grade, genre, reason, student, date, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      request.id,
      request.title,
      request.author,
      request.grade,
      request.genre,
      request.reason,
      request.student,
      request.date,
      request.status
    ]
  );
}

// Trạng thái hệ thống
app.get("/api/status", (_req, res) => {
  res.json({
    aiConnected: Boolean(openai),
    storage: pool ? "neon-postgresql" : "local-json-file"
  });
});

// Trò chuyện với AI
app.post("/api/chat", async (req, res) => {
  if (!openai) {
    return res.status(503).json({
      error: "Chưa cấu hình OPENAI_API_KEY trên máy chủ."
    });
  }

  const message = String(req.body?.message || "").trim().slice(0, 3000);
  const character =
    characterNames[String(req.body?.character || "")] ||
    "một người bạn thủ thư";

  const history = Array.isArray(req.body?.history)
    ? req.body.history.slice(-10)
    : [];

  if (!message) {
    return res.status(400).json({
      error: "Vui lòng nhập câu hỏi."
    });
  }

  const safeHistory = history
    .filter(
      (m) =>
        ["user", "assistant"].includes(m?.role) &&
        typeof m?.content === "string"
    )
    .map((m) => ({
      role: m.role,
      content: m.content.slice(0, 1500)
    }));

  try {
    const response = await openai.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-5.5",
      instructions: `${instructions}\nNhân vật đang được chọn: ${character}. Hãy trò chuyện trực tiếp với học sinh trong vai này khi phù hợp.`,
      input: safeHistory.length ? safeHistory : message,
      max_output_tokens: 700
    });

    res.json({
      reply:
        response.output_text ||
        "Mình chưa nghĩ ra câu trả lời phù hợp. Em thử hỏi theo cách khác nhé!"
    });
  } catch (error) {
    console.error("OpenAI API error:", error?.message || error);

    res.status(502).json({
      error: "AI tạm thời chưa phản hồi. Vui lòng thử lại sau."
    });
  }
});

// Lấy danh sách đề xuất sách
app.get("/api/book-requests", async (_req, res) => {
  try {
    const requests = await readRequests();
    res.json({ requests: requests.slice(0, 100) });
  } catch (error) {
    console.error("Book request read error:", error?.message || error);

    res.status(500).json({
      error: "Không đọc được danh sách đề xuất."
    });
  }
});

// Gửi đề xuất sách mới
app.post("/api/book-requests", async (req, res) => {
  const title = String(req.body?.title || "").trim().slice(0, 160);

  if (!title) {
    return res.status(400).json({
      error: "Tên sách là bắt buộc."
    });
  }

  const request = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title,
    author: String(req.body?.author || "").trim().slice(0, 120),
    grade: String(req.body?.grade || "").slice(0, 40),
    genre: String(req.body?.genre || "").slice(0, 60),
    reason: String(req.body?.reason || "").trim().slice(0, 700),
    student: String(req.body?.student || "Bạn đọc Sky-Line")
      .trim()
      .slice(0, 30),
    date: new Date().toLocaleDateString("vi-VN"),
    status: "Chờ thư viện xem xét"
  };

  try {
    await saveRequest(request);

    const requests = await readRequests();

    res.status(201).json({
      ok: true,
      requests: requests.slice(0, 100)
    });
  } catch (error) {
    console.error("Book request save error:", error?.message || error);

    res.status(500).json({
      error: "Chưa lưu được đề xuất. Vui lòng thử lại."
    });
  }
});

// Khởi động máy chủ sau khi Neon đã sẵn sàng.
async function startServer() {
  try {
    await initializeDatabase();

    app.listen(PORT, () => {
      console.log(
        `Sky-Line Virtual Library đang chạy tại http://localhost:${PORT}`
      );
      console.log(
        openai
          ? "AI: đã cấu hình API key."
          : "AI: chưa cấu hình. Thêm OPENAI_API_KEY vào môi trường máy chủ."
      );
    });
  } catch (error) {
    console.error("Không thể khởi động máy chủ:", error?.message || error);
    process.exit(1);
  }
}

startServer();
