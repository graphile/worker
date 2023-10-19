FROM node:18-alpine as builder

WORKDIR /worker/

COPY package.json yarn.lock ./

RUN yarn install --frozen-lockfile --production=false --no-progress

COPY tsconfig.json .eslintrc.js .eslintignore .prettierrc.js ./
COPY ./sql ./sql
COPY ./src ./src 

RUN yarn run prepack

FROM node:18-alpine as clean

COPY package.json yarn.lock /worker/

COPY *.md /worker/
COPY --from=builder /worker/dist/ /worker/dist/
COPY --from=builder /worker/sql/ /worker/sql/

FROM node:18-alpine
LABEL description="High performance Node.js/PostgreSQL job queue "

WORKDIR /worker/
ENTRYPOINT ["./dist/cli.js"]

COPY --from=clean /worker/ /worker/
RUN yarn install --frozen-lockfile --production=true --no-progress && yarn cache clean
