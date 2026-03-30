FROM node:18

RUN apt-get update && apt-get install -y python3 python3-pip python3-venv

WORKDIR /app

COPY . .

# Crear entorno virtual
RUN python3 -m venv venv

# Activarlo e instalar dependencias
RUN ./venv/bin/pip install --upgrade pip
RUN ./venv/bin/pip install -r requirements.txt

# Instalar node
RUN npm install

# Usar python del venv
ENV PATH="/app/venv/bin:$PATH"

CMD ["node", "index.js"]