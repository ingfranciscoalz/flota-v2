-- ============================================================
-- FLOTA — ADDENDUM (ejecutar en Supabase → SQL Editor)
-- NO borra datos existentes
-- ============================================================

-- 1. turno_base en autos
ALTER TABLE autos ADD COLUMN IF NOT EXISTS turno_base INTEGER;

-- 2. Tabla user_mant_items
CREATE TABLE IF NOT EXISTS user_mant_items (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  nombre         TEXT NOT NULL,
  frecuencia_kms INTEGER NOT NULL,
  auto_id        UUID REFERENCES autos(id) ON DELETE SET NULL
  -- NULL = aplica a todos los autos del usuario
);

-- 3. RLS
ALTER TABLE user_mant_items ENABLE ROW LEVEL SECURITY;

-- 4. Policy
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'user_mant_items' AND policyname = 'own'
  ) THEN
    CREATE POLICY "own" ON user_mant_items
      FOR ALL TO authenticated
      USING  (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- 5. Si ya creaste user_mant_items antes, agregar la columna auto_id
ALTER TABLE user_mant_items ADD COLUMN IF NOT EXISTS auto_id UUID REFERENCES autos(id) ON DELETE SET NULL;

-- 6. Índices de rendimiento
CREATE INDEX IF NOT EXISTS idx_turnos_fecha         ON turnos(fecha);
CREATE INDEX IF NOT EXISTS idx_turnos_chofer_fecha  ON turnos(chofer_id, fecha);
CREATE INDEX IF NOT EXISTS idx_francos_chofer_fecha ON francos(chofer_id, fecha);
CREATE INDEX IF NOT EXISTS idx_gastos_fecha         ON gastos(fecha);
CREATE INDEX IF NOT EXISTS idx_gastos_auto          ON gastos(auto_id);
