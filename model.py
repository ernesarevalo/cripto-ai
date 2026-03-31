import numpy as np
from sklearn.ensemble import RandomForestRegressor
from sklearn.preprocessing import StandardScaler

def calculate_rsi(prices, period=14):
    gains = []
    losses = []
    for i in range(1, min(period, len(prices))):
        diff = prices[i] - prices[i - 1]
        if diff >= 0:
            gains.append(diff)
        else:
            losses.append(abs(diff))
    avg_gain = np.mean(gains) if gains else 0
    avg_loss = np.mean(losses) if losses else 1
    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))

def calculate_bollinger(prices, period=20):
    if len(prices) < period:
        period = len(prices)
    window = prices[-period:]
    mean = np.mean(window)
    std  = np.std(window)
    return {
        "upper":  mean + 2 * std,
        "middle": mean,
        "lower":  mean - 2 * std
    }

def calculate_macd(prices):
    def ema(p, n):
        k = 2 / (n + 1)
        e = p[0]
        for v in p[1:]:
            e = v * k + e * (1 - k)
        return e
    if len(prices) < 26:
        return 0
    return ema(prices[-12:], 12) - ema(prices[-26:], 26)

FEATURE_SIZE = 13  # 10 returns + volatility + rsi + macd (longitud fija)

def extract_features(window: list) -> list:
    returns = [(window[j] - window[j-1]) / window[j-1]
               for j in range(1, len(window))]
    # Pad o recorta a exactamente 10 elementos para longitud fija
    padded_returns = ([0.0] * (10 - len(returns)) + returns)[-10:]
    volatility = float(np.std(returns)) if returns else 0.0
    rsi  = float(calculate_rsi(window[-15:]))
    macd = float(calculate_macd(window))
    return padded_returns + [volatility, rsi, macd]  # siempre len == 13

def train_model(prices: list):
    X_list, y_list = [], []
    for i in range(30, len(prices) - 1):
        window = prices[i - 30:i]
        X_list.append(extract_features(window))
        y_list.append((prices[i + 1] - prices[i]) / prices[i])

    if len(X_list) < 5:
        return None, None

    X: np.ndarray = np.array(X_list, dtype=np.float64)  # shape (n, 13)
    y: np.ndarray = np.array(y_list,  dtype=np.float64)

    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)

    model = RandomForestRegressor(
        n_estimators=100,
        max_depth=5,
        random_state=42
    )
    model.fit(X_scaled, y)
    return model, scaler

def predict(model, scaler, prices: list) -> float:
    if model is None:
        return 0.0
    window = prices[-30:]
    features: np.ndarray = np.array([extract_features(window)], dtype=np.float64)  # shape (1, 13)
    features_scaled = scaler.transform(features)
    return float(model.predict(features_scaled)[0])

def get_signal(prices, current_price):
    """Retorna señal completa: acción, confianza y métricas."""
    model, scaler = train_model(prices)
    ml_pred = predict(model, scaler, prices)

    rsi  = calculate_rsi(prices)
    bb   = calculate_bollinger(prices)
    macd = calculate_macd(prices)

    # Score técnico
    tech_score = 0
    if rsi < 30:   tech_score += 3
    elif rsi < 45: tech_score += 1.5
    elif rsi > 70: tech_score -= 3
    elif rsi > 60: tech_score -= 1.5

    if current_price < bb["lower"]:   tech_score += 2.5
    elif current_price > bb["upper"]: tech_score -= 2.5
    elif current_price < bb["middle"]: tech_score += 0.5
    else: tech_score -= 0.5

    if macd > 0: tech_score += 1
    else:        tech_score -= 1

    # Score ML normalizado
    ml_score = max(-4, min(4, ml_pred * 800))

    # Score final: 60% técnico + 40% ML
    final_score = tech_score * 0.6 + ml_score * 0.4

    confidence = min(int(abs(final_score) / 6 * 100), 97)
    if final_score >= 1:   action = "COMPRAR"
    elif final_score <= -1: action = "VENDER"
    else:                  action = "MANTENER"

    return {
        "action":      action,
        "confidence":  confidence,
        "final_score": round(final_score, 3),
        "tech_score":  round(tech_score, 3),
        "ml_score":    round(ml_score, 3),
        "ml_pred":     round(ml_pred, 6),
        "rsi":         round(rsi, 2),
        "macd":        round(macd, 2),
        "bb":          {k: round(v, 2) for k, v in bb.items()},
        "sell_target": round(max(bb["upper"], current_price * 1.04) if final_score > 0 else bb["middle"], 2),
        "buy_target":  round(bb["lower"] if final_score < 0 else bb["middle"], 2),
    }