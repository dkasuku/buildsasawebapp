# Debian-based image — Prisma needs OpenSSL/libssl, which Alpine (musl) doesn't
# expose in a way Prisma's engines can detect. Debian "slim" + openssl is the
# combination Prisma recommends and avoids the schema-engine "OpenSSL" errors.
FROM node:20-slim
WORKDIR /app
RUN apt-get update -y && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm install --production=false
COPY . .
RUN npx prisma generate
# Apply migrations, then start the long-running API server.
CMD ["sh", "-c", "npx prisma migrate deploy && npm run start"]
