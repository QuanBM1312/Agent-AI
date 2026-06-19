#!/bin/sh
set -eu

folder="${N8N_USER_FOLDER:-/home/node/.n8n}"
mkdir -p "$folder"
chown -R node:node "$folder" || true

exec su -s /bin/sh node -c "n8n start"
