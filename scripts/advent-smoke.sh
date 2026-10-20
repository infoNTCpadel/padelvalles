#!/usr/bin/env bash
# Test de fum del mòdul Calendari d'Advent (src/routes/advent.js).
#
# MAI no s'executa contra data/ real: arrenca el servidor amb DATA_DIR
# apuntant a una CÒPIA de la BD a /tmp i amb ADVENT_SIM_DATE=2026-12-05.
# Comprova el checksum de data/padelvalles.db abans i després (ha de ser
# idèntic) i deixa el directori temporal net.
#
# Ús: bash scripts/advent-smoke.sh
set -u
cd "$(dirname "$0")/.."
REPO="$PWD"
PORT="${PORT:-3217}"
BASE="http://127.0.0.1:$PORT"
TMPD="$(mktemp -d /tmp/pv-advent-test-XXXXXX)"
cp "$REPO/data/padelvalles.db" "$TMPD/padelvalles.db"
ABANS="$(md5sum "$REPO/data/padelvalles.db" | cut -d' ' -f1)"

DATA_DIR="$TMPD" PORT="$PORT" ADVENT_SIM_DATE=2026-12-05 SESSION_SECRET=testsecret \
  ADMIN_EMAIL=admin@prova.local ADMIN_PASSWORD=adminprova123 \
  node src/index.js > "$TMPD/server.log" 2>&1 &
SRV=$!

neteja() {
  kill "$SRV" 2>/dev/null; wait "$SRV" 2>/dev/null
  rm -rf "$TMPD"
}
trap neteja EXIT

ok=0; ko=0
check() { # check <condició 0/1> <missatge>
  if [ "$1" -eq 0 ]; then echo "✅ $2"; ok=$((ok+1)); else echo "❌ $2"; ko=$((ko+1)); fi
}
conte() { grep -q -- "$2" "$1"; }        # fitxer conté patró
no_conte() { ! grep -q -- "$2" "$1"; }   # fitxer NO conté patró
sql() { sqlite3 "$TMPD/padelvalles.db" "$1"; }

# Espera que el servidor respongui
for _ in $(seq 1 60); do curl -sf "$BASE/" >/dev/null 2>&1 && break; sleep 0.3; done
curl -sf "$BASE/" >/dev/null 2>&1; check $? "servidor de prova aixecat (port $PORT, DATA_DIR=$TMPD)"

JAR_A="$TMPD/a.cookies"; JAR_B="$TMPD/b.cookies"; JAR_ADM="$TMPD/adm.cookies"

# --- 1. Ocult: cap enllaç des de la web pública ---
curl -s "$BASE/" > "$TMPD/home.html"
no_conte "$TMPD/home.html" "calendari"; check $? "la portada no conté cap referència a /calendari"
! grep -qi "calendari" views/layout.ejs views/index.ejs; check $? "ni el layout ni la vista d'inici hi fan referència"
curl -s "$BASE/sitemap.xml" > "$TMPD/sitemap.xml"
no_conte "$TMPD/sitemap.xml" "calendari"; check $? "el sitemap no inclou /calendari"

# --- 2. El calendari respon i respecta el temps (simulat: 5 de desembre) ---
curl -s "$BASE/calendari" > "$TMPD/cal-anon.html"
conte "$TMPD/cal-anon.html" "noindex"; check $? "/calendari respon 200 i porta meta noindex"
conte "$TMPD/cal-anon.html" "Bote de pelotas"; check $? "el dia 1 (passat) mostra el premi públicament, sense login"
no_conte "$TMPD/cal-anon.html" "Protector de pala"; check $? "el dia 6 (futur) està bloquejat: no es veu el premi"

# --- 3. Sense login no es pot obrir la casella del dia ---
RESP="$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' -X POST "$BASE/calendari/obre")"
echo "$RESP" | grep -q "302 .*\/entra"; check $? "POST /calendari/obre sense sessió redirigeix a /entra"

# --- 4. Usuari A: registre, obertura del dia 5 (quiz) encertat ---
curl -s -c "$JAR_A" -b "$JAR_A" -o /dev/null -X POST "$BASE/registre" \
  --data-urlencode "nom=Anna Prova" --data-urlencode "email=anna@prova.local" \
  --data-urlencode "contrasenya=prova123" --data-urlencode "next=/calendari"
AID="$(sql "SELECT id FROM users WHERE email='anna@prova.local'")"
[ -n "$AID" ]; check $? "usuari A registrat (id=$AID)"
curl -s -c "$JAR_A" -b "$JAR_A" "$BASE/calendari" > "$TMPD/cal-a.html"
CODE_A="$(grep -oE 'ref=[A-F0-9]{8}' "$TMPD/cal-a.html" | head -1 | cut -d= -f2)"
[ -n "$CODE_A" ]; check $? "A veu el seu enllaç de referit (codi $CODE_A)"

CORRECTA="$(sql "SELECT quiz_correct FROM advent_days WHERE day=5")"
curl -s -c "$JAR_A" -b "$JAR_A" -o /dev/null -X POST "$BASE/calendari/obre" --data "resposta=$CORRECTA"
[ "$(sql "SELECT correct FROM advent_opens WHERE user_id=$AID AND day=5")" = "1" ]
check $? "A ha obert la casella del dia 5 i ha encertat el quiz"
[ "$(sql "SELECT COALESCE(SUM(points),0) FROM advent_entries WHERE user_id=$AID")" = "2" ]
check $? "A suma 2 participacions (open + quiz)"

# --- 5. Usuari B: referit per A, quiz fallat, verificació d'email ---
curl -s -c "$JAR_B" -b "$JAR_B" -o /dev/null "$BASE/registre?ref=$CODE_A"
curl -s -c "$JAR_B" -b "$JAR_B" -o /dev/null -X POST "$BASE/registre" \
  --data-urlencode "nom=Bernat Prova" --data-urlencode "email=bernat@prova.local" \
  --data-urlencode "contrasenya=prova123" --data-urlencode "next=/calendari"
BID="$(sql "SELECT id FROM users WHERE email='bernat@prova.local'")"
[ "$(sql "SELECT referred_by_id FROM users WHERE id=$BID")" = "$AID" ]
check $? "B queda vinculat a A com a referit (referred_by_id)"
ERRADA=$(( (CORRECTA + 1) % 3 ))
curl -s -c "$JAR_B" -b "$JAR_B" -o /dev/null -X POST "$BASE/calendari/obre" --data "resposta=$ERRADA"
[ "$(sql "SELECT correct FROM advent_opens WHERE user_id=$BID AND day=5")" = "0" ]
check $? "B obre la casella però falla el quiz (correct=0)"
[ "$(sql "SELECT COALESCE(SUM(points),0) FROM advent_entries WHERE user_id=$BID")" = "1" ]
check $? "B suma només 1 participació (open)"

TOKEN="$(sql "SELECT token FROM email_tokens WHERE user_id=$BID LIMIT 1")"
curl -s -c "$JAR_B" -b "$JAR_B" -o /dev/null "$BASE/verifica/$TOKEN"
[ "$(sql "SELECT COUNT(*) FROM advent_entries WHERE user_id=$AID AND source='referral' AND ref_key='$BID'")" = "1" ]
check $? "en verificar B, A rep les entrades 'referral' (+2)"
[ "$(sql "SELECT COALESCE(SUM(points),0) FROM advent_entries WHERE user_id=$AID")" = "4" ]
check $? "A suma 4 participacions en total"

# Idempotència: una segona verificació de B no torna a abonar
sql "INSERT INTO email_tokens (user_id, token) VALUES ($BID, 'tokentest2')"
curl -s -o /dev/null "$BASE/verifica/tokentest2"
[ "$(sql "SELECT COUNT(*) FROM advent_entries WHERE user_id=$AID AND source='referral'")" = "1" ]
check $? "la segona verificació de B no duplica l'abonament de referit"

# --- 6. Admin: pàgina del mòdul i sorteig diari ---
curl -s -c "$JAR_ADM" -b "$JAR_ADM" -o /dev/null -X POST "$BASE/entra" \
  --data-urlencode "email=admin@prova.local" --data-urlencode "contrasenya=adminprova123"
curl -s -c "$JAR_ADM" -b "$JAR_ADM" "$BASE/admin/advent" > "$TMPD/admin-advent.html"
conte "$TMPD/admin-advent.html" "Contingut dels 24 dies"; check $? "l'admin veu la pàgina del Calendari d'Advent"
curl -s -c "$JAR_ADM" -b "$JAR_ADM" -o /dev/null -X POST "$BASE/admin/advent/sorteig-diari" --data "day=5"
GUANYADOR="$(sql "SELECT winner_user_id FROM advent_draws WHERE scope='daily' AND day=5")"
[ "$GUANYADOR" = "$AID" ] || [ "$GUANYADOR" = "$BID" ]
check $? "el sorteig diari del dia 5 produeix un guanyador entre qui ha obert (uid=$GUANYADOR)"
NOM_GUANYADOR="$(sql "SELECT name FROM users WHERE id=$GUANYADOR")"
curl -s "$BASE/calendari" > "$TMPD/cal-final.html"
conte "$TMPD/cal-final.html" "$NOM_GUANYADOR"; check $? "la pàgina pública mostra el guanyador del dia 5 ($NOM_GUANYADOR)"

# --- 7. Classificació: A (4) davant de B (1) ---
sed -n '/Classificació de participacions/,$p' "$TMPD/cal-final.html" > "$TMPD/ranquing.html"
L_A="$(grep -n 'Anna Prova' "$TMPD/ranquing.html" | head -1 | cut -d: -f1)"
L_B="$(grep -n 'Bernat Prova' "$TMPD/ranquing.html" | head -1 | cut -d: -f1)"
[ -n "$L_A" ] && [ -n "$L_B" ] && [ "$L_A" -lt "$L_B" ]
check $? "la classificació pública ordena A (4) davant de B (1)"

# --- 8. La BD real no s'ha tocat ---
DESPRES="$(md5sum "$REPO/data/padelvalles.db" | cut -d' ' -f1)"
[ "$ABANS" = "$DESPRES" ]; check $? "data/padelvalles.db intacta (md5 $ABANS)"

echo
echo "Resultat: $ok correctes, $ko fallades"
if [ "$ko" -gt 0 ]; then
  echo "--- Darrers logs del servidor de prova ---"
  tail -30 "$TMPD/server.log"
  exit 1
fi
echo "Tots els tests de fum han passat. 🎄"
