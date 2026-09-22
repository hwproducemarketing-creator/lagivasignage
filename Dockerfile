# Build admin + run Express (SQLite + uploads) on Railway
FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
COPY server/package.json ./server/
COPY admin/package.json ./admin/

RUN npm install

COPY . .

RUN npm run build

ENV NODE_ENV=production
ENV DATA_DIR=/data

EXPOSE 4000

CMD ["npm", "start"]
