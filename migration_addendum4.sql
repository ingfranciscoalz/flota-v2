-- ============================================================
-- FLOTA — ADDENDUM 4: baja lógica de choferes
-- Ejecutar en: Supabase → SQL Editor
-- NO borra datos. Se puede correr más de una vez sin problema.
--
-- Contexto: turnos.chofer_id y francos.chofer_id tenían
-- ON DELETE CASCADE, así que borrar un chofer se llevaba en
-- silencio todo su historial y las estadísticas del auto.
-- ============================================================


-- ── PASO 0 (opcional) — ver cómo están las FK AHORA ──────────
-- Deberías ver delete_rule = CASCADE en las dos filas.
SELECT tc.table_name, tc.constraint_name, rc.delete_rule
FROM information_schema.table_constraints tc
JOIN information_schema.referential_constraints rc
  ON rc.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_name IN ('turnos', 'francos');


-- ── PASO 1 — marca de baja, en lugar de DELETE ───────────────
ALTER TABLE choferes
  ADD COLUMN IF NOT EXISTS activo         BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS desactivado_en TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_choferes_activo ON choferes(user_id, activo);


-- ── PASO 2 — red de seguridad a nivel base ───────────────────
-- Si alguien hace un DELETE sobre choferes (dashboard, script,
-- lo que sea), ahora FALLA en vez de arrastrarse el historial.
--
-- No asumimos el nombre de la constraint: buscamos cualquier FK
-- sobre chofer_id y la reemplazamos.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT con.conname, con.conrelid::regclass::text AS tabla
    FROM pg_constraint con
    JOIN pg_attribute att
      ON att.attrelid = con.conrelid
     AND att.attnum   = ANY (con.conkey)
    WHERE con.contype = 'f'
      AND con.conrelid IN ('public.turnos'::regclass, 'public.francos'::regclass)
      AND att.attname  = 'chofer_id'
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tabla, r.conname);
    RAISE NOTICE 'FK vieja eliminada: %.%', r.tabla, r.conname;
  END LOOP;
END $$;

ALTER TABLE turnos  ADD CONSTRAINT turnos_chofer_id_fkey
  FOREIGN KEY (chofer_id) REFERENCES choferes(id) ON DELETE RESTRICT;

ALTER TABLE francos ADD CONSTRAINT francos_chofer_id_fkey
  FOREIGN KEY (chofer_id) REFERENCES choferes(id) ON DELETE RESTRICT;

-- Nota: deleteAuto() en src/data.js borra turnos y francos ANTES
-- que los choferes, así que eliminar un auto entero sigue andando.


-- ── PASO 3 — verificar ───────────────────────────────────────
-- (a) las FK ahora deben decir RESTRICT
SELECT tc.table_name, tc.constraint_name, rc.delete_rule
FROM information_schema.table_constraints tc
JOIN information_schema.referential_constraints rc
  ON rc.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_name IN ('turnos', 'francos');

-- (b) todos los choferes deben quedar activo = true,
--     y Cesar con sus 209 turnos
SELECT c.nombre, c.activo, c.desactivado_en, count(t.id) AS turnos
FROM choferes c
LEFT JOIN turnos t ON t.chofer_id = c.id
GROUP BY c.id, c.nombre, c.activo, c.desactivado_en
ORDER BY c.nombre;
