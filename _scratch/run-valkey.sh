#!/bin/bash

docker run -d \
    --name \
    vibetunnel-valkey \
    -p 6379:6379 \
    -v /shared/data/vibetunnel-valkey:/data \
    valkey/valkey:latest \
    valkey-server \
    --save 60 1 \
    --loglevel warning
