#!/bin/bash
while true; do
  cd /root/openclaw-monitor
  node server.js
  echo "$(date) Monitor crashed, restarting in 3s..."
  sleep 3
done
