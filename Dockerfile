# 从仓库根目录构建用的镜像。
#
# 这个仓库根目录是上游「代码判定红包」项目（judge.js 那套），游戏在 mining-game/。
# Railway 默认拿根目录当构建上下文，所以这里再放一个 Dockerfile：
# 即使服务的 Root Directory 没改，也能构建出游戏镜像。
#
# 更推荐的做法是在 Railway 服务设置里把 Root Directory 改成 mining-game，
# 那样用 mining-game/Dockerfile，构建更快。
FROM node:22-alpine

WORKDIR /app

COPY mining-game/package.json mining-game/package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

COPY mining-game/ .

# 仓库里的 data/ 留一份当种子；运行时数据写在 /app/data（挂卷）
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
