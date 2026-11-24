#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${APP_PORT:-8000}"

if ! command -v tailscale >/dev/null 2>&1; then
  echo "Tailscale no está instalado. Instálalo primero con:"
  echo "  sudo pacman -S tailscale && sudo systemctl enable --now tailscaled && sudo tailscale up"
  exit 1
fi

if ! tailscale status >/dev/null 2>&1; then
  echo "Tailscale no está conectado. Ejecuta:"
  echo "  sudo tailscale up"
  exit 1
fi

echo "Configurando Tailscale Serve (HTTPS privado en tu tailnet -> http://127.0.0.1:${PORT})..."
tailscale serve --bg "http://127.0.0.1:${PORT}"

echo ""
echo "Estado de Tailscale Serve:"
tailscale serve status
echo ""
echo "Iniciando backend FastAPI en 127.0.0.1:${PORT} (Ctrl+C para detener)..."
echo "Nota: para desactivar el proxy HTTPS de Tailscale cuando quieras: tailscale serve reset"
echo ""

cd "${ROOT_DIR}/backend"
exec .venv/bin/uvicorn app.main:app \
  --host 127.0.0.1 \
  --port "${PORT}" \
  --log-level debug \
  --proxy-headers \
  --forwarded-allow-ips="127.0.0.1"
