# cripto-ai v3 🟠

Mini plataforma de trading Bitcoin: ML + análisis técnico + multiusuario + historial persistente.

## Estructura

```
cripto-ai/
├── public/
│   └── index.html       ← SPA completa (login, dashboard, operación, historial, mercado, admin)
├── index.js             ← Express API (auth, operaciones, señal ML, IA, market, admin)
├── db.js                ← SQLite con better-sqlite3 (schema + seed admin)
├── auth.js              ← JWT middleware
├── model.py             ← RandomForest ML
├── model_runner.py      ← Fetcher de precios + runner del modelo
├── package.json
├── requirements.txt
├── Dockerfile
└── .env.example
```

## Instalación local

```bash
git clone https://github.com/ernesarevalo/cripto-ai
cd cripto-ai

# Instalar dependencias Node
npm install

# Instalar dependencias Python
pip3 install -r requirements.txt

# Variables de entorno
cp .env.example .env
# Editar .env con tu ANTHROPIC_API_KEY y JWT_SECRET

npm start
# → http://localhost:3000
```

**Login inicial:**
- Usuario: `ernes`
- Contraseña: `adminernes!1`
- Rol: admin

## API Endpoints

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| POST | /api/login | ❌ | Login, devuelve JWT |
| GET | /api/me | ✅ | Perfil del usuario |
| POST | /api/operacion | ✅ | Registrar compra/venta |
| GET | /api/operaciones | ✅ | Historial del usuario |
| DELETE | /api/operaciones | ✅ | Reset historial propio |
| GET | /api/signal | ✅ | Señal ML (caché 60s) |
| POST | /api/analyze | ✅ | Análisis IA personalizado |
| GET | /api/market | ✅ | Altcoins + alertas + arbitraje |
| GET | /api/admin/users | 👑 | Lista todos los usuarios |
| POST | /api/admin/users | 👑 | Crear usuario |
| DELETE | /api/admin/users/:id | 👑 | Eliminar usuario |
| PATCH | /api/admin/users/:id/password | 👑 | Cambiar contraseña |
| DELETE | /api/admin/users/:id/operaciones | 👑 | Reset historial de usuario |

## Deploy en Render

1. Conectar repo GitHub a Render
2. Build command: `npm install && pip3 install -r requirements.txt`
3. Start command: `npm start`
4. Variables de entorno: `ANTHROPIC_API_KEY`, `JWT_SECRET`

## Docker

```bash
docker build -t cripto-ai .
docker run -p 3000:3000 \
  -e ANTHROPIC_API_KEY=sk-ant-xxx \
  -e JWT_SECRET=mi-secreto-seguro \
  cripto-ai
```