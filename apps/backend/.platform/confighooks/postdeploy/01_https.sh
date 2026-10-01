#!/bin/bash
set -uo pipefail

get_env() { /opt/elasticbeanstalk/bin/get-config environment -k "$1" 2>/dev/null || true; }

DOMAIN="$(get_env CERT_DOMAIN)"
EMAIL="$(get_env CERT_EMAIL)"
APP_PORT="$(get_env PORT)"; APP_PORT="${APP_PORT:-8080}"

if [ -z "$DOMAIN" ] || [ -z "$EMAIL" ]; then
  echo "[https] CERT_DOMAIN or CERT_EMAIL not set, skipping"
  exit 0
fi

WEBROOT=/var/www/letsencrypt
CERTBOT=/opt/certbot/bin/certbot
mkdir -p "$WEBROOT"

# Install certbot once (stays on the instance between deploys)
if [ ! -x "$CERTBOT" ]; then
  echo "[https] installing certbot"
  dnf install -y python3-pip >/dev/null 2>&1 || true
  python3 -m venv /opt/certbot && /opt/certbot/bin/pip install --quiet --upgrade pip certbot \
    || { echo "[https] certbot install failed"; exit 0; }
fi

# Get the certificate (does nothing if a valid one already exists)
"$CERTBOT" certonly --webroot -w "$WEBROOT" -d "$DOMAIN" \
  --email "$EMAIL" --agree-tos --non-interactive --keep-until-expiring \
  || { echo "[https] certbot failed - does $DOMAIN point at this instance?"; exit 0; }

# HTTPS server block. EB resets nginx config on every deploy, so it's rewritten each time
cat > /etc/nginx/conf.d/https.conf <<EOF
server {
    listen 443 ssl;
    server_name $DOMAIN;

    ssl_certificate     /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    client_max_body_size 20M;

    location / {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
EOF

if nginx -t; then
  systemctl reload nginx
else
  echo "[https] nginx config invalid, removing https.conf"
  rm -f /etc/nginx/conf.d/https.conf
  systemctl reload nginx
fi

# Auto-renewal, twice a day
cat > /etc/systemd/system/certbot-renew.service <<EOF
[Unit]
Description=Renew Let's Encrypt certificates

[Service]
Type=oneshot
ExecStart=$CERTBOT renew --quiet --deploy-hook "systemctl reload nginx"
EOF

cat > /etc/systemd/system/certbot-renew.timer <<EOF
[Unit]
Description=Run certbot renew twice a day

[Timer]
OnCalendar=*-*-* 03,15:00:00
RandomizedDelaySec=1h
Persistent=true

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now certbot-renew.timer

echo "[https] HTTPS enabled for $DOMAIN"