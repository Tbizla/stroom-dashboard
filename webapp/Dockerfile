FROM node:20-slim
WORKDIR /app
COPY package.json .
RUN npm install --omit=dev
COPY . .
ENV DATA_DIR=/data
# vervolgticket-toegang-van-buitenaf-ronde2.md §5: zonder dit lekt Express' default error-handler
# volledige stacktraces (incl. absolute serverpaden) naar de client bij een fout
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "server.js"]
