# Задание 2. Реализация новых сервисов

# Решение

- Лог `docker ps` - [docker-ps.txt](results/docker-ps.txt)
- Доработанный regress.sh (тесты) - [regress.sh](results/test/regress.sh)
- [test-log.txt](results/test-log.txt)
- select * from bookings из новой системы и старой в текстовом виде после выполнения тестов - [bookings-old-db.txt](results/bookings-old-db.txt)/[bookings-new-db.txt](results/bookings-new-db.txt)
- README.md с объяснением стратегии миграции данных при запуске нового сервиса и стратегии To Be - [README.md](results/README.md)
- листинг бронирований, вызванный через REST из монолита и GRPC из микросервиса - [bookings-rest.txt](results/bookings-rest.txt)/[bookings-grpc.txt](results/bookings-grpc.txt)
- select * из таблицы с историческими данными о бронированиях - [booking-history.txt](results/booking-history.txt)

## Состав сервисов

`booking-service` принимает gRPC-запросы на создание и листинг бронирований по контракту `booking.proto`. Проверки пользователя, отеля и промокода выполняются REST-запросами к монолиту. После успешного создания бронирования сервис публикует событие в Kafka-топик `BookingCreated`.

`booking-history-service` подписан на топик `BookingCreated`. Каждое событие записывается в таблицу `booking_history` отдельной базы данных. Аналитика по пользователям, отелям и дням получается SQL-запросами к этой таблице.

Монолит перенаправляет запросы `POST /api/bookings` и `GET /api/bookings` в `booking-service` через gRPC-прокси `GrpcBookingService`.

## Порядок запуска

1. Остановить окружение задания 1, если оно запущено:

```bash
cd tasks/task1
docker compose down
cd ../..
```

2. Создать Docker-сеть, если она не существует:

```bash
docker network create hotelio-net 2>/dev/null || true
```

3. Запустить окружение задания 2:

```bash
cd tasks/task2
docker compose up -d --build
```

Compose поднимает 8 контейнеров: `hotelio-monolith`, `hotelio-db`, `booking-service`, `booking-db`, `booking-history-service`, `history-db`, `kafka`, `zookeeper`. Базы данных имеют healthcheck. Сервисы `booking-service` и `booking-history-service` стартуют после готовности своих баз.

4. Проверить, что прокси активен:

```bash
docker logs hotelio-monolith 2>&1 | grep -A2 "BookingService beans"
```

Ожидаемый вывод:

```
BookingService beans:
    - bookingService: class com.hotelio.monolith.service.BookingService
    - grpcBookingService: class com.hotelio.GrpcBookingService
```

## Запуск тестов

Тесты находятся в `results/test/`. Для запуска нужно собрать Docker-образ и передать параметры подключения ко всем трём базам данных.

```bash
cd results/test
docker build -t hotelio-tester .
cd ..
docker run --rm --network hotelio-net \
  -e DB_HOST=hotelio-db -e DB_PORT=5432 -e DB_NAME=hotelio -e DB_USER=hotelio -e DB_PASSWORD=hotelio \
  -e DB2_HOST=booking-db -e DB2_PORT=5432 -e DB2_NAME=booking -e DB2_USER=booking -e DB2_PASSWORD=booking \
  -e DB3_HOST=history-db -e DB3_PORT=5432 -e DB3_NAME=history -e DB3_USER=history -e DB3_PASSWORD=history \
  -e API_URL=http://hotelio-monolith:8080 \
  hotelio-tester > test-log.txt
```

## Формирование артефактов

Артефакты собираются после успешного прогона тестов, до остановки контейнеров. Тестовый скрипт очищает данные после прогона, поэтому перед сбором артефактов нужно создать бронирование вручную.

1. Вставить тестовые данные в базу монолита:

```bash
docker exec -i hotelio-db psql -U hotelio hotelio < test/init-fixtures.sql
```

2. Создать бронирование:

```bash
curl -X POST "http://localhost:18084/api/bookings?userId=test-user-3&hotelId=test-hotel-1"
curl -X POST "http://localhost:18084/api/bookings?userId=test-user-2&hotelId=test-hotel-1&promoCode=TESTCODE1"
```

3. Формаирование файлов:

```bash
cd results

docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}" \
  --filter "name=booking" --filter "name=hotelio" \
  --filter "name=task2" --filter "name=history" > docker-ps.txt

docker exec hotelio-db psql -U hotelio hotelio -c "SELECT * FROM booking;" > bookings-old-db.txt

docker exec booking-db psql -U booking booking -c "SELECT * FROM booking;" > bookings-new-db.txt

docker exec history-db psql -U history history -c "SELECT * FROM booking_history;" > booking-history.txt

curl -s "http://localhost:18084/api/bookings?userId=test-user-2" > bookings-rest.txt

docker run --rm --network hotelio-net \
  -v "$PWD/..:/proto" fullstorydev/grpcurl \
  -plaintext -import-path /proto -proto booking.proto \
  -d '{"user_id":"test-user-2"}' \
  booking-service:9090 booking.BookingService/ListBookings > bookings-grpc.txt
```

