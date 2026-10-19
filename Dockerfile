FROM node:24.19.0-bookworm-slim AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build -- --configuration production

FROM node:24.19.0-bookworm-slim AS production
ENV NODE_ENV=production
ENV UPLOADS_DIR=/data/sobrantes
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev
COPY backend/ ./
COPY --from=frontend-build /app/frontend/www /app/frontend/www
CMD ["npm", "start"]
