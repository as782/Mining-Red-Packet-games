# 通用镜像：Railway / Fly.io / Oracle / 任何支持 Docker 的地方都能用。
# 数据放在 /app/data，部署时把这个目录挂成持久卷即可。
FROM node:22-alpine

WORKDIR /app

# 只装运行期依赖（前端产物已经在 public/game 里，不需要构建）
COPY package*.json ./
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/app/data

RUN mkdir -p /app/data
VOLUME ["/app/data"]

EXPOSE 3000
CMD ["node", "server.js"]
