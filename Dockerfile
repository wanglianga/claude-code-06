# ========== 构建阶段 ==========
FROM node:22-alpine AS builder
WORKDIR /app

# 先装依赖（利用层缓存）
COPY package.json package-lock.json* ./
RUN npm ci || npm install

# 拷贝源码并构建
COPY . .
RUN npm run build

# ========== 运行阶段 ==========
FROM nginx:1.27-alpine AS runtime

# 非 root 用户运行（nginx unprivileged）
RUN apk add --no-cache curl \
  && addgroup -S app && adduser -S app -G app \
  && rm /etc/nginx/conf.d/default.conf \
  && mkdir -p /var/cache/nginx /var/log/nginx /etc/nginx/templates \
  && chown -R app:app /var/cache/nginx /var/log/nginx /etc/nginx /usr/share/nginx

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx/nginx.conf /etc/nginx/nginx.conf
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY nginx/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh && chown app:app /entrypoint.sh

USER app
EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=5s --start-period=8s --retries=5 \
  CMD curl -fsS http://127.0.0.1:8080/healthz || exit 1

CMD ["/entrypoint.sh"]
