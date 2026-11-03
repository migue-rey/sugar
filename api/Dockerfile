FROM node:22-alpine3.24 AS dependencies
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM alpine:3.24
RUN apk add --no-cache libstdc++ \
    && addgroup -g 1000 node \
    && adduser -D -u 1000 -G node node
WORKDIR /app
COPY --from=dependencies /usr/local/bin/node /usr/local/bin/node
COPY --from=dependencies /app/node_modules ./node_modules
COPY package*.json ./
COPY src ./src
ENV NODE_ENV=production
USER 1000:1000
EXPOSE 3000
CMD ["node", "src/server.js"]
