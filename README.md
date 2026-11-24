# Mi Biblioteca — Organizador de Estanterías

Aplicación web móvil-first (PWA) autoalojada para fotografiar tus estanterías, inventariar tus libros con IA (Gemini o Qwen en Strata), categorizarlos con criterios dinámicos y reorganizar físicamente tus baldas respetando sus medidas reales.

## Estructura

- `backend/` — API REST en **FastAPI** + base de datos local **SQLite** (`data/library.db`).
- `frontend/` — Interfaz **React + Vite + TypeScript + Tailwind CSS (PWA)**.
- `docs/ARCHITECTURE.md` — Documentación técnica completa (arquitectura, modelo de datos, lógica de negocio y API).
- `data/` — Base de datos y fotos de baldas escaneadas (ignorado en Git).

## Configuración inicial

1. Copia el archivo de variables de entorno y rellena tus claves de IA:
   ```bash
   cp .env.example .env
   ```

2. Backend (Python):
   ```bash
   cd backend
   python3 -m venv .venv
   .venv/bin/pip install -r requirements.txt
   ```

3. Frontend (React):
   ```bash
   cd frontend
   npm install
   ```

## Cómo ejecutarlo en tu red local

### Modo desarrollo (recarga en vivo)
Terminal 1 (Backend):
```bash
cd backend
.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

Terminal 2 (Frontend):
```bash
cd frontend
npm run dev
```
Abre `http://localhost:5173` en tu PC o `http://<IP-DE-TU-PC>:5173` desde el móvil.

### Modo un solo puerto (uso diario)
Compila el frontend una vez y sirve todo desde FastAPI:
```bash
cd frontend && npm run build
cd ../backend && .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000
```
Abre `http://<IP-DE-TU-PC>:8000` desde tu PC o móvil en la misma red Wi-Fi.

### Modo HTTPS con Tailscale (recomendado para cámara ISBN en vivo y PWA)
Con Tailscale obtienes un certificado HTTPS real de confianza (`https://<tu-pc>.<tu-tailnet>.ts.net`), privado dentro de tu red Tailscale, sin avisos de seguridad en el móvil:

1. Instala y conecta Tailscale en este PC (Arch / Omarchy):
   ```bash
   sudo pacman -S tailscale
   sudo systemctl enable --now tailscaled
   sudo tailscale up --operator=$USER
   ```
2. Activa **MagicDNS** y **HTTPS Certificates** en [login.tailscale.com/admin/dns](https://login.tailscale.com/admin/dns).
3. Instala la app de **Tailscale** en tu móvil con la misma cuenta.
4. Arranca la biblioteca con el script incluido:
   ```bash
   ./scripts/start-tailscale.sh
   ```
5. Abre en tu móvil la URL `https://redqueen.<tu-tailnet>.ts.net` que mostrará el script. Para desactivar el proxy HTTPS más adelante: `tailscale serve reset`.

## Licencia

Este proyecto se distribuye bajo la licencia [MIT](LICENSE).
