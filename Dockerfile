# Unprivilegiertes nginx (läuft als Nutzer 101 auf Port 8080)
FROM nginxinc/nginx-unprivileged:1.28-alpine

USER root
RUN rm -rf /usr/share/nginx/html/*
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY app/ /usr/share/nginx/html/
USER 101

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
