FROM node:20-slim
WORKDIR /app
# poppler-utils (pdftoppm/pdfinfo): rasteriseert een geüploade PDF-plattegrond naar PNG vóór de
# tegel-generatie, zie specs/plattegrond-tile-based-plan.md. sharp (package.json) heeft zijn eigen
# prebuilt libvips-binary via npm, geen extra apt-package nodig daarvoor.
RUN apt-get update && apt-get install -y --no-install-recommends poppler-utils && rm -rf /var/lib/apt/lists/*
COPY package.json .
RUN npm install --omit=dev
COPY . .
ENV DATA_DIR=/data
# vervolgticket-toegang-van-buitenaf-ronde2.md §5: zonder dit lekt Express' default error-handler
# volledige stacktraces (incl. absolute serverpaden) naar de client bij een fout
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "server.js"]
