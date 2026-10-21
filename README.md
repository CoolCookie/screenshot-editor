# Screenshot-Editor

Ein Web-Editor für Screenshots nach dem Vorbild von Greenshot, der vollständig im Browser läuft.
Screenshot mit **Strg+V** einfügen, bearbeiten und mit **Strg+C** wieder in die Zwischenablage kopieren.

## Funktionen

- Rahmen, Ellipse, Linie, Pfeil, Freihand, Text, nummerierte Marker, Textmarker
- Unkenntlich machen: **Verpixeln**, **Weichzeichnen**, **Schwärzen**
- Zuschneiden
- Auswählen, Verschieben, Größe ändern, Ebenenreihenfolge, Löschen
- Rückgängig/Wiederholen, Zoom, Tastenkürzel (siehe „Hilfe & Datenschutz“ in der App)
- Export: Zwischenablage (PNG) oder Download als PNG

## Datenschutz (DSGVO)

- Die Bildverarbeitung findet **ausschließlich im Browser** statt. Es gibt kein Backend und keine Uploads.
- Der Server speichert nichts. Das nginx-Access-Log ist abgeschaltet, also werden auch keine IP-Adressen protokolliert.
- Es gibt keine Cookies, kein Local Storage und keine externen Ressourcen (keine CDNs, keine Webfonts, kein Tracking).
- Die Content-Security-Policy `connect-src 'none'` verhindert technisch, dass die Seite Netzwerkverbindungen aufbaut.
- **Hinweis:** Dein Reverse-Proxy protokolliert unter Umständen selbst Zugriffe. Bitte prüfe dort die Log-Einstellungen
  (z. B. ganz abschalten oder IPs anonymisieren).

## Start

```bash
docker compose up -d --build
```

Der Container lauscht auf `127.0.0.1:8080` (HTTP). Für den Betrieb im Netzwerk gehört ein Reverse-Proxy mit HTTPS davor.
Das ist nötig, weil Browser das Schreiben in die Zwischenablage nur über **HTTPS** (oder `localhost`) erlauben.

### Beispiel nginx (Reverse-Proxy)

```nginx
server {
    listen 443 ssl http2;
    server_name screenshot.example.de;
    # ssl_certificate ...; ssl_certificate_key ...;
    access_log off;

    location / {
        proxy_pass http://127.0.0.1:8080;
    }
}
```

### Beispiel Caddy

```
screenshot.example.de {
    reverse_proxy 127.0.0.1:8080
    log {
        output discard
    }
}
```

### Beispiel Traefik

Die Labels sind in der `docker-compose.yml` als Kommentar vorbereitet. Dafür `ports` entfernen und das Proxy-Netzwerk eintragen.

## Browser

Aktuelle Versionen von Chrome, Edge, Firefox (ab 127) und Safari.

## Lizenz

[MIT](LICENSE)

## Struktur

```
app/            statische Web-App (HTML, CSS, JavaScript, keine Abhängigkeiten)
nginx/          nginx-Konfiguration (Sicherheits-Header, kein Logging)
Dockerfile      nginx-unprivileged (läuft nicht als root)
docker-compose.yml
```
