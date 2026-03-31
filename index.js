import express from "express";
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Cache simple para no correr el modelo en cada request
let cache = { data: null, timestamp: 0 };
const CACHE_TTL = 60 * 1000; // 60 segundos

// ── /api/signal ── Corre model_runner.py y devuelve señal ML
app.get("/api/signal", (req, res) => {
  const now = Date.now();

  // Devuelve caché si es reciente
  if (cache.data && now - cache.timestamp < CACHE_TTL) {
    return res.json({ ...cache.data, cached: true });
  }

  const python = spawn("python3", ["model_runner.py"], {
    cwd: __dirname,
    timeout: 60000,
  });

  let stdout = "";
  let stderr = "";

  python.stdout.on("data", (d) => (stdout += d.toString()));
  python.stderr.on("data", (d) => (stderr += d.toString()));

  python.on("close", (code) => {
    if (code !== 0) {
      console.error("Python error:", stderr);
      return res.status(500).json({ error: "model_error", detail: stderr });
    }
    try {
      const result = JSON.parse(stdout.trim());
      if (result.error) {
        return res.status(500).json(result);
      }
      cache = { data: result, timestamp: now };
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: "parse_error", raw: stdout });
    }
  });
});

// ── /api/analyze ── Análisis IA personalizado vía Claude API
app.post("/api/analyze", async (req, res) => {
  const { signal, tipoOperacion, precioUsuario, ganancia } = req.body;

  if (!signal) return res.status(400).json({ error: "missing_signal" });

  let ctxUsuario = "El usuario no ha registrado operación.";
  if (tipoOperacion === "compra" && precioUsuario) {
    ctxUsuario = `El usuario COMPRÓ BTC a $${precioUsuario}. Precio actual: $${signal.current_price}. Resultado: ${ganancia >= 0 ? "+" : ""}${ganancia}%. Target de venta: $${signal.sell_target}.`;
  } else if (tipoOperacion === "venta" && precioUsuario) {
    ctxUsuario = `El usuario VENDIÓ BTC a $${precioUsuario}. Precio actual: $${signal.current_price}. Resultado: ${ganancia >= 0 ? "+" : ""}${ganancia}% (positivo = bajó desde su venta). Target de recompra: $${signal.buy_target}.`;
  }

  const prompt = `Eres un trader experto en Bitcoin. Responde en español, 3-4 oraciones directas, sin asteriscos ni markdown.

Contexto del usuario: ${ctxUsuario}
RSI: ${signal.rsi} | MACD: ${signal.macd > 0 ? "positivo" : "negativo"} | ML: ${signal.ml_pred > 0 ? "+" : ""}${(signal.ml_pred * 100).toFixed(3)}%
Señal: ${signal.action} con ${signal.confidence}% de confianza.
BB: sup $${signal.bb?.upper?.toFixed(0)}, med $${signal.bb?.middle?.toFixed(0)}, inf $${signal.bb?.lower?.toFixed(0)}.

Responde: 1) Estado del mercado. 2) Qué debe hacer el usuario AHORA con su posición. 3) Precio clave a vigilar.`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 350,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const data = await response.json();
    const text =
      data.content?.filter((b) => b.type === "text").map((b) => b.text).join("") ??
      "Sin respuesta.";
    res.json({ analysis: text });
  } catch (e) {
    res.status(500).json({ error: "ai_error", detail: e.message });
  }
});

// Fallback → index.html
app.get("*", (_, res) =>
  res.sendFile(path.join(__dirname, "public", "index.html"))
);

app.listen(PORT, () => {
  console.log(`✅ cripto-ai v2 corriendo en http://localhost:${PORT}`);
});