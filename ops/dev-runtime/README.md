# SingraPW Dev Runtime

Dieses Verzeichnis dokumentiert die Always-On Dev-Konfiguration auf dem Server.

## Services

- `singrapw-dev-supabase.service` startet den lokalen Supabase-Stack.
- `singrapw-dev-vite.service` startet Vite auf `0.0.0.0:5173`.

## Erreichbarkeit

- Frontend: `http://<server-ip>:5173`
- Supabase API: `http://<server-ip>:54321`
- Supabase Studio: `http://<server-ip>:54323`

## Prüfen

```bash
systemctl status singrapw-dev-supabase.service singrapw-dev-vite.service
ss -ltnp | grep -E ':5173|:5432[1-4]'
```

## Hinweis Port-Freigabe

Auf Host-Ebene läuft hier aktuell keine UFW (`ufw` nicht installiert). Dadurch ist Port 5173
bereits erreichbar, solange kein externer Provider-Firewall-Block aktiv ist.
