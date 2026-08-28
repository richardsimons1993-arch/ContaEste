FROM node:20-alpine
WORKDIR /app
# Install rclone
RUN apk add --no-cache rclone
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
