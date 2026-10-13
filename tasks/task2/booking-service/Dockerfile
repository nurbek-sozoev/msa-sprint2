FROM node:20-slim
WORKDIR /app
COPY package.json ./
RUN npm install
COPY booking.proto server.js ./
EXPOSE 9090
CMD ["node", "server.js"]
