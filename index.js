import express from "express";
import fetch from "node-fetch";
import { execSync } from "child_process";
import fs from "fs";

const app = express();

app.use(express.static("public"));

const DATA_FILE = "./data.json";

// 🧠 leer datos
function loadData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE));
  } catch {
    return {};
  }
}

// 💾 guardar datos
function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

async function getPrices() {
  const res = await fetch(
    "https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=7"
  );

  const data = await res.json();

  if (!data.prices) throw new Error("API failed");

  return data.prices.map(p => p[1]);
}

function calculateRSI(prices, period = 14) {
  let gains = 0, losses = 0;

  for (let i = prices.length - period; i < prices.length - 1; i++) {
    const diff = prices[i + 1] - prices[i];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }

  const rs = gains / (losses || 1);
  return 100 - (100 / (1 + rs));
}

function getSignal(prediction, rsi, pnl) {
  if (prediction > 0.015 && rsi < 65) return "BUY";
  if (prediction < -0.015 && rsi > 60) return "SELL";
  if (pnl && pnl > 5) return "SELL";
  return "WAIT";
}

app.get("/btc", async (req, res) => {
  try {
    const prices = await getPrices();
    const current = prices[prices.length - 1];

    let prediction = 0;

    try {
      prediction = parseFloat(
        execSync("python3 model_runner.py").toString().trim()
      );
    } catch {}

    const rsi = calculateRSI(prices);

    const data = loadData();

    const pnlBuy = data.buy
      ? ((current - data.buy) / data.buy) * 100
      : null;

    const pnlSell = data.sell
      ? ((data.sell - current) / data.sell) * 100
      : null;

    const signal = getSignal(prediction, rsi, pnlBuy);

    res.json({
      current,
      prediction,
      rsi,
      pnlBuy,
      pnlSell,
      buy: data.buy || null,
      sell: data.sell || null,
      signal
    });

  } catch (err) {
    res.json({ error: err.toString() });
  }
});

// 💾 guardar compra
app.get("/set-buy/:price", (req, res) => {
  const data = loadData();
  data.buy = parseFloat(req.params.price);
  saveData(data);
  res.send("Buy saved");
});

// 💾 guardar venta
app.get("/set-sell/:price", (req, res) => {
  const data = loadData();
  data.sell = parseFloat(req.params.price);
  saveData(data);
  res.send("Sell saved");
});

app.listen(3000, () => console.log("Running on port 3000"));