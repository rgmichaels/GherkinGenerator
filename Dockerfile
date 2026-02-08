FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server ./server

EXPOSE 8787

ENV PORT=8787

CMD ["node", "server/index.mjs"]
