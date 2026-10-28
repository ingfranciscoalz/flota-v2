-- ============================================================
-- FLOTA — ADDENDUM 5: zona del auto en cada gasto
-- Ejecutar en: Supabase → SQL Editor
-- NO borra datos. Se puede correr más de una vez.
--
-- Para poder reclamar garantía hace falta saber QUÉ parte del auto
-- se intervino, no solo cuánto se gastó. Un gasto puede tocar varias
-- zonas a la vez ("pastillas + bujías + ruleman"), por eso `zonas`
-- es un arreglo: si falla cualquiera de ellas, el gasto aparece
-- como antecedente.
-- ============================================================

ALTER TABLE gastos
  ADD COLUMN IF NOT EXISTS zonas    TEXT[],
  ADD COLUMN IF NOT EXISTS eje      TEXT,
  ADD COLUMN IF NOT EXISTS lado     TEXT,
  ADD COLUMN IF NOT EXISTS repuesto TEXT,
  ADD COLUMN IF NOT EXISTS taller   TEXT;

-- eje = del | tras   (nulo si no aplica)
-- lado = izq | der   (nulo si no aplica o si fue en ambos)
ALTER TABLE gastos DROP CONSTRAINT IF EXISTS gastos_eje_check;
ALTER TABLE gastos ADD  CONSTRAINT gastos_eje_check  CHECK (eje  IS NULL OR eje  IN ('del', 'tras'));
ALTER TABLE gastos DROP CONSTRAINT IF EXISTS gastos_lado_check;
ALTER TABLE gastos ADD  CONSTRAINT gastos_lado_check CHECK (lado IS NULL OR lado IN ('izq', 'der'));

-- GIN: las consultas son "¿qué gastos tocaron la zona X?" (zonas @> '{frenos}')
CREATE INDEX IF NOT EXISTS idx_gastos_zonas ON gastos USING GIN (zonas);

-- Verificar
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'gastos' AND column_name IN ('zonas','eje','lado','repuesto','taller')
ORDER BY column_name;
