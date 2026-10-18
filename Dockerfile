# Mediathek – no dependencies, so the image is just Node and the source.
FROM node:22-alpine
WORKDIR /app
COPY package.json server.js ./
COPY lib ./lib
COPY public ./public
ENV NODE_ENV=production PORT=8098 DATA_DIR=/data
VOLUME /data
EXPOSE 8098
HEALTHCHECK --interval=60s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/state').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
