# ---------- 阶段 1：构建前端 ----------
FROM node:20-bookworm-slim AS web-build
WORKDIR /app/web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# ---------- 阶段 2：运行环境（含判题所需编译器） ----------
FROM node:20-bookworm

# 判题要真的编译运行用户代码，镜像里必须有工具链
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential \
      python3 \
      openjdk-17-jdk-headless \
      docker.io \
      ca-certificates \
      tini \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY server/package*.json ./server/
RUN cd server && npm ci

COPY server/ ./server/
RUN cd server && npm run build

COPY --from=web-build /app/web/dist /app/web/dist

ENV NODE_ENV=production \
    PORT=3001 \
    HOST=0.0.0.0

EXPOSE 3001
VOLUME ["/app/server/data"]

WORKDIR /app/server
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/index.js"]
