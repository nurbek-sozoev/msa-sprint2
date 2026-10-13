# Задание 4. Автоматизация развёртывания и тестирования

# Решение

- Отчёт с описанием изменений — [README.md](results/README.md)
- Вывод `curl` на `/ping` — [ping.png](results/ping.png)
- Вывод `./check-dns.sh` — [check-dns.png](results/check-dns.png)
- Вывод `./check-status.sh` — [check-status.png](results/check-status.png)
- `kubectl get pods` и `kubectl get services` — [kubectl.txt](results/kubectl.txt)
- Лог сборки `gitlab-ci-local` — [build-log.txt](results/build-log.txt)
- `docker image ls` и `minikube image list` — [images.txt](results/images.txt)
- values для staging — [values-staging.yaml](results/values-staging.yaml)
- values для prod — [values-prod.yaml](results/values-prod.yaml)
- Пайплайн — [.gitlab-ci.yml](results/.gitlab-ci.yml)

## Подготовка окружения

Требуемое ПО: Docker, Minikube, Helm, Node.js, gitlab-ci-local.

```bash
# minikube и helm (macOS)
brew install minikube helm

# gitlab-ci-local
npm install -g gitlab-ci-local

# запуск кластера
minikube start --driver=docker
```

## Порядок запуска

1. Собрать Docker-образ:

```bash
cd tasks/task4
docker build -t booking-service:latest ./booking-service
```

2. Запустить пайплайн целиком через `gitlab-ci-local`:

```bash
gitlab-ci-local build test deploy tag
```

Пайплайн собирает образ, проверяет `/ping`, загружает образ в Minikube, устанавливает Helm-релиз `booking-service` с `values-staging.yaml` и создаёт git-тег.

3. Дождаться готовности пода:

```bash
kubectl rollout status deployment/booking-service --timeout=120s
```

## Проверка корректности

Проверка сервиса через port-forward:

```bash
kubectl port-forward svc/booking-service 8080:80 &
sleep 3
curl -s http://localhost:8080/ping
```

Ответ: `pong`.

Проверка флага `ENABLE_FEATURE_X` (в staging `featureX: true`):

```bash
curl -s http://localhost:8080/feature
```

Ответ: `Feature X is enabled!`.

Проверка статуса деплоя:

```bash
./check-status.sh
```

Проверка DNS внутри кластера:

```bash
./check-dns.sh
```

Ответ содержит `pong` и строку об успехе.

## Формирование артефактов

Артефакты собираются после проверки, при запущенном port-forward:

```bash
cd results

kubectl get pods -o wide > results/kubectl.txt
kubectl get services >> results/kubectl.txt

curl -s http://localhost:8080/ping > results/ping.txt

./check-status.sh > results/check-status.txt 2>&1
./check-dns.sh > results/check-dns.txt 2>&1

docker image ls booking-service > results/images.txt
minikube image list >> results/images.txt

cp .gitlab-ci.yml helm/booking-service/values-staging.yaml helm/booking-service/values-prod.yaml results/
```
