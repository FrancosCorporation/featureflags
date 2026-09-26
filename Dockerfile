FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .
ENV FF_DB=/data/flags.db
VOLUME /data
EXPOSE 3500
CMD ["node", "server.js"]
