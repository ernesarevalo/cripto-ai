import express from "express";
import fetch from "node-fetch";
import { execSync } from "child_process";

const app = express();

let entryPrice = null;

app.get("/", (req, res) => {
  res.send("Crypto AI running 🚀");
});

async function getPrices() {
  const res = await fetch(
    "https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=7"
  );

  const data = await res.json();

  // 🔴 VALIDACIÓN CLAVE
  if (!data.prices) {
    throw new Error("CoinGecko API error: no prices returned");
  }

  return data.prices.map(p => p[1]);
}

app.get("/btc", async (req, res) => {
  try {
    const prices = await getPrices();
    const current = prices[prices.length - 1];

    const prediction = execSync("python3 model_runner.py").toString();

    const pnl = entryPrice
      ? ((current - entryPrice) / entryPrice) * 100
      : null;

    res.json({
      current,
      pnl,
      prediction
    });

  } catch (err) {
    console.error(err);

    res.json({
      error: "API failed",
      detail: err.toString()
    });
  }
});

app.get("/set-entry/:price", (req, res) => {
  entryPrice = parseFloat(req.params.price);
  res.send("Entry price saved");
});

app.listen(3000, () => console.log("Running on port 3000"));