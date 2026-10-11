FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
ENV FF_DB=/data/featureflags.db
VOLUME /data
EXPOSE 3500
CMD ["node", "server.js"]
