# 通用镜像：Railway / Fly.io / Oracle / 任何支持 Docker 的地方都能用。
#
# 数据放在 /app/data，部署时把这个目录挂成持久卷。
# 卷第一次挂上来是空的，所以镜像里另存了一份 seed/：
# 数据目录为空时服务会自动把 seed/ 复制过去，第一次部署就带着仓库里的账号和历史。
FROM node:22-alpine

WORKDIR /app

# 只装运行期依赖（前端产物已经在 public/game 里，不需要构建）
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

COPY . .

# 仓库里的 data/ 留一份当种子，运行时数据写在 /app/data（挂卷）
RUN mkdir -p /app/seed \
    && for f in users.json settings.json rounds.json; do \
         if [ -f "/app/data/$f" ]; then cp "/app/data/$f" "/app/seed/$f"; fi; \
       done \
    && rm -rf /app/data \
    && mkdir -p /app/data

ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/app/data
ENV SEED_DIR=/app/seed

EXPOSE 3000
CMD ["node", "server.js"]
