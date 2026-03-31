FROM node:20-slim

# Instalar Python y pip
RUN apt-get update && apt-get install -y python3 python3-pip python3-venv --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependencias Python
COPY requirements.txt .
RUN pip3 install --break-system-packages -r requirements.txt

# Dependencias Node
COPY package*.json .
RUN npm install

# Código fuente
COPY . .

EXPOSE 3000
CMD ["node", "index.js"]