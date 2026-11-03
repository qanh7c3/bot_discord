FROM node:22-slim

ENV NODE_OPTIONS="--dns-result-order=ipv4first"

WORKDIR /app

COPY package*.json ./

RUN npm install --omit=dev

COPY . .

CMD ["node", "--dns-result-order=ipv4first", "index.js"]
