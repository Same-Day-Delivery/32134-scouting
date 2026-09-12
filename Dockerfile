# Node 24: node:sqlite is unflagged here, which src/lib/db.ts needs.
FROM node:24-slim

WORKDIR /app

# Dependencies first, so edits to src/ do not re-run npm ci on every build.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# The scoring database lives outside the image so rebuilds do not discard it.
RUN mkdir -p /data && chown node:node /data
VOLUME /data
ENV SCOUTING_DB=/data/scouting.db

# 0.0.0.0 is the container's own interface, not the host's; compose decides
# what is actually reachable from outside.
ENV HOST=0.0.0.0 PORT=4321
EXPOSE 4321

USER node
CMD ["node", "dist/server/entry.mjs"]
