FROM node:20-bookworm-slim AS ui
WORKDIR /ui
COPY package.json ./
RUN npm install
COPY index.html vite.config.js ./
COPY public ./public
COPY src ./src
RUN npm run build

FROM node:20-bookworm-slim AS api
WORKDIR /app
RUN apt-get update && apt-get install -y python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server ./
COPY src/data.js /src/data.js
RUN npx prisma generate

FROM node:20-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV STATIC_DIR=/app/ui
COPY --from=api /app /app
COPY --from=ui /ui/dist /app/ui
EXPOSE 4000
CMD ["sh", "-c", "npx prisma migrate deploy && npx tsx src/index.ts"]
