# Timeweb Cloud VPS deployment

This project can run on one VPS:

- PostgreSQL database
- API
- client Telegram bot
- admin Telegram bot
- built Mini App website served by the API

## 1. Create VPS

Recommended minimum:

- Ubuntu 22.04 or 24.04
- 1 CPU
- 1-2 GB RAM
- 20-40 GB SSD

Open ports:

- 80 HTTP
- 443 HTTPS
- 22 SSH

## 2. Install Docker

```bash
sudo apt update
sudo apt install -y ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

## 3. Upload project

```bash
git clone YOUR_GITHUB_REPO_URL yohkar
cd yohkar
cp .env.production.example .env.production
```

Edit `.env.production`:

```bash
nano .env.production
```

Set real values:

- `POSTGRES_PASSWORD`
- `BOT_TOKEN_CLIENT`
- `BOT_TOKEN_ADMIN`
- `ADMIN_TELEGRAM_IDS`
- `WEBAPP_URL`
- `API_BASE_URL`
- `CORS_ORIGIN`
- `VITE_ADMIN_TELEGRAM_IDS`
- `VITE_ADMIN_PIN`

For one-domain setup these URLs can be the same:

```env
WEBAPP_URL=https://your-domain.example
API_BASE_URL=https://your-domain.example
CORS_ORIGIN=https://your-domain.example
```

## 4. Start app

```bash
sudo docker compose up -d --build
sudo docker compose exec api npm run prisma:seed
```

Check logs:

```bash
sudo docker compose logs -f api
sudo docker compose logs -f client-bot
sudo docker compose logs -f admin-bot
```

## 5. Add HTTPS domain

Point your domain DNS A-record to the VPS IP address, then install Nginx and Certbot:

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
```

Create Nginx config:

```bash
sudo nano /etc/nginx/sites-available/yohkar
```

Paste and replace `your-domain.example`:

```nginx
server {
    listen 80;
    server_name your-domain.example;

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable:

```bash
sudo ln -s /etc/nginx/sites-available/yohkar /etc/nginx/sites-enabled/yohkar
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d your-domain.example
```

## 6. BotFather

In BotFather set the Mini App/Web App URL to:

```text
https://your-domain.example
```

## Useful commands

Restart:

```bash
sudo docker compose restart
```

Update after GitHub push:

```bash
git pull
sudo docker compose up -d --build
```

Stop:

```bash
sudo docker compose down
```
