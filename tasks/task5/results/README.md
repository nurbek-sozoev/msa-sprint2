# Описание изменений и решений

## Что изменил в коде

В `main.go` добавил чтение переменной окружения `VERSION`. Если она задана, `/ping` отвечает `pong from v1` или `pong from v2`. Без неё ответ прежний: `pong`. Отдельный образ для v2 не собирал, версия определяется переменными окружения.

## Изменения в Helm-чарте

Чарт из задания 4 не работает с Istio как есть: каждый релиз создаёт свой Service и метку `app: <release-name>`, а Istio ожидает один общий Service и разделение по метке `version`.

Заменил `{{ .Release.Name }}` на `{{ .Chart.Name }}` в метке `app` у Deployment и Service. Добавил метку `version: {{ .Values.version }}` в Deployment. Service обёрнул в `{{- if .Values.service.enabled }}`, чтобы второй релиз не дублировал его.

| Параметр | v1 | v2 |
| --- | --- | --- |
| `replicaCount` | 2 | 1 |
| `version` | v1 | v2 |
| `featureX` | false | true |
| `service.enabled` | true | false |
| `VERSION` (env) | v1 | v2 |

## Манифесты Istio

**Gateway** принимает HTTP на порту 80 через ingress-шлюз. Все проверочные скрипты обращаются к `localhost:9090`, поэтому нужен `kubectl port-forward svc/istio-ingressgateway 9090:80`.

**VirtualService** содержит два маршрута. Первый ловит заголовок `x-feature-route: v2` и отправляет в subset v2. Второй делит трафик 90/10 между v1 и v2, с тремя повторами при 5xx.

**DestinationRule** описывает subset-ы v1 и v2 по метке `version`. Там же Circuit Breaking: лимит 100 TCP-соединений, 10 ожидающих запросов. OutlierDetection выбрасывает экземпляр из балансировки после двух ошибок 5xx на 30 секунд.

**EnvoyFilter** — Lua-скрипт на ingress-шлюзе. Читает заголовок `X-Feature-Enabled`, и если значение `true`, ставит служебный `x-feature-route: v2`. VirtualService маршрутизирует по нему. Напрямую маршрутизировать по `X-Feature-Enabled` в VirtualService нельзя, потому что заголовок приходит от клиента уже после того, как шлюз выбрал маршрут.

## Fallback

В Istio нет прямого маршрута "при ошибке v1 иди в v2". Вместо этого работает связка: outlierDetection исключает сбойные поды v1, retries повторяют запрос на оставшиеся экземпляры, в том числе v2 из канареечного маршрута.

## Изменения в скриптах

`check-canary.sh`: добавил `sort | uniq -c`, чтобы видеть распределение по версиям, а не 100 одинаковых строк.

`check-fallback.sh`: исходный скрипт считал любой ответ curl успехом. Заменил на удаление пода v1, 20 запросов и проверку, что все ответы содержат `pong`.

`check-istio.sh` и `check-feature-flag.sh` не менял.
