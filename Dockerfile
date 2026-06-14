# syntax=docker/dockerfile:1.7

FROM mcr.microsoft.com/playwright:v1.59.1-noble AS deps
WORKDIR /app
COPY package*.json ./
COPY scripts/ ./scripts/
ENV INSTALL_PLAYWRIGHT=false
RUN npm ci

FROM deps AS build
WORKDIR /app
COPY . .
RUN mkdir -p /app/public
RUN npm run build

FROM mcr.microsoft.com/playwright:v1.59.1-noble AS prod-deps
WORKDIR /app
COPY package*.json ./
COPY scripts/ ./scripts/
ENV INSTALL_PLAYWRIGHT=false
RUN npm ci --omit=dev

FROM mcr.microsoft.com/playwright:v1.59.1-noble AS runner
ENV NODE_ENV=production
ENV PORT=3000
ENV MAX_CONCURRENT_BROWSER_TASKS=1
WORKDIR /app

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/server.ts ./server.ts
COPY --from=build /app/tsconfig.json ./tsconfig.json
COPY --from=build /app/src ./src
COPY --from=build /app/public ./public
COPY --from=build /app/settings ./settings
COPY --from=build /app/sku-index ./sku-index
COPY --from=build /app/docker/start.sh /usr/local/bin/start.sh

RUN mkdir -p /app/harvest /app/jobs /app/outputs/json /app/outputs/xlsx /app/public/images \
    && chmod +x /usr/local/bin/start.sh \
    && chown -R pwuser:pwuser /app /usr/local/bin/start.sh

USER pwuser
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/local/bin/start.sh"]
