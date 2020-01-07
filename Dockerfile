FROM node:12-alpine
RUN apk add --no-cache bash
WORKDIR /app

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile && yarn cache clean

COPY ./__tests__ ./sql ./src ./perfTest ./tsconfig.json ./

RUN yarn prepack

ENTRYPOINT ["yarn"]
CMD ["watch"]