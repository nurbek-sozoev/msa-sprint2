# Отчёт по заданию 4

## Выбор сервиса

За основу взят mock-сервис `booking-service/main.go` из каталога задания. Переносить реальный `booking-service` из задания 2 не стал: ему нужны PostgreSQL, Kafka и монолит, а задание про деплой, а не про инфраструктуру зависимостей.

## Что изменил в коде

В `main.go` добавил два эндпоинта: `/health` отдаёт `ok`, `/ready` отдаёт `ready`. Оба с кодом 200. Существующие `/ping` и `/feature` не трогал.

В Dockerfile менять ничего не пришлось: команды сборки и установки `curl` уже были на месте, только обёрнуты комментариями TODO. Единственное, что сделал, — скопировал `check-dns.sh` в каталог `booking-service/`, иначе `COPY check-dns.sh .` в Dockerfile не находил файл при контексте сборки `./booking-service`.

## Helm-чарт

В исходном `deployment.yaml` не хватало нескольких вещей. Добавил:

- `imagePullPolicy` через `{{ .Values.image.pullPolicy }}` вместо жёстко прописанного `Never`.
- Переменные окружения: `ENABLE_FEATURE_X` из поля `featureX` в values и произвольный список через `.Values.env`.
- Ресурсы контейнера из `.Values.resources`.
- Пробы `livenessProbe` и `readinessProbe` — обе типа `httpGet` на `/ping`, порт 8080.

В `values.yaml` заполнил пустые секции `resources`, `livenessProbe`, `readinessProbe` и добавил `env: []`, `featureX: false`.

## Два набора values

Staging и prod отличаются в пяти местах:

| Параметр | staging | prod |
| --- | --- | --- |
| `replicaCount` | 1 | 2 |
| `featureX` | true | false |
| `image.pullPolicy` | Never | IfNotPresent |
| `resources.limits.cpu` | 250m | 500m |
| `resources.limits.memory` | 128Mi | 256Mi |

`pullPolicy: Never` в staging нужен, потому что образ попадает в Minikube через `minikube image load`, а не из реестра. В prod образ берётся из Docker-реестра, поэтому `IfNotPresent`.

## Пайплайн

Написал `.gitlab-ci.yml` с четырьмя стадиями:

1. `build` — собирает образ `booking-service:latest`.
2. `test` — поднимает контейнер, делает `curl` на `/ping`, проверяет ответ `pong`, убивает контейнер.
3. `deploy` — загружает образ в Minikube и ставит Helm-релиз с values-staging.
4. `tag` — создаёт git-тег формата `deploy-YYYYMMDD-HHMMSS`.

Отдельную стадию для юнит-тестов не добавлял: в mock-сервисе их нет.

## Как переключить на боевой кластер

Убрать строку `minikube image load` из стадии `deploy` и указать `values-prod.yaml` вместо `values-staging.yaml`. Образ будет загружаться из реестра по `pullPolicy: IfNotPresent`.

## Проверка флага ENABLE_FEATURE_X

После деплоя с `values-staging.yaml` (где `featureX: true`) сделал port-forward и запросил `/feature`. Ответ: "Feature X is enabled!". С prod-значениями (`featureX: false`) маршрут `/feature` возвращает 404.
