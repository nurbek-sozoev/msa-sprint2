# Описание внесённых изменений

## Исправления каркаса

### gateway

Параметр `serviceList` удалён из `@apollo/gateway` v2. Заменён на `IntrospectAndCompose` с теми же адресами подграфов.

Заголовки из шлюза в подграфы автоматически не передаются. Добавлен `buildService` с `RemoteGraphQLDataSource`, который копирует заголовок `userid` из входящего запроса в запрос к подграфу. Без этого ACL в `booking-subgraph` не получает `userid`.

### booking-subgraph

В исходной схеме отсутствовало поле `hotel` в типе `Booking`. Добавлено поле `hotel: Hotel` и внешний тип `Hotel @key(fields: "id")`. Резолвер `Booking.hotel` возвращает ссылку `{ __typename: "Hotel", id: booking.hotelId }`. Данные отеля дорезолвивает `hotel-subgraph`.

## Источники данных

### booking-subgraph

Резолвер `bookingsByUser` вызывает метод `ListBookings` сервиса `booking-service` по gRPC. Адрес задаётся переменной `BOOKING_GRPC_ADDR`, значение по умолчанию: `booking-service:9090`.

### hotel-subgraph

Резолвер `Hotel.__resolveReference` и запрос `hotelsByIds` вызывают `GET {MONOLITH_URL}/api/hotels/{id}`. Адрес монолита задаётся переменной `MONOLITH_URL`, значение по умолчанию: `http://monolith:8080`.

Сопоставление полей отеля:

| Поле GraphQL | Источник в монолите  |
|--------------|----------------------|
| `id`         | `id`                 |
| `name`       | `description`        |
| `city`       | `city`               |
| `stars`      | `Math.round(rating)` |

В данных монолита нет полей `name` и `stars`. Поле `name` берётся из `description`, поле `stars` вычисляется как `Math.round(rating)`.

## ACL

Резолвер `bookingsByUser` проверяет заголовок `userid`. Если заголовок отсутствует или его значение не совпадает с аргументом `userId`, резолвер возвращает ошибку с кодом `FORBIDDEN`. Бронирования не возвращаются.

## docker-compose

Все три сервиса подключены к внешней сети `hotelio-net`. Через неё `booking-subgraph` обращается к `booking-service` по gRPC, а `hotel-subgraph` обращается к `monolith` по REST.
