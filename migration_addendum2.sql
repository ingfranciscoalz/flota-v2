-- ============================================================
-- FLOTA — ADDENDUM 2 (ejecutar en Supabase → SQL Editor)
-- NO borra datos existentes
-- ============================================================

-- VTV y vencimiento de seguro por auto
ALTER TABLE autos ADD COLUMN IF NOT EXISTS vtv_vence    DATE;
ALTER TABLE autos ADD COLUMN IF NOT EXISTS seguro_vence DATE;
