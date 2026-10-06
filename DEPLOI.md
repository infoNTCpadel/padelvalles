# Desplegar PadelVallès a padelvalles.com (VPS, via GitHub)

Guia per a Mathius. Temps estimat: 15 minuts + propagació DNS.

## 0. Abans de començar

- El domini `padelvalles.com` apunta ara al teu allotjament HTML/WordPress
  (198.18.231.157). En canviar el DNS, **aquella web deixarà de servir-se**:
  serà substituïda per PadelVallès.
- Necessites accés SSH al VPS (72.60.80.126), on ja corre la lliga amb Traefik.

## 1. Crear el repo a GitHub

1. A GitHub, crea un repositori nou (p. ex. `infoNTCpadel/padelvalles`), **privat**.
2. Descomprimeix el zip en una carpeta temporal i puja'l:

```bash
unzip padelvalles-desplegament-v1.zip -d padelvalles && cd padelvalles
git remote add origin git@github.com:infoNTCpadel/padelvalles.git
git push -u origin main
```

(el zip ja porta el repo git inicialitzat; el `.env` **no** es puja, està ignorat).

## 2. Clonar al VPS

```bash
# Al VPS, com a root
cd /root
git clone git@github.com:infoNTCpadel/padelvalles.git
cd padelvalles
cp .env.example .env
```

Edita `.env` i posa-hi els teus valors. Genera el secret així:

```bash
openssl rand -hex 32   # copia el resultat a SESSION_SECRET
```

I tria tu la contrasenya d'admin (`ADMIN_EMAIL=admin@padelvalles.com`):

```
PORT=3000
SESSION_SECRET=<el que t'ha donat l'openssl>
ADMIN_EMAIL=admin@padelvalles.com
ADMIN_PASSWORD=<la que triïs tu>
```

La base de dades `data/padelvalles.db` **no** ve al repo (està ignorada
des de la Fase 0): es crea sola en arrencar, amb totes les taules.
Per carregar els 100 clubs i els tornejos inicials, un cop el contenidor
estigui en marxa executa:

```bash
docker compose exec padelvalles node src/seed.js
```

## 3. Comprovar la xarxa de Traefik

El `docker-compose.yml` espera una xarxa externa anomenada `proxy`.
Comprova el nom real al teu VPS:

```bash
docker network ls
```

Si no es diu `proxy`, edita `docker-compose.yml` i canvia el nom
(a la lliga el tens a `/root/liga-soc-padel/docker-compose.yml`, copia'l d'allà).

## 4. Arrencar

```bash
cd /root/padelvalles
docker compose up -d --build
docker compose logs -f   # ha de dir "PadelVallès escoltant al port 3000"
```

## 5. Canviar el DNS

Al panell del teu registrador (on tens padelvalles.com), zona DNS:

| Tipus | Nom | Valor         |
|-------|-----|---------------|
| A     | @   | 72.60.80.126  |
| A     | www | 72.60.80.126  |

Esborra o substitueix els registres A antics (198.18.231.157 / .158).
La propagació triga minuts; comprova-ho amb `ping padelvalles.com`.

## 6. Verificar

- Obre `https://padelvalles.com` → ha de carregar amb certificat vàlid
  (Traefik + Let's Encrypt l'emet sol en detectar el domini).
- Obre `https://www.padelvalles.com` → també ha de funcionar.
- Entra a `https://padelvalles.com/admin` amb `admin@padelvalles.com`
  i la contrasenya del `.env`.
- Un cop dins, ves a **El meu compte → Canvia la contrasenya** i posa'n una de teva.

## 7. Còpia de seguretat (recomanat)

La base de dades viu a `/root/padelvalles/data/padelvalles.db`.
Afegeix-la a la teva rutina de còpies (tens `/root/backup-liga.sh` com a model).

## Actualitzar en el futur

```bash
cd /root/padelvalles
git pull
docker compose up -d --build
```

La carpeta `data/` no està al repo: les dades del servidor es conserven.

## Notes

- Els emails de verificació, de moment, només surten al log del contenidor
  (`docker compose logs`). Caldrà connectar un proveïdor d'email abans
  d'obrir el registre al públic.
- Per aturar: `docker compose down`.
