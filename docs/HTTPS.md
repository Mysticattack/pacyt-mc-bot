# HTTPS fuer das Bedienfeld

Ziel: das Panel von aussen nur noch ueber HTTPS erreichen, nicht ueber die offene Portnummer.

Stand: laeuft auf dem Pterodactyl-Node (77.90.60.254).

## nginx (Node)

/etc/nginx/sites-enabled/mcbot.conf:

    server {
        listen 80;
        listen [::]:80;
        server_name bot.mysticattack.de;

        location /.well-known/acme-challenge/ { root /var/www/html; }

        location / {
            proxy_pass http://77.90.60.254:40800;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection upgrade;
            proxy_buffering off;
            proxy_read_timeout 300s;
        }
    }

Wichtig: proxy_pass muss auf die oeffentliche IP zeigen. Pterodactyl veroeffentlicht Allokationen per iptables, deshalb ist 127.0.0.1:40800 auf dem Node nicht erreichbar, 172.18.0.14:40800 (Container) dagegen schon.

## Zertifikat

    certbot --nginx -d bot.mysticattack.de --non-interactive --agree-tos -m missy@mysticattack.de --redirect

Erneuerung uebernimmt der certbot-Timer.

## Offen

Port 40800 ist weiterhin direkt erreichbar, weil Pterodactyl die Allokation oeffentlich veroeffentlicht. Zum Schliessen: nginx auf die Container-IP 172.18.0.14:40800 umstellen und 40800 von aussen sperren. Nachteil: die Container-IP kann sich beim Neustart aendern, dann muss der Upstream nachgezogen werden.
