FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY server.js ./
COPY backend ./backend
COPY frontend ./frontend
COPY frontend-v2 ./frontend-v2
COPY scripts ./scripts

EXPOSE 3000

CMD ["node", "server.js"]
