-- ============================================================
-- FLOTA — ADDENDUM (ejecutar en Supabase → SQL Editor)
-- Solo agregar lo nuevo: turno_base en autos + user_mant_items
-- NO borra datos existentes
-- ============================================================

-- 1. Agregar columna turno_base a autos (si no existe)
ALTER TABLE autos ADD COLUMN IF NOT EXISTS turno_base INTEGER;

-- 2. Crear tabla de items de mantenimiento por usuario
CREATE TABLE IF NOT EXISTS user_mant_items (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  nombre         TEXT NOT NULL,
  frecuencia_kms INTEGER NOT NULL
);

-- 3. Habilitar RLS
ALTER TABLE user_mant_items ENABLE ROW LEVEL SECURITY;

-- 4. Policy: cada usuario solo ve sus propios items
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
