# Frontend (Vite + React) production image.
# Build context is the project root, where package.json / vite.config.ts / index.html live.
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
# VITE_API_URL must be present at BUILD time — Vite bakes it into the bundle.
# Railway passes the service variable of the same name in as this build arg.
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build
EXPOSE 4173
CMD ["npx", "vite", "preview", "--host", "0.0.0.0", "--port", "4173"]
