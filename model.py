import numpy as np
from sklearn.ensemble import RandomForestRegressor

def calculate_rsi(prices, period=14):
    gains = []
    losses = []

    for i in range(1, period):
        diff = prices[i] - prices[i-1]
        if diff >= 0:
            gains.append(diff)
        else:
            losses.append(abs(diff))

    avg_gain = np.mean(gains) if gains else 0
    avg_loss = np.mean(losses) if losses else 1

    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))


def train_model(prices):
    X = []
    y = []

    for i in range(30, len(prices)-1):
        window = prices[i-30:i]

        returns = [(window[j] - window[j-1]) / window[j-1] for j in range(1, len(window))]
        volatility = np.std(returns)
        rsi = calculate_rsi(window[-15:])

        features = returns[-10:] + [volatility, rsi]

        X.append(features)
        y.append((prices[i+1] - prices[i]) / prices[i])

    model = RandomForestRegressor(n_estimators=100)
    model.fit(X, y)

    return model


def predict(model, prices):
    window = prices[-30:]

    returns = [(window[j] - window[j-1]) / window[j-1] for j in range(1, len(window))]
    volatility = np.std(returns)
    rsi = calculate_rsi(window[-15:])

    features = returns[-10:] + [volatility, rsi]

    pred = model.predict([features])[0]
    return pred