FROM node:20-slim
WORKDIR /app
COPY package.json .
RUN npm install --omit=dev
COPY . .
ENV DATA_DIR=/data
EXPOSE 8080
CMD ["node", "server.js"]
