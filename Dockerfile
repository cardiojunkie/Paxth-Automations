# syntax=docker/dockerfile:1.7

FROM mcr.microsoft.com/playwright:v1.59.1-noble AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM deps AS build
WORKDIR /app
COPY . .
RUN npm run build

FROM mcr.microsoft.com/playwright:v1.59.1-noble AS runner
ENV NODE_ENV=production
ENV PORT=3000
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/server.ts ./server.ts
COPY --from=build /app/src ./src
COPY --from=build /app/public ./public
COPY --from=build /app/settings ./settings
COPY --from=build /app/sku-index ./sku-index
COPY --from=build /app/firebase-applet-config.json ./firebase-applet-config.json
COPY --from=build /app/firebase-blueprint.json ./firebase-blueprint.json
COPY --from=build /app/firestore.rules ./firestore.rules
COPY --from=build /app/DRAFT_firestore.rules ./DRAFT_firestore.rules
COPY --from=build /app/metadata.json ./metadata.json
COPY --from=build /app/docker/start.sh /usr/local/bin/start.sh

RUN mkdir -p /app/harvest /app/jobs /app/outputs/json /app/outputs/xlsx /app/public/images \
    && chmod +x /usr/local/bin/start.sh \
    && chown -R pwuser:pwuser /app /usr/local/bin/start.sh

USER pwuser
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/sku/index').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/local/bin/start.sh"]
