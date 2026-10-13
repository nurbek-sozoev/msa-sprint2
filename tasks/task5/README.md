# Задание 5. Настройка управления трафиком с Istio

# Решение

- Отчёт с описанием изменений — [README.md](results/README.md)
- values для v1 — [values-v1.yaml](results/values-v1.yaml)
- values для v2 — [values-v2.yaml](results/values-v2.yaml)
- VirtualService и Gateway — [virtual-service.yaml](results/virtual-service.yaml)
- DestinationRule — [destination-rule.yaml](results/destination-rule.yaml)
- EnvoyFilter — [envoy-filter.yaml](results/envoy-filter.yaml)
- Лог `check-istio.sh` — [check-istio.txt](results/check-istio.txt)
- Лог `check-canary.sh` — [check-canary.txt](results/check-canary.txt)
- Лог `check-feature-flag.sh` — [check-feature-flag.txt](results/check-feature-flag.txt)
- Лог `check-fallback.sh` — [check-fallback.txt](results/check-fallback.txt)

## Подготовка окружения

Требуемое ПО: Docker, Minikube, Helm, kubectl, istioctl, jq.

```bash
# minikube, helm, istioctl (macOS)
brew install minikube helm istioctl

# запуск кластера
minikube start --driver=docker

# установка Istio
istioctl install --set profile=demo -y

# включение sidecar-инъекции
kubectl label namespace default istio-injection=enabled --overwrite
```

## Порядок запуска

1. Собрать Docker-образ внутри Minikube:

```bash
cd tasks/task5
eval $(minikube docker-env)
docker build -t booking-service:latest ./booking-service
```

2. Развернуть обе версии сервиса через Helm:

```bash
helm upgrade --install booking-v1 ./helm/booking-service -f helm/booking-service/values-v1.yaml
helm upgrade --install booking-v2 ./helm/booking-service -f helm/booking-service/values-v2.yaml
```

3. Пересоздать поды для инъекции sidecar:

```bash
kubectl rollout restart deployment booking-v1 booking-v2
kubectl rollout status deployment booking-v1 --timeout=120s
kubectl rollout status deployment booking-v2 --timeout=120s
```

4. Применить манифесты Istio:

```bash
kubectl apply -f istio/
```

5. Дождаться готовности подов (все 2/2 Running):

```bash
kubectl get pods -l app=booking-service
```

## Проверка корректности

Пробросить порт ingress-шлюза Istio:

```bash
kubectl port-forward -n istio-system svc/istio-ingressgateway 9090:80 &
sleep 3
```

Проверка установки Istio и инъекции:

```bash
./check-istio.sh
```

Поды `istiod`, `istio-ingressgateway`, `istio-egressgateway` в статусе Running. Метка `istio-injection` равна `"enabled"`.

Проверка канареечного разделения трафика:

```bash
./check-canary.sh
```

Из 100 запросов примерно 90 возвращают `pong from v1`, примерно 10 возвращают `pong from v2`.

Проверка фича-флага:

```bash
./check-feature-flag.sh
```

Ответ: `pong from v2`. Запрос с заголовком `X-Feature-Enabled: true` маршрутизируется на v2.

Проверка fallback при отказе пода v1:

```bash
./check-fallback.sh
```

Скрипт удаляет один под v1 и отправляет 20 запросов. Все ответы содержат `pong`. Отказавший экземпляр исключён из балансировки через outlierDetection, повторные попытки закрывают трафик.

## Формирование артефактов

Артефакты собираются после проверки, при запущенном port-forward:

```bash
./check-istio.sh        2>&1 | tee results/check-istio.txt
./check-canary.sh       2>&1 | tee results/check-canary.txt
./check-feature-flag.sh 2>&1 | tee results/check-feature-flag.txt
./check-fallback.sh     2>&1 | tee results/check-fallback.txt

cp helm/booking-service/values-v1.yaml helm/booking-service/values-v2.yaml results/
cp istio/virtual-service.yaml istio/destination-rule.yaml istio/envoy-filter.yaml results/
```
