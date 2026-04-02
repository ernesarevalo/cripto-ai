import express from "express";
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import db from "./db.js";
import { signToken, requireAuth, requireAdmin } from "./auth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const PROD_ORIGIN = process.env.FRONTEND_ORIGIN || "*";

// ═══════════════════════════════════════════════════════════════════
//  SEGURIDAD GLOBAL
// ═══════════════════════════════════════════════════════════════════

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://unpkg.com", "https://cdnjs.cloudflare.com", "'unsafe-inline'"],
      scriptSrcAttr: ["'unsafe-inline'"],
      connectSrc: [
        "'self'",
        "https://api.binance.com",
        "https://*.binance.com",
        "wss://*.binance.com",
        "wss://stream.binance.com:9443",
        "wss://stream.binance.com:443",
        "https://api.anthropic.com",
        "https://api.coingecko.com"
      ],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"],
      workerSrc: ["'self'", "blob:"],
      fontSrc: ["'self'", "data:"],
    },
  },
}));

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (PROD_ORIGIN === "*" || origin === PROD_ORIGIN) {
    res.setHeader("Access-Control-Allow-Origin", PROD_ORIGIN);
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

const globalLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiadas solicitudes, intenta en unos minutos" },
});
app.use("/api/", globalLimit);

const loginLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: "Demasiados intentos de login" },
});

app.use(express.json({ limit: "20kb" }));
app.use(express.static(path.join(__dirname, "public")));

function sanitize(str) {
  if (typeof str !== "string") return str;
  return str.replace(/[<>"'&]/g, "").trim().slice(0, 120);
}

// ═══════════════════════════════════════════════════════════════════
//  AUTH
// ═══════════════════════════════════════════════════════════════════

app.post("/api/login", loginLimit, (req, res) => {
  const username = sanitize(req.body?.username || "");
  const password = String(req.body?.password || "").slice(0, 128);
  if (!username || !password)
    return res.status(400).json({ error: "Faltan credenciales" });

  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
  if (!user || !bcrypt.compareSync(password, user.password))
    return res.status(401).json({ error: "Usuario o contraseña incorrectos" });

  const token = signToken({ id: user.id, username: user.username, role: user.role });
  res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
});

app.get("/api/me", requireAuth, (req, res) => {
  const user = db.prepare("SELECT id, username, role, created_at FROM users WHERE id = ?")
    .get(req.user.id);
  res.json(user);
});

// ═══════════════════════════════════════════════════════════════════
//  OPERACIONES
// ═══════════════════════════════════════════════════════════════════

app.post("/api/operacion", requireAuth, (req, res) => {
  const tipo = sanitize(req.body?.tipo || "");
  const precio = parseFloat(req.body?.precio);

  if (!["compra", "venta"].includes(tipo))
    return res.status(400).json({ error: "Tipo inválido" });
  if (!precio || isNaN(precio) || precio <= 0 || precio > 10_000_000)
    return res.status(400).json({ error: "Precio inválido" });

  const result = db.prepare(
    "INSERT INTO operaciones (user_id, tipo, precio) VALUES (?, ?, ?)"
  ).run(req.user.id, tipo, precio);

  const op = db.prepare("SELECT * FROM operaciones WHERE id = ?").get(result.lastInsertRowid);
  res.json(op);
});

app.get("/api/operaciones", requireAuth, (req, res) => {
  let rows;
  if (req.user.role === "admin" && req.query.all === "1") {
    rows = db.prepare(`
      SELECT o.*, u.username FROM operaciones o
      JOIN users u ON u.id = o.user_id ORDER BY o.fecha DESC
    `).all();
  } else {
    rows = db.prepare(
      "SELECT * FROM operaciones WHERE user_id = ? ORDER BY fecha DESC"
    ).all(req.user.id);
  }
  res.json(rows);
});

app.delete("/api/operaciones", requireAuth, (req, res) => {
  db.prepare("DELETE FROM operaciones WHERE user_id = ?").run(req.user.id);
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════════════
//  SEÑAL ML
// ═══════════════════════════════════════════════════════════════════
let mlCache = { data: null, ts: 0 };

app.get("/api/signal", requireAuth, (req, res) => {
  const now = Date.now();
  if (mlCache.data && now - mlCache.ts < 60_000)
    return res.json({ ...mlCache.data, cached: true });

  const py = spawn("python3", ["model_runner.py"], { cwd: __dirname, timeout: 90_000 });
  let out = "", err = "";
  py.stdout.on("data", d => out += d);
  py.stderr.on("data", d => err += d);
  py.on("close", code => {
    if (code !== 0)
      return res.status(500).json({ error: "No se pudo calcular la señal. Intenta de nuevo." });
    try {
      const result = JSON.parse(out.trim());
      if (result.error) return res.status(500).json({ error: "Error en el modelo ML" });
      mlCache = { data: result, ts: now };
      res.json(result);
    } catch {
      res.status(500).json({ error: "Error procesando resultado ML" });
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
//  ANÁLISIS IA
// ═══════════════════════════════════════════════════════════════════
app.post("/api/analyze", requireAuth, async (req, res) => {
  const sig = req.body?.signal;
  const tipoOperacion = sanitize(req.body?.tipoOperacion || "");
  const precioUsuario = parseFloat(req.body?.precioUsuario) || null;
  const ganancia = parseFloat(req.body?.ganancia) || null;
  const histResumen = sanitize(req.body?.historialResumen || "");

  if (!sig) return res.status(400).json({ error: "Datos insuficientes" });

  let ctxOp = "Sin operación registrada.";
  if (["compra", "venta"].includes(tipoOperacion) && precioUsuario) {
    const label = tipoOperacion === "compra" ? "COMPRÓ" : "VENDIÓ";
    ctxOp = `${label} a $${precioUsuario}. Resultado actual: ${ganancia !== null ? ganancia + "%" : "N/A"}. `;
  }

  const safePrice = parseFloat(sig.current_price) || 0;
  const safeRsi = parseFloat(sig.rsi) || 0;
  const safeMacd = parseFloat(sig.macd) || 0;
  const safeMlPred = parseFloat(sig.ml_pred) || 0;

  const prompt = `Eres un trader experto en Bitcoin. Responde en español, directo, sin markdown ni asteriscos.

MERCADO: Precio $${safePrice} | RSI ${safeRsi} | MACD ${safeMacd > 0 ? "positivo" : "negativo"} | ML ${safeMlPred > 0 ? "+" : ""}${(safeMlPred * 100).toFixed(3)}% | Señal: ${sig.action} (${sig.confidence}% confianza)
BB: sup $${sig.bb?.upper?.toFixed(0) ?? "?"}, med $${sig.bb?.middle?.toFixed(0) ?? "?"}, inf $${sig.bb?.lower?.toFixed(0) ?? "?"}

USUARIO: ${ctxOp}
HISTORIAL: ${histResumen || "Sin historial."}

FORMATO DE RESPUESTA (exacto, sin cambios):
Tendencia 24h: [Alcista/Bajista/Lateral]
Precio estimado: $[número]
Objetivo recomendado: +[1-5]% (zona segura)
Acción: [HOLD / VENDER / COMPRAR / RECOMPRAR]
Sugerencia: [una oración con precio específico]
Análisis: [2-3 oraciones de razonamiento]`;

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-3-5-sonnet-20240620",
        max_tokens: 500,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const d = await r.json();
    const text = d.content?.filter(b => b.type === "text").map(b => b.text).join("") ?? "";
    res.json({ analysis: text });
  } catch {
    res.status(500).json({ error: "No se pudo conectar con la IA. Intenta más tarde." });
  }
});

// ═══════════════════════════════════════════════════════════════════
//  MERCADO
// ═══════════════════════════════════════════════════════════════════
const COIN_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "ADAUSDT", "DOGEUSDT", "AVAXUSDT", "DOTUSDT", "LINKUSDT", "MATICUSDT", "NEARUSDT"];
let marketCache = { data: null, ts: 0 };

function coinSignal(coin) {
  const ch = coin.change24h;
  if (ch > 6) return { action: "VENDER", label: "🔴 VENDER", reason: "Subida extrema, riesgo de corrección" };
  if (ch > 3) return { action: "HOLD", label: "🟡 MANTENER", reason: "Tendencia alcista, vigilar resistencia" };
  if (ch > 0.5) return { action: "COMPRAR", label: "🟢 COMPRAR", reason: "Momentum positivo, entrada gradual" };
  if (ch > -2) return { action: "HOLD", label: "🟡 MANTENER", reason: "Mercado lateral, esperar señal" };
  if (ch > -5) return { action: "COMPRAR", label: "🟢 COMPRAR", reason: "Corrección saludable, zona de acumulación" };
  return { action: "HOLD", label: "🟡 ESPERAR", reason: "Caída fuerte, esperar soporte" };
}

app.get("/api/market", requireAuth, async (req, res) => {
  const now = Date.now();
  if (marketCache.data && now - marketCache.ts < 30_000)
    return res.json(marketCache.data);

  try {
    const results = await Promise.allSettled(
      COIN_SYMBOLS.map(s =>
        fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${s}`, { signal: AbortSignal.timeout(15000) }) // Aumentado a 15s
          .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
      )
    );

    const coins = results
      .filter(r => r.status === "fulfilled" && r.value?.symbol)
      .map(r => r.value)
      .map(t => {
        const coin = {
          symbol: t.symbol.replace("USDT", ""),
          price: parseFloat(t.lastPrice),
          change24h: parseFloat(t.priceChangePercent),
          volume: parseFloat(t.quoteVolume),
          high: parseFloat(t.highPrice),
          low: parseFloat(t.lowPrice),
        };
        return { ...coin, signal: coinSignal(coin) };
      })
      .sort((a, b) => b.change24h - a.change24h);

    if (!coins.length) throw new Error("No data from Binance");

    const alerts = [];
    for (const c of coins) {
      if (c.change24h > 6)
        alerts.push({ msg: `🔺 ${c.symbol} +${c.change24h.toFixed(1)}% — breakout alcista`, color: "green" });
      else if (c.change24h < -5)
        alerts.push({ msg: `🔻 ${c.symbol} ${c.change24h.toFixed(1)}% — perdiendo soporte`, color: "red" });
    }

    const btc = coins.find(c => c.symbol === "BTC");
    const btcCh = btc?.change24h ?? 0;
    const opportunity = coins
      .filter(c => c.symbol !== "BTC" && c.signal.action === "COMPRAR" && c.change24h > btcCh)
      .sort((a, b) => b.volume - a.volume)[0];

    const arbitrage = opportunity
      ? { recommendation: `Oportunidad: ${opportunity.symbol} (+${opportunity.change24h.toFixed(1)}%)`,
          reason: opportunity.signal.reason }
      : null;

    const result = { coins, alerts, arbitrage };
    marketCache = { data: result, ts: now };
    res.json(result);
  } catch (e) {
    if (marketCache.data) return res.json({ ...marketCache.data, stale: true });
    res.status(503).json({ error: "No se pudo cargar el mercado. Intenta de nuevo." });
  }
});

// ═══════════════════════════════════════════════════════════════════
//  ADMIN
// ═══════════════════════════════════════════════════════════════════

app.get("/api/admin/users", requireAuth, requireAdmin, (req, res) => {
  const users = db.prepare("SELECT id, username, role, created_at FROM users ORDER BY id").all();
  res.json(users);
});

app.post("/api/admin/users", requireAuth, requireAdmin, (req, res) => {
  const username = sanitize(req.body?.username || "");
  const password = String(req.body?.password || "").slice(0, 128);
  const role = ["user", "admin"].includes(req.body?.role) ? req.body.role : "user";
  if (!username || !password)
    return res.status(400).json({ error: "Faltan datos" });
  try {
    const hash = bcrypt.hashSync(password, 10);
    const r = db.prepare("INSERT INTO users (username, password, role) VALUES (?, ?, ?)").run(username, hash, role);
    res.json({ id: r.lastInsertRowid, username, role });
  } catch {
    res.status(409).json({ error: "El usuario ya existe" });
  }
});

app.delete("/api/admin/users/:id", requireAuth, requireAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "ID inválido" });
  if (id === req.user.id) return res.status(400).json({ error: "No puedes eliminarte a ti mismo" });
  db.prepare("DELETE FROM users WHERE id = ?").run(id);
  res.json({ ok: true });
});

app.patch("/api/admin/users/:id/password", requireAuth, requireAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  const password = String(req.body?.password || "").slice(0, 128);
  if (!Number.isInteger(id) || !password)
    return res.status(400).json({ error: "Datos inválidos" });
  const hash = bcrypt.hashSync(password, 10);
  db.prepare("UPDATE users SET password = ? WHERE id = ?").run(hash, id);
  res.json({ ok: true });
});

app.delete("/api/admin/users/:id/operaciones", requireAuth, requireAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "ID inválido" });
  db.prepare("DELETE FROM operaciones WHERE user_id = ?").run(id);
  res.json({ ok: true });
});

app.get("*", (_, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`✅ BTC Oracle v4 → http://localhost:${PORT}`);
});