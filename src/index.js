require("dotenv").config();
const path = require("path");
const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/auth");
const playsRoutes = require("./routes/plays");
const plansRoutes = require("./routes/plans");
const usersRoutes = require("./routes/users");
const bunnyRoutes = require("./routes/bunny");

const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

// ---- API ----
app.use("/api/auth", authRoutes);
app.use("/api/plays", playsRoutes);
app.use("/api/plans", plansRoutes);
app.use("/api/users", usersRoutes);
app.use("/api/bunny", bunnyRoutes);

app.get("/api/health", (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// ---- Front-end estático ----
const publicDir = path.join(__dirname, "..", "public");
app.use(express.static(publicDir));

// Qualquer rota que não seja /api/* devolve o index.html (SPA por hash-routing).
app.get(/^(?!\/api\/).*/, (req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Mini Drama rodando em http://localhost:${PORT}`);
});
