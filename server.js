
import express from "express";
import OpenAI from "openai";
import pg from "pg";
import bcrypt from "bcryptjs";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { Pool } = pg;
const PgSession = connectPgSimple(session);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.set("trust proxy", 1);
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, "data");
const REQUESTS_FILE = path.join(DATA_DIR, "book-requests.json");

app.use(express.json({ limit: "30kb" }));

const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL })
  : null;

let openai = null;
if (process.env.OPENAI_API_KEY) {
  openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
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

const adminUsername = process.env.ADMIN_USERNAME;
const adminPassword = process.env.ADMIN_PASSWORD;
const sessionSecret = process.env.SESSION_SECRET;

if (!pool) {
  console.error("Thiếu DATABASE_URL. Không thể khởi động hệ thống quản trị.");
  process.exit(1);
}
if (!adminUsername || !adminPassword || !sessionSecret) {
  console.error("Thiếu ADMIN_USERNAME, ADMIN_PASSWORD hoặc SESSION_SECRET.");
  process.exit(1);
}

const sessionConfig = {
  store: new PgSession({
    pool,
    tableName: "user_sessions",
    createTableIfMissing: true
  }),
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 8 * 60 * 60 * 1000
  }
};

app.use(session(sessionConfig));
app.use(express.static(path.join(__dirname, "public")));

let adminPasswordHash;

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
  await fs.writeFile(REQUESTS_FILE, JSON.stringify(requests, null, 2), "utf8");
}

async function initializeDatabase() {
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

  const oldRequests = await readLocalRequests();

  for (const r of oldRequests) {
    await pool.query(
      `INSERT INTO book_requests
       (id,title,author,grade,genre,reason,student,date,status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id) DO NOTHING`,
      [
        r.id, r.title, r.author || "", r.grade || "",
        r.genre || "", r.reason || "",
        r.student || "Bạn đọc Sky-Line",
        r.date || new Date().toLocaleDateString("vi-VN"),
        r.status || "Chờ thư viện xem xét"
      ]
    );
  }

  adminPasswordHash = await bcrypt.hash(adminPassword, 12);
  console.log("Neon PostgreSQL và hệ thống quản trị đã sẵn sàng.");
}

async function readRequests() {
  const result = await pool.query(`
    SELECT id,title,author,grade,genre,reason,student,date,status
    FROM book_requests
    ORDER BY created_at DESC
    LIMIT 1000
  `);
  return result.rows;
}

async function saveRequest(r) {
  await pool.query(
    `INSERT INTO book_requests
     (id,title,author,grade,genre,reason,student,date,status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      r.id, r.title, r.author, r.grade, r.genre,
      r.reason, r.student, r.date, r.status
    ]
  );
}

function requireAdmin(req, res, next) {
  if (req.session?.isAdmin) return next();
  return res.status(401).json({ error: "Vui lòng đăng nhập quản trị." });
}

// Trạng thái hệ thống
app.get("/api/status", (_req, res) => {
  res.json({
    aiConnected: Boolean(openai),
    storage: "neon-postgresql"
  });
});

// Đăng nhập quản trị
app.post("/api/admin/login", async (req, res) => {
  const username = String(req.body?.username || "");
  const password = String(req.body?.password || "");

  if (username !== adminUsername ||
      !(await bcrypt.compare(password, adminPasswordHash))) {
    return res.status(401).json({
      error: "Tên đăng nhập hoặc mật khẩu không chính xác."
    });
  }

  req.session.regenerate((error) => {
    if (error) {
      return res.status(500).json({ error: "Không tạo được phiên đăng nhập." });
    }

    req.session.isAdmin = true;
    req.session.username = adminUsername;

    req.session.save((saveError) => {
      if (saveError) {
        return res.status(500).json({ error: "Không lưu được phiên đăng nhập." });
      }
      res.json({ ok: true, username: adminUsername });
    });
  });
});

app.get("/api/admin/me", (req, res) => {
  res.json({
    loggedIn: Boolean(req.session?.isAdmin),
    username: req.session?.isAdmin ? req.session.username : null
  });
});

app.post("/api/admin/logout", (req, res) => {
  req.session.destroy((error) => {
    if (error) return res.status(500).json({ error: "Đăng xuất chưa thành công." });
    res.clearCookie("connect.sid");
    res.json({ ok: true });
  });
});

// Danh sách đề xuất dành cho quản trị viên
app.get("/api/admin/book-requests", requireAdmin, async (_req, res) => {
  try {
    const requests = await readRequests();
    res.json({ requests });
  } catch (error) {
    console.error("Admin read error:", error.message);
    res.status(500).json({ error: "Không đọc được danh sách đề xuất." });
  }
});

// Cập nhật trạng thái đề xuất
app.patch("/api/admin/book-requests/:id", requireAdmin, async (req, res) => {
  const allowed = [
    "Chờ thư viện xem xét",
    "Đã duyệt",
    "Từ chối"
  ];
  const status = String(req.body?.status || "");

  if (!allowed.includes(status)) {
    return res.status(400).json({ error: "Trạng thái không hợp lệ." });
  }

  try {
    const result = await pool.query(
      `UPDATE book_requests SET status = $1 WHERE id = $2 RETURNING id,status`,
      [status, req.params.id]
    );

    if (!result.rowCount) {
      return res.status(404).json({ error: "Không tìm thấy đề xuất." });
    }

    res.json({ ok: true, request: result.rows[0] });
  } catch (error) {
    console.error("Admin update error:", error.message);
    res.status(500).json({ error: "Không cập nhật được trạng thái." });
  }
});

// Trang quản trị
app.get("/admin", (_req, res) => {
  res.type("html").send(`<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Quản trị thư viện Sky-Line</title>
<style>
body{font-family:Arial,sans-serif;background:#f3f6fc;color:#172b4d;margin:0;padding:24px}
main{max-width:1000px;margin:35px auto;background:white;padding:28px;border-radius:16px;box-shadow:0 8px 30px #19345a12}
h1{color:#315bd6}input,button{padding:12px;border:1px solid #ccd5e5;border-radius:8px;font-size:15px}
input{display:block;width:100%;box-sizing:border-box;margin:10px 0}
button{background:#4265df;color:white;border:0;cursor:pointer;margin:4px}
button.secondary{background:#65738b}button.reject{background:#b74444}
table{width:100%;border-collapse:collapse;margin-top:20px}
th,td{text-align:left;padding:12px;border-bottom:1px solid #e6ebf3;vertical-align:top}
#error{color:#bd3030}#login{max-width:400px;margin:auto}
.small{color:#687b98;font-size:13px}
@media(max-width:700px){main{padding:16px;overflow-x:auto}table{min-width:700px}}
</style>
</head>
<body>
<main>
<section id="login">
<h1>Sky-Line Virtual Library</h1>
<h2>Đăng nhập quản trị</h2>
<form id="loginForm">
<input id="username" autocomplete="username" placeholder="Tên đăng nhập" required>
<input id="password" type="password" autocomplete="current-password" placeholder="Mật khẩu" required>
<button type="submit">Đăng nhập</button>
</form>
<p id="error"></p>
</section>
<section id="dashboard" hidden>
<h1>Quản trị thư viện Sky-Line</h1>
<p>Xin chào, <strong id="adminName"></strong></p>
<button id="refresh">Làm mới danh sách</button>
<button id="logout" class="secondary">Đăng xuất</button>
<p id="message" class="small"></p>
<div style="overflow-x:auto">
<table>
<thead><tr><th>Tên sách</th><th>Tác giả</th><th>Khối lớp</th><th>Thể loại</th><th>Người đề xuất</th><th>Trạng thái</th><th>Xử lý</th></tr></thead>
<tbody id="requests"></tbody>
</table>
</div>
</section>
</main>
<script>
const loginBox=document.getElementById("login");
const dashboard=document.getElementById("dashboard");
const errorBox=document.getElementById("error");
const message=document.getElementById("message");

async function api(url,options={}){
  const response=await fetch(url,{credentials:"same-origin",...options,
    headers:{"Content-Type":"application/json",...(options.headers||{})}});
  const data=await response.json();
  if(!response.ok)throw new Error(data.error||"Có lỗi xảy ra");
  return data;
}
function showDashboard(name){
  loginBox.hidden=true;dashboard.hidden=false;
  document.getElementById("adminName").textContent=name||"Quản trị viên";
  loadRequests();
}
async function loadRequests(){
  const body=document.getElementById("requests");
  message.textContent="Đang tải...";
  try{
    const data=await api("/api/admin/book-requests");
    body.replaceChildren();
    for(const r of data.requests){
      const tr=document.createElement("tr");
      const values=[r.title,r.author,r.grade,r.genre,r.student,r.status];
      for(const value of values){
        const td=document.createElement("td");
        td.textContent=value||"—";tr.appendChild(td);
      }
      const actions=document.createElement("td");
      for(const [label,status,cls] of [
        ["Duyệt","Đã duyệt",""],
        ["Từ chối","Từ chối","reject"],
        ["Chờ xử lý","Chờ thư viện xem xét","secondary"]
      ]){
        const button=document.createElement("button");
        button.textContent=label;
        if(cls)button.className=cls;
        button.addEventListener("click",async()=>{
          try{
            await api("/api/admin/book-requests/"+encodeURIComponent(r.id),{
              method:"PATCH",body:JSON.stringify({status})
            });
            message.textContent="Đã cập nhật: "+r.title;
            loadRequests();
          }catch(e){message.textContent=e.message;}
        });
        actions.appendChild(button);
      }
      tr.appendChild(actions);body.appendChild(tr);
    }
    message.textContent="Tổng số đề xuất: "+data.requests.length;
  }catch(e){message.textContent=e.message;}
}
document.getElementById("loginForm").addEventListener("submit",async(e)=>{
  e.preventDefault();errorBox.textContent="";
  try{
    const data=await api("/api/admin/login",{method:"POST",body:JSON.stringify({
      username:document.getElementById("username").value,
      password:document.getElementById("password").value
    })});
    showDashboard(data.username);
  }catch(err){errorBox.textContent=err.message;}
});
document.getElementById("refresh").addEventListener("click",loadRequests);
document.getElementById("logout").addEventListener("click",async()=>{
  try{await api("/api/admin/logout",{method:"POST"});location.reload();}
  catch(e){message.textContent=e.message;}
});
api("/api/admin/me").then(data=>{
  if(data.loggedIn)showDashboard(data.username);
}).catch(()=>{});
</script>
</body>
</html>`);
});

// Trò chuyện với AI
app.post("/api/chat", async (req, res) => {
  if (!openai) {
    return res.status(503).json({
      error: "Chưa cấu hình OPENAI_API_KEY trên máy chủ."
    });
  }

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

// Danh sách đề xuất công khai
app.get("/api/book-requests", async (_req, res) => {
  try {
    const requests = await readRequests();
    res.json({ requests: requests.slice(0, 100) });
  } catch (error) {
    console.error("Book request read error:", error?.message || error);
    res.status(500).json({ error: "Không đọc được danh sách đề xuất." });
  }
});

// Gửi đề xuất sách
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
    await saveRequest(request);
    const requests = await readRequests();
    res.status(201).json({ ok: true, requests: requests.slice(0, 100) });
  } catch (error) {
    console.error("Book request save error:", error?.message || error);
    res.status(500).json({ error: "Chưa lưu được đề xuất. Vui lòng thử lại." });
  }
});

async function startServer() {
  try {
    await initializeDatabase();
    app.listen(PORT, () => {
      console.log(`Sky-Line Virtual Library đang chạy tại http://localhost:${PORT}`);
      console.log(openai ? "AI: đã cấu hình API key." : "AI: chưa cấu hình OPENAI_API_KEY.");
    });
  } catch (error) {
    console.error("Không thể khởi động máy chủ:", error?.message || error);
    process.exit(1);
  }
}

startServer();
