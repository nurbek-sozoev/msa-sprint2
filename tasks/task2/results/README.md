# Задание 2. Результаты

## Стратегия миграции данных

Таблица `booking` в базе `booking-service` при первом запуске пуста. Исторические записи копируются из базы монолита разовой выгрузкой в окно переключения:

```sql
INSERT INTO booking (id, user_id, hotel_id, promo_code, discount_percent, price, created_at)
SELECT id, user_id, hotel_id, promo_code, discount_percent, price, created_at
FROM dblink('host=hotelio-db dbname=hotelio user=hotelio password=hotelio',
            'SELECT id, user_id, hotel_id, promo_code, discount_percent, price, created_at FROM booking')
AS t(id INT, user_id TEXT, hotel_id TEXT, promo_code TEXT, discount_percent FLOAT, price FLOAT, created_at TIMESTAMP);
```

После копирования счётчик последовательности выставляется на максимум:

```sql
SELECT setval('booking_id_seq', (SELECT max(id) FROM booking));
```

После переключения монолит в таблицу `booking` своей базы не пишет. Все запросы на создание и листинг бронирований проходят через gRPC-прокси в `booking-service`.


## Стратегия to be

После задания система движется в следующем направлении:

1. Проверки пользователя, отеля и промокода сейчас выполняются синхронными REST-вызовами из `booking-service` к монолиту. В целевом состоянии эти данные получаются из собственных сервисов `user-service`, `hotel-service`, `promo-service` или через события.
2. Эндпоинт `GET /api/bookings` монолита выводится из эксплуатации. Клиенты переключаются на API `booking-service`.
3. Аналитика читает только таблицу `booking_history` в базе `history-db`. Сервис `booking-history-service` накапливает данные из Kafka без обращения к боевым базам.
4. gRPC-прокси в монолите удаляется после полного переключения клиентов.
