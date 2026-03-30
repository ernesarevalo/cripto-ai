import express from "express";
import fetch from "node-fetch";
import { execSync } from "child_process";
import fs from "fs";

const app = express();

app.use(express.static("public"));

const DATA_FILE = "./data.json";

function loadData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE));
  } catch {
    return {};
  }
}

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

function getSignal(prediction, rsi) {
  if (prediction > 0.015 && rsi < 65) return "BUY";
  if (prediction < -0.015 && rsi > 60) return "SELL";
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

    let position = null;
    let percent = null;

    if (data.buy) {
      position = "BUY";
      percent = ((current - data.buy) / data.buy) * 100;
    }

    if (data.sell) {
      position = "SELL";
      percent = ((data.sell - current) / data.sell) * 100;
    }

    const signal = getSignal(prediction, rsi);

    res.json({
      current,
      prediction,
      rsi,
      signal,
      position,
      percent,
      buy: data.buy || null,
      sell: data.sell || null
    });

  } catch (err) {
    res.json({ error: err.toString() });
  }
});

app.get("/set-buy/:price", (req, res) => {
  const data = loadData();

  data.buy = parseFloat(req.params.price);
  delete data.sell; // 🔥 BORRA venta

  saveData(data);

  res.send("Buy saved");
});

app.get("/set-sell/:price", (req, res) => {
  const data = loadData();

  data.sell = parseFloat(req.params.price);
  delete data.buy; // 🔥 BORRA compra

  saveData(data);

  res.send("Sell saved");
});

app.listen(3000, () => console.log("Running on port 3000"));