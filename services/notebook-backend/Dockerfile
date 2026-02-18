FROM node:20-alpine AS build
WORKDIR /app
ENV NODE_ENV=development
COPY package*.json ./
RUN NPM_CONFIG_PRODUCTION=false npm ci --include=dev --no-audit --no-fund
RUN npm install --no-save typescript
COPY . .
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY --from=build /app/dist ./dist
COPY --from=build /app/migrations ./migrations
CMD ["node", "dist/src/index.js"]
