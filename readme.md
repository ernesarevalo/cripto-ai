# cripto-ai v2 🟠

Crypto trading AI con ML (RandomForest) + análisis técnico + señales de compra/venta.

## Estructura

```
cripto-ai/
├── public/
│   └── index.html       ← Frontend (BTC Oracle UI)
├── index.js             ← Servidor Express + API endpoints
├── model.py             ← RandomForest ML (port mejorado)
├── model_runner.py      ← Runner: fetch precio → corre modelo → JSON
├── package.json
├── requirements.txt
├── Dockerfile
└── .env.example
```

## Instalación local

```bash
# 1. Clonar
git clone https://github.com/ernesarevalo/cripto-ai
cd cripto-ai

# 2. Instalar dependencias Node
npm install

# 3. Instalar dependencias Python
pip3 install -r requirements.txt

# 4. Crear archivo .env
cp .env.example .env
# Editar .env y poner tu ANTHROPIC_API_KEY

# 5. Correr
npm start
# → http://localhost:3000
```

## API Endpoints

- `GET /api/signal` — Corre el modelo ML y retorna señal de trading
- `POST /api/analyze` — Análisis personalizado con Claude AI

## Variables de entorno

| Variable | Descripción |
|---|---|
| `ANTHROPIC_API_KEY` | API key de Anthropic para análisis IA |
| `PORT` | Puerto del servidor (default: 3000) |

## Docker

```bash
docker build -t cripto-ai .
docker run -p 3000:3000 -e ANTHROPIC_API_KEY=sk-ant-xxx cripto-ai
```