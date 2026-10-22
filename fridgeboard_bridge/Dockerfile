FROM node:22-alpine
WORKDIR /app
COPY app/ /app/
ENV DATA_DIR=/data NODE_ENV=production
CMD ["node", "/app/bridge.js"]
