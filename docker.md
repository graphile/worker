start dependencies and build

```
docker-compose up -d db
docker-compose up [--build] app
```

run tests in another terminal

```
cat __tests__/reset-db.sql | docker exec -i graphile-worker_db_1 psql -U postgres graphile_worker_test
docker-compose exec app yarn jest -i
```
