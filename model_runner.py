import requests
from model import train_model, predict

url = "https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=7"

response = requests.get(url)
data = response.json()

# VALIDACIÓN
if "prices" not in data:
    print("ERROR_API")
    exit()

prices = [p[1] for p in data["prices"]]

if len(prices) < 30:
    print("ERROR_DATA")
    exit()

model = train_model(prices)
pred = predict(model, prices)

print(pred)