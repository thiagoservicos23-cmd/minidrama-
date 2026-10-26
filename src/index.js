require("dotenv").config();
const path = require("path");
const express = require("express");
const cors = require("cors");
const compression = require("compression");
const helmet = require("helmet");

const authRoutes = require("./routes/auth");
const playsRoutes = require("./routes/plays");
const plansRoutes = require("./routes/plans");
const usersRoutes = require("./routes/users");
const bunnyRoutes = require("./routes/bunny");
const paymentsRoutes = require("./routes/payments");
const cronRoutes = require("./routes/cron");
const emailRoutes = require("./routes/email");
const meRoutes = require("./routes/me");
const vortaRoutes = require("./routes/vorta");
const { migrateInlineImages } = require("./utils/images");

const app = express();

// O Render fica atrás de um proxy: sem isso o IP real do visitante não é enxergado (afeta limites de tentativas).
app.set("trust proxy", 1);
app.disable("x-powered-by");

app.use(compression());                                  // gzip: o site e o JSON ficam ~5x menores
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors());
app.use(express.json({ limit: "15mb" }));

// ---- API ----
app.use("/api/auth", authRoutes);
app.use("/api/plays", playsRoutes);
app.use("/api/plans", plansRoutes);
app.use("/api/users", usersRoutes);
app.use("/api/bunny", bunnyRoutes);
app.use("/api/payments", paymentsRoutes);
app.use("/api/cron", cronRoutes);
app.use("/api/email", emailRoutes);
app.use("/api/me", meRoutes);
app.use("/api/vorta", vortaRoutes);

// Leve de propósito (sem banco): serve para "acordar" o servidor rapidamente.
app.get("/api/health", (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// ---- Front-end estático ----
const publicDir = path.join(__dirname, "..", "public");
app.use(express.static(publicDir, {
  setHeaders(res, filePath) {
    const name = path.basename(filePath);
    // O HTML e o service worker sempre revalidam (assim cada deploy chega rápido); ícones podem ficar em cache.
    if (name === "index.html" || name === "sw.js" || name === "manifest.webmanifest") res.set("Cache-Control", "no-cache");
    else res.set("Cache-Control", "public, max-age=604800");
  }
}));

// Qualquer rota que não seja /api/* devolve o index.html (SPA por hash-routing).
app.get(/^(?!\/api\/).*/, (req, res) => {
  res.set("Cache-Control", "no-cache");
  res.sendFile(path.join(publicDir, "index.html"));
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Mini Drama rodando em http://localhost:${PORT}`);
  migrateInlineImages();                                  // move imagens antigas (base64) para o novo armazenamento
  require("./services/emailJobs").ensureBaseline().catch(() => {});
});
