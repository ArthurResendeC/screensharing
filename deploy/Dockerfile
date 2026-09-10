# Imagem do backend Bun (frontend + signaling + rota /livekit/token).
# O servidor LiveKit é separado (veja deploy/livekit/).
#
# NÃO fica na raiz do repositório de propósito: lá, o Railway trocaria o Railpack
# (que já funciona) por este Dockerfile. Build a partir da raiz:
#   docker build -f deploy/Dockerfile -t reshare-api .
FROM oven/bun:1.4.2 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM oven/bun:1.4.2-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Mantém package.json para que `bun run start` funcione igual ao Railpack; o bundle
# de dist/ é autocontido (assets embutidos via HTML imports do Bun).
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/dist ./dist
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD bun -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["bun", "run", "start"]
