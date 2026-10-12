#!/usr/bin/env bash
# تشغيل: E2E_PG_ADMIN_URL=postgresql://user:pass@localhost:5432/postgres bash scripts/postgrest-smoke.sh
# بيحمّل PostgREST (لو مش موجود)، وبيبني قاعدة فاضية من schema.sql، وبيجرّب الواجهة البرمجية الحقيقية.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${E2E_PG_ADMIN_URL:?حدد E2E_PG_ADMIN_URL}"
export PGOPTIONS="-c client_min_messages=warning"
BASE="${E2E_PG_ADMIN_URL%/*}"; DB=calma_pgrst_smoke; W="$(mktemp -d)"
PGRST_BIN="${PGRST_BIN:-$W/postgrest}"
if [ ! -x "$PGRST_BIN" ]; then
  curl -sSL --fail -o "$W/p.tar.xz" https://github.com/PostgREST/postgrest/releases/download/v12.2.3/postgrest-v12.2.3-linux-static-x64.tar.xz
  tar -xf "$W/p.tar.xz" -C "$W"
fi
psql "$E2E_PG_ADMIN_URL" -qc "drop database if exists $DB with (force)" -c "create database $DB"
U="$BASE/$DB"
psql "$U" -v ON_ERROR_STOP=1 -q -f supabase/tests/stub_supabase.sql >/dev/null 2>&1
psql "$U" -v ON_ERROR_STOP=1 -q -f supabase/schema.sql
psql "$U" -v ON_ERROR_STOP=1 -q <<'SQL'
create or replace function auth.uid() returns uuid language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
do $$ begin if not exists (select 1 from pg_roles where rolname='authenticator') then create role authenticator noinherit login password 'pw'; end if; end $$;
grant anon, authenticated to authenticator;
grant usage on schema public, auth to anon, authenticated;
grant all on all tables in schema public to authenticated;
grant select on all tables in schema public to anon;
grant all on all sequences in schema public to authenticated;
insert into auth.users(id,email) values ('11111111-1111-1111-1111-111111111111','st1@calma.internal'),('22222222-2222-2222-2222-222222222222','res1@calma.internal');
insert into profiles(id,username,name,role) values ('11111111-1111-1111-1111-111111111111','st1','Ahmed','staff'),('22222222-2222-2222-2222-222222222222','res1','Rawan','reservations');
insert into shift_claims(date,shift_key,username,name) select hotel_today(),'morning','st1','Ahmed';
insert into shift_records(date,shift_key,staff_name,staff_username,rows) select hotel_today(),'morning','Ahmed','st1','[]'::jsonb;
SQL
HOSTPORT="${U#*@}"
cat > "$W/pgrst.conf" <<CONF
db-uri = "postgresql://authenticator:pw@${HOSTPORT}"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "super-secret-jwt-token-with-at-least-32-characters-long"
server-port = 3000
CONF
"$PGRST_BIN" "$W/pgrst.conf" >"$W/pgrst.log" 2>&1 & PG_PID=$!
cat > "$W/gw.mjs" <<'JS'
import http from "node:http";
http.createServer((req, res) => {
  const p = http.request({ host: "localhost", port: 3000, path: req.url.replace(/^\/rest\/v1/, "") || "/", method: req.method, headers: req.headers }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
  req.pipe(p);
}).listen(3001);
JS
node "$W/gw.mjs" & GW_PID=$!
trap 'kill $PG_PID $GW_PID 2>/dev/null || true; psql "$E2E_PG_ADMIN_URL" -qc "drop database if exists $DB with (force)" || true' EXIT
for i in $(seq 1 30); do curl -s localhost:3000/ >/dev/null 2>&1 && break; sleep 1; done
node scripts/postgrest-smoke.mjs
# فحص التطابق بعد السيناريو: لازم مفيش ولا صف "خطأ" (supabase/ops/reconcile.sql)
BAD="$(psql "$U" -At -f supabase/ops/reconcile.sql | grep '^خطأ' || true)"
if [ -n "$BAD" ]; then echo "FAIL reconcile:"; echo "$BAD"; exit 1; fi
echo "PASS reconcile: الفلوس متطابقة بعد السيناريو"
