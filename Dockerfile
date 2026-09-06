# ---- 构建阶段：类型检查 + 前端构建 ----
# 国内拉取 node 基础镜像受限时，可覆盖基础镜像：
#   docker build --build-arg NODE_IMAGE=docker.m.daocloud.io/library/node:22-slim -t literag .
ARG NODE_IMAGE=node:22-slim
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- 运行阶段：仅生产依赖 + 产物 ----
# libsql/pdfjs/mammoth 均为纯 JS 或预编译 N-API 二进制，无需编译工具链
FROM ${NODE_IMAGE}
ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server ./server
COPY --from=build /app/dist ./dist

# 数据库/向量缓存目录（建议挂载卷持久化）
VOLUME ["/app/data"]
EXPOSE 3000

# .env 通过挂载或环境变量注入，切勿打进镜像
CMD ["npm", "start"]
