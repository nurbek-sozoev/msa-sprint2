#!/bin/bash

set -e

echo "Testing fallback route..."

echo "Deleting one v1 pod..."
POD=$(kubectl get pod -l app=booking-service,version=v1 -o name | head -1)
kubectl delete "$POD"

echo "Sending 20 requests..."
ERRORS=0
for i in {1..20}; do
  RESP=$(curl -s --max-time 5 http://localhost:9090/ping)
  echo "$RESP"
  if ! echo "$RESP" | grep -q "pong"; then
    ERRORS=$((ERRORS + 1))
  fi
done

if [ "$ERRORS" -eq 0 ]; then
  echo "Fallback test passed: all 20 responses contain pong"
else
  echo "Fallback test: $ERRORS errors out of 20 requests"
fi
