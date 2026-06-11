FROM node:22-alpine AS build

WORKDIR /app

COPY package*.json ./
COPY apps ./apps
COPY packages ./packages
COPY tsconfig.base.json ./

RUN npm ci

ARG VITE_API_URL=""
ENV VITE_API_URL=$VITE_API_URL

RUN npm run build

FROM node:22-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app ./

EXPOSE 4000

CMD ["npm", "run", "start", "-w", "@yohkar/api"]
