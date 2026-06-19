# Frontend (Vite + React) production image.
# Build context is the project root, where package.json / vite.config.ts / index.html live.
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
EXPOSE 4173
CMD ["npx", "vite", "preview", "--host", "0.0.0.0", "--port", "4173"]
