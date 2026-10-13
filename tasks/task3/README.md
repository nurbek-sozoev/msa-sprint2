# Задание 3. Личный кабинет

# Решение

- Лог `docker ps` — [docker-ps.txt](results/docker-ps.txt)
- Успешный запрос с заголовком `userid` — [success-query.png](results/success-query.png)
- Отказ по ACL с чужим `userid` — [acl-deny.png](results/acl-deny.png)
- Логи booking-subgraph после двух запросов — [booking-subgraph-logs.txt](results/booking-subgraph-logs.txt)
- Report с описанием изменений — [Report.md](results/Report.md)

## Порядок запуска

1. Окружение task 2 должно работать. Если не запущено, то нужно выполнить след.:

```bash
cd tasks/task2
docker compose up -d --build
cd ../..
```

2. Создать Docker-сеть, если она не существует:

```bash
docker network create hotelio-net 2>/dev/null || true
```

3. Вставить тестовые данные. Отель в базу монолита:

```bash
docker exec hotelio-db psql -U hotelio hotelio -c \
  "INSERT INTO hotel (id, operational, fully_booked, city, rating, description) \
   VALUES ('test-hotel-1', true, false, 'Seoul', 4.7, 'Modern hotel in Seoul downtown') \
   ON CONFLICT (id) DO NOTHING;"
```

Бронирование в базу `booking-service`:

```bash
docker exec booking-db psql -U booking booking -c \
  "INSERT INTO booking (user_id, hotel_id, promo_code, discount_percent, price) \
   VALUES ('test-user-2', 'test-hotel-1', 'TESTCODE1', 10, 90);"
```

4. Запустить окружение задания 3:

```bash
cd tasks/task3
docker compose up -d --build
```

Compose поднимает 3 контейнера: `apollo-gateway`, `booking-subgraph`, `hotel-subgraph`. Все подключены к внешней сети `hotelio-net`.

## Проверка корректности

Успешный запрос с заголовком `userid`:

```bash
curl -s http://localhost:4000/ \
  -H 'content-type: application/json' \
  -H 'userid: test-user-2' \
  -d '{"query":"query { bookingsByUser(userId: \"test-user-2\") { id discountPercent hotel { name city } } }"}'
```

Ответ содержит бронирования с данными отеля из двух подграфов.

Отказ по ACL с чужим `userid`:

```bash
curl -s http://localhost:4000/ \
  -H 'content-type: application/json' \
  -H 'userid: test-user-1' \
  -d '{"query":"query { bookingsByUser(userId: \"test-user-2\") { id discountPercent hotel { name city } } }"}'
```

Ответ содержит ошибку с кодом `FORBIDDEN`, данных бронирований нет.

## Формирование артефактов

Артефакты собираются после проверки, до остановки контейнеров:

```bash
cd results

QUERY='{"query":"query { bookingsByUser(userId: \"test-user-2\") { id discountPercent hotel { name city } } }"}'

curl -s http://localhost:4000/ -H 'content-type: application/json' \
  -H 'userid: test-user-2' -d "$QUERY" | python3 -m json.tool > success-query.txt

curl -s http://localhost:4000/ -H 'content-type: application/json' \
  -H 'userid: test-user-1' -d "$QUERY" | python3 -m json.tool > acl-deny.txt

docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}" \
  --filter "name=booking" --filter "name=hotelio" \
  --filter "name=task3" --filter "name=history" > docker-ps.txt

docker logs task3-booking-subgraph-1 > booking-subgraph-logs.txt 2>&1
```
