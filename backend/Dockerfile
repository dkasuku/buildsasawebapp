FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production=false
COPY . .
RUN npx prisma generate
CMD ["npm", "run", "start"]
