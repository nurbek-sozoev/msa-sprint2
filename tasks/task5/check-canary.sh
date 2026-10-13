#!/bin/bash

set -e

echo "Checking canary release (90% v1, 10% v2)..."

# Посылаем 100 запросов и считаем распределение по версиям
for i in {1..100}; do curl -s http://localhost:9090/ping; echo; done | sort | uniq -c
