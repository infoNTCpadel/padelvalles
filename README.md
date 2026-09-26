# PadelVallès

Plataforma de tornejos de pàdel del Vallès Occidental i Oriental (en català).
Stack: Node 24 + Express + EJS + SQLite (`node:sqlite`, sense dependències natives) + Docker.

## Desenvolupament

```bash
npm install
ADMIN_EMAIL=tu@email.com ADMIN_PASSWORD=clau1234 node src/index.js
# obre http://localhost:3000
```

El compte d'admin es crea sol amb les variables `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

## Desplegament al VPS (amb Traefik)

Igual que la lliga de pàdel:

```bash
# .env amb ADMIN_EMAIL, ADMIN_PASSWORD i SESSION_SECRET
docker compose up -d --build
```

Requereix la xarxa externa `proxy` de Traefik i el resolver `letsencrypt`
(els mateixos que fa servir `Kanbe.padelvalles.com`). El domini `padelvalles.com`
ha d'apuntar amb un registre A al VPS.

Dades persistents a `./data` (SQLite + logos pujats). Afegir `./data` a la
còpia de seguretat diària.

## Estructura

- `src/index.js` — servidor Express
- `src/db.js` — esquema SQLite
- `src/brand.js` — colors i nom de marca (canvia-ho aquí)
- `src/poster.js` — generador del cartell oficial (SVG) de cada torneig
- `src/routes/` — public, auth, player, club, admin
- `views/` — plantilles EJS en català

## Notes

- Els clubs no pugen cartells: el cartell es genera automàticament amb la marca
  (`/torneig/:id/cartell.svg`).
- Tot el que publica un club passa per revisió de l'admin.
- Textos legals de mostra: revisar amb assessor abans del llançament.
