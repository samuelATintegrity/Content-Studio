# Multi-stage build: compile TS in a builder image, then a slim runtime
# image with ffmpeg + the bundled fonts.

FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist

# Bundle the same fonts the static pipeline uses, so karaoke subtitles match.
COPY fonts ./fonts

# Bundle outro logo + any other static assets used by ffmpeg.
COPY assets ./assets

ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "dist/index.js"]
