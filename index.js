import express    from "express";
import { spawn }  from "child_process";
import path       from "path";
import { fileURLToPath } from "url";
import bcrypt     from "bcryptjs";
import db         from "./db.js";
import { signToken, requireAuth, requireAdmin } from "./auth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ═══════════════════════════════════════════════════════════════════
//  AUTH
// ═══════════════════════════════════════════════════════════════════

// POST /api/login
app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: "Faltan credenciales" });

  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
  if (!user || !bcrypt.compareSync(password, user.password))
    return res.status(401).json({ error: "Usuario o contraseña incorrectos" });

  const token = signToken({ id: user.id, username: user.username, role: user.role });
  res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
});

// GET /api/me
app.get("/api/me", requireAuth, (req, res) => {
  const user = db.prepare("SELECT id, username, role, created_at FROM users WHERE id = ?")
    .get(req.user.id);
  res.json(user);
});

// ═══════════════════════════════════════════════════════════════════
//  OPERACIONES
// ═══════════════════════════════════════════════════════════════════

// POST /api/operacion  { tipo, precio }
app.post("/api/operacion", requireAuth, (req, res) => {
  const { tipo, precio } = req.body;
  if (!["compra","venta"].includes(tipo) || !precio || isNaN(precio))
    return res.status(400).json({ error: "Datos inválidos" });

  const result = db.prepare(
    "INSERT INTO operaciones (user_id, tipo, precio) VALUES (?, ?, ?)"
  ).run(req.user.id, tipo, parseFloat(precio));

  const op = db.prepare("SELECT * FROM operaciones WHERE id = ?").get(result.lastInsertRowid);
  res.json(op);
});

// GET /api/operaciones  — historial del usuario (o todos si es admin con ?all=1)
app.get("/api/operaciones", requireAuth, (req, res) => {
  let rows;
  if (req.user.role === "admin" && req.query.all === "1") {
    rows = db.prepare(`
      SELECT o.*, u.username FROM operaciones o
      JOIN users u ON u.id = o.user_id
      ORDER BY o.fecha DESC
    `).all();
  } else {
    rows = db.prepare(
      "SELECT * FROM operaciones WHERE user_id = ? ORDER BY fecha DESC"
    ).all(req.user.id);
  }
  res.json(rows);
});

// DELETE /api/operaciones  — reset historial del usuario actual
app.delete("/api/operaciones", requireAuth, (req, res) => {
  db.prepare("DELETE FROM operaciones WHERE user_id = ?").run(req.user.id);
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════════════
//  SEÑAL ML (corre model_runner.py, con caché 60s)
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
    if (code !== 0) return res.status(500).json({ error: "model_error", detail: err });
    try {
      const result = JSON.parse(out.trim());
      if (result.error) return res.status(500).json(result);
      mlCache = { data: result, ts: now };
      res.json(result);
    } catch { res.status(500).json({ error: "parse_error", raw: out }); }
  });
});

// ═══════════════════════════════════════════════════════════════════
//  ANÁLISIS IA PERSONALIZADO
// ═══════════════════════════════════════════════════════════════════
app.post("/api/analyze", requireAuth, async (req, res) => {
  const { signal, tipoOperacion, precioUsuario, ganancia,
          historialResumen, tendencia24h, precioEstimado } = req.body;
  if (!signal) return res.status(400).json({ error: "missing_signal" });

  let ctxOp = "Sin operación registrada.";
  if (tipoOperacion === "compra" && precioUsuario) {
    ctxOp = `COMPRÓ a $${precioUsuario}. Resultado actual: ${ganancia}%. `
      + (tendencia24h ? `Tendencia 24h: ${tendencia24h}. Precio estimado 24h: $${precioEstimado}.` : "");
  } else if (tipoOperacion === "venta" && precioUsuario) {
    ctxOp = `VENDIÓ a $${precioUsuario}. Resultado: ${ganancia}%. `
      + (tendencia24h ? `Tendencia 24h: ${tendencia24h}. Precio estimado 24h: $${precioEstimado}.` : "");
  }

  const prompt = `Eres un trader experto en Bitcoin. Responde en español, directo, sin markdown.

MERCADO ACTUAL:
- Precio: $${signal.current_price}
- RSI: ${signal.rsi} | MACD: ${signal.macd > 0 ? "positivo" : "negativo"}
- ML predicción: ${signal.ml_pred > 0 ? "+" : ""}${(signal.ml_pred * 100).toFixed(3)}%
- Señal: ${signal.action} (${signal.confidence}% confianza)
- BB: sup $${signal.bb?.upper?.toFixed(0)}, med $${signal.bb?.middle?.toFixed(0)}, inf $${signal.bb?.lower?.toFixed(0)}

OPERACIÓN USUARIO: ${ctxOp}
HISTORIAL RESUMEN: ${historialResumen || "Sin historial previo."}

RESPONDE EN ESTE FORMATO EXACTO (sin asteriscos):
Tendencia 24h: [Alcista/Bajista/Lateral]
Precio estimado: $[número]
Objetivo recomendado: +[1-5]% (zona segura)
Acción: [HOLD / VENDER / COMPRAR / RECOMPRAR]
Sugerencia: [una oración concreta con precio específico]
Análisis: [2-3 oraciones explicando el razonamiento]`;

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 500,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const d    = await r.json();
    const text = d.content?.filter(b => b.type === "text").map(b => b.text).join("") ?? "";
    res.json({ analysis: text });
  } catch (e) {
    res.status(500).json({ error: "ai_error", detail: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
//  MARKET — altcoins + alertas
// ═══════════════════════════════════════════════════════════════════
const COINS = ["BTCUSDT","ETHUSDT","SOLUSDT","BNBUSDT","XRPUSDT","ADAUSDT"];
let marketCache = { data: null, ts: 0 };

app.get("/api/market", requireAuth, async (req, res) => {
  const now = Date.now();
  if (marketCache.data && now - marketCache.ts < 30_000)
    return res.json(marketCache.data);

  try {
    const symbols = encodeURIComponent(JSON.stringify(COINS));
    const r = await fetch(
      `https://api.binance.com/api/v3/ticker/24hr?symbols=${symbols}`
    );
    const tickers = await r.json();

    const coins = tickers.map(t => ({
      symbol:    t.symbol.replace("USDT",""),
      price:     parseFloat(t.lastPrice),
      change24h: parseFloat(t.priceChangePercent),
      volume:    parseFloat(t.quoteVolume),
    })).sort((a, b) => b.change24h - a.change24h);

    // Alertas básicas por breakout/soporte
    const alerts = [];
    for (const c of coins) {
      if (c.change24h > 5)
        alerts.push({ type:"breakout", coin: c.symbol,
          msg: `🔺 ${c.symbol} rompe resistencia — +${c.change24h.toFixed(1)}% en 24h`, color:"green" });
      else if (c.change24h < -5)
        alerts.push({ type:"support", coin: c.symbol,
          msg: `🔻 ${c.symbol} perdiendo soporte — ${c.change24h.toFixed(1)}% en 24h`, color:"red" });
    }

    // Arbitraje simple: comparar BTC vs resto
    const btc  = coins.find(c => c.symbol === "BTC");
    const alts = coins.filter(c => c.symbol !== "BTC" && c.change24h > (btc?.change24h ?? 0) + 2);
    const arb  = alts.length
      ? { recommendation: `Rotar parte del capital BTC → ${alts[0].symbol}`,
          reason: `${alts[0].symbol} supera a BTC en ${(alts[0].change24h - btc.change24h).toFixed(1)}% hoy` }
      : null;

    const result = { coins, alerts, arbitrage: arb };
    marketCache  = { data: result, ts: now };
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: "market_error", detail: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
//  ADMIN — gestión de usuarios
// ═══════════════════════════════════════════════════════════════════

// GET /api/admin/users
app.get("/api/admin/users", requireAuth, requireAdmin, (req, res) => {
  const users = db.prepare(
    "SELECT id, username, role, created_at FROM users ORDER BY id"
  ).all();
  res.json(users);
});

// POST /api/admin/users  { username, password, role }
app.post("/api/admin/users", requireAuth, requireAdmin, (req, res) => {
  const { username, password, role = "user" } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: "Faltan datos" });
  try {
    const hash = bcrypt.hashSync(password, 10);
    const r    = db.prepare(
      "INSERT INTO users (username, password, role) VALUES (?, ?, ?)"
    ).run(username, hash, role);
    res.json({ id: r.lastInsertRowid, username, role });
  } catch (e) {
    res.status(409).json({ error: "El usuario ya existe" });
  }
});

// DELETE /api/admin/users/:id
app.delete("/api/admin/users/:id", requireAuth, requireAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: "No puedes eliminarte a ti mismo" });
  db.prepare("DELETE FROM users WHERE id = ?").run(id);
  res.json({ ok: true });
});

// PATCH /api/admin/users/:id/password  { password }
app.patch("/api/admin/users/:id/password", requireAuth, requireAdmin, (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: "Falta la contraseña" });
  const hash = bcrypt.hashSync(password, 10);
  db.prepare("UPDATE users SET password = ? WHERE id = ?").run(hash, parseInt(req.params.id));
  res.json({ ok: true });
});

// DELETE /api/admin/users/:id/operaciones  — resetear historial de un usuario
app.delete("/api/admin/users/:id/operaciones", requireAuth, requireAdmin, (req, res) => {
  db.prepare("DELETE FROM operaciones WHERE user_id = ?").run(parseInt(req.params.id));
  res.json({ ok: true });
});

// Fallback SPA
app.get("*", (_, res) =>
  res.sendFile(path.join(__dirname, "public", "index.html"))
);

app.listen(PORT, () =>
  console.log(`✅ cripto-ai v3 → http://localhost:${PORT}`)
);