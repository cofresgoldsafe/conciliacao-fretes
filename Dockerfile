# Dockerfile para Implantação 100% Nuvem (Railway / Render / Fly.io)
FROM node:20-slim

# Instala Python3 e dependências necessárias para o parser de PDF
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    && rm -rf /var/lib/apt/lists/*

# Configura ambiente Python
RUN python3 -m pip install --break-system-packages pdfplumber pypdf

# Define o diretório de trabalho
WORKDIR /app

# Copia dependências do Node
COPY package*.json ./
RUN npm install --production

# Copia todo o código da aplicação
COPY . .

# Expõe a porta do servidor
EXPOSE 3000

# Comando para iniciar o servidor
CMD ["node", "server.js"]
