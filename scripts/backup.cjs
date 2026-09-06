#!/usr/bin/env node
// Backup completo de la base a JSON. Sin dependencias.
//
//   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node scripts/backup.cjs [destino]
//
// La service key NUNCA va en este archivo: se pasa por variable de entorno.
const fs = require("fs");
const path = require("path");

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
if (!URL || !KEY) {
  console.error("Faltan SUPABASE_URL y/o SUPABASE_SERVICE_KEY");
  process.exit(1);
}
const H = { apikey: KEY, Authorization: "Bearer " + KEY };

const stamp = () => {
  const d = new Date(), p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

// PostgREST corta en 1000 filas por defecto, así que hay que paginar.
async function fetchAll(tabla) {
  const out = [];
  for (let desde = 0; ; desde += 1000) {
    const r = await fetch(`${URL}/rest/v1/${tabla}?select=*&limit=1000&offset=${desde}`, { headers: H });
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
    const lote = await r.json();
    out.push(...lote);
    if (lote.length < 1000) return out;
  }
}

(async () => {
  // El spec OpenAPI de PostgREST lista las tablas expuestas
  const spec = await (await fetch(URL + "/rest/v1/", { headers: H })).json();
  const tablas = Object.keys(spec.definitions || spec.components?.schemas || {}).sort();
  if (!tablas.length) throw new Error("No se pudo listar ninguna tabla");

  const dir = path.resolve(process.argv[2] || path.join(__dirname, "..", "backups"), "backup_" + stamp());
  fs.mkdirSync(dir, { recursive: true });

  const todo = {};
  let filas = 0, omitidas = 0;
  for (const t of tablas) {
    try {
      const datos = await fetchAll(t);
      todo[t] = datos;
      filas += datos.length;
      fs.writeFileSync(path.join(dir, t + ".json"), JSON.stringify(datos, null, 1));
      console.log(`  ${t.padEnd(22)}${String(datos.length).padStart(6)} filas`);
    } catch (e) {
      omitidas++;
      console.log(`  ${t.padEnd(22)}  -- omitida (${e.message.slice(0, 60)})`);
    }
  }
  fs.writeFileSync(path.join(dir, "_completo.json"), JSON.stringify(todo, null, 1));

  console.log(`\n✓ ${tablas.length - omitidas} tablas, ${filas} filas -> ${dir}`);
  if (!filas) { console.error("Backup vacío: algo anda mal."); process.exit(1); }
})().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
