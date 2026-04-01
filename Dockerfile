FROM node:20-slim
RUN apt-get update && apt-get install -y python3 python3-pip build-essential --no-install-recommends && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip3 install --break-system-packages -r requirements.txt
COPY package*.json .
RUN npm install
COPY . .
EXPOSE 3000
CMD ["node", "index.js"]