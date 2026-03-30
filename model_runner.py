import requests
from model import train_model, predict

url = "https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=7"
data = requests.get(url).json()

prices = [p[1] for p in data["prices"]]

model = train_model(prices)
pred = predict(model, prices)

print(pred)