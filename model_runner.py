import sys
import json
import requests
from model import get_signal

def fetch_prices():
    url = (
        "https://api.coingecko.com/api/v3/coins/bitcoin/market_chart"
        "?vs_currency=usd&days=7"
    )
    try:
        response = requests.get(url, timeout=10)
        data = response.json()
    except Exception as e:
        print(json.dumps({"error": f"fetch_failed: {e}"}))
        sys.exit(1)

    if "prices" not in data:
        print(json.dumps({"error": "ERROR_API"}))
        sys.exit(1)

    prices = [p[1] for p in data["prices"]]

    if len(prices) < 30:
        print(json.dumps({"error": "ERROR_DATA_INSUFICIENTE"}))
        sys.exit(1)

    return prices

if __name__ == "__main__":
    prices = fetch_prices()
    current_price = prices[-1]
    result = get_signal(prices, current_price)
    result["current_price"] = round(current_price, 2)
    print(json.dumps(result))