# Mi Biblioteca — Organizador de Estanterías

Aplicación web móvil-first (PWA) autoalojada para fotografiar tus estanterías, inventariar tus libros con IA (Gemini o Qwen en Strata), categorizarlos con criterios dinámicos y reorganizar físicamente tus baldas respetando sus medidas reales.

## Estructura

- `backend/` — API REST en **FastAPI** + base de datos local **SQLite** (`data/library.db`).
- `frontend/` — Interfaz **React + Vite + TypeScript + Tailwind CSS (PWA)**.
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
