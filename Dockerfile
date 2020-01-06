# common base image for development and production
FROM node:10.18.0-alpine AS base
RUN apk add --no-cache bash
WORKDIR /app

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile && yarn cache clean

COPY . .

RUN yarn prepack

ENTRYPOINT ["yarn"]
CMD ["watch"]