# Yohka backups

Перед обновлением сервера сохраняйте полную копию системы на компьютер:

```powershell
cd "C:\Users\oburg\Documents\yohkar"
.\scripts\deploy-with-backup.ps1
```

Скрипт сначала создает backup с сервера, скачивает его на компьютер, а потом обновляет сервер через `git pull` и `docker compose up -d --build`.

На компьютере хранится только последняя копия:

```text
C:\Users\oburg\Documents\yohkar\backups\yohka-latest.tar.gz
C:\Users\oburg\Documents\yohkar\backups\yohka-latest.txt
```

Каждый новый backup перезаписывает `yohka-latest.tar.gz`, поэтому на компьютере не будет 10 старых архивов.

В архив входит:

- `database.dump` - база Postgres с заказами, товарами, статистикой и настройками;
- `.env.production` - токены, домен, пароль админки и настройки;
- `uploads/` - фото товаров и шапки;
- `git-commit.txt` - версия кода, с которой был сделан backup.

Папка `backups/` добавлена в `.gitignore`, поэтому архив не попадет в GitHub.

Если сервер потеряется, этот архив можно использовать для восстановления системы на новом сервере или локально через Docker.
