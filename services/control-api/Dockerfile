FROM node:24-alpine AS build
WORKDIR /app
COPY services/control-api/package*.json ./
RUN npm ci
COPY services/control-api/tsconfig.json ./
COPY services/control-api/src ./src
RUN npm run build

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY services/control-api/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY services/control-api/src/schema.sql ./dist/schema.sql
USER node
EXPOSE 8787
CMD ["node", "dist/server.js"]
