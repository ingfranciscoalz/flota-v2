-- ============================================================
-- FLOTA — MIGRACIÓN MULTI-TENANT
-- Ejecutar en: Supabase → SQL Editor
-- ⚠ BORRA todos los datos existentes
-- ============================================================

-- 1. Borrar tablas existentes
DROP TABLE IF EXISTS turnos CASCADE;
DROP TABLE IF EXISTS francos CASCADE;
DROP TABLE IF EXISTS gastos CASCADE;
DROP TABLE IF EXISTS mantenimiento CASCADE;
DROP TABLE IF EXISTS kms CASCADE;
DROP TABLE IF EXISTS config CASCADE;
DROP TABLE IF EXISTS choferes CASCADE;
DROP TABLE IF EXISTS autos CASCADE;
DROP TABLE IF EXISTS mantenimiento_items CASCADE;
DROP TABLE IF EXISTS user_mant_items CASCADE;
DROP TABLE IF EXISTS profiles CASCADE;

-- 2. Tabla de perfiles (uno por usuario de auth)
CREATE TABLE profiles (
  id         UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  nombre     TEXT,
  activo     BOOLEAN DEFAULT FALSE,
  is_admin   BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Autos (UUID generado por Supabase)
CREATE TABLE autos (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  nombre     TEXT NOT NULL,
  turno_base INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Choferes
CREATE TABLE choferes (
  id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  auto_id UUID REFERENCES autos(id) ON DELETE CASCADE NOT NULL,
  nombre  TEXT NOT NULL
);

-- 5. Config por usuario
CREATE TABLE config (
  id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  clave   TEXT NOT NULL,
  valor   TEXT NOT NULL,
  UNIQUE(user_id, clave)
);

-- 6. Turnos
CREATE TABLE turnos (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id   UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  chofer_id UUID REFERENCES choferes(id) ON DELETE CASCADE NOT NULL,
  fecha     DATE NOT NULL,
  monto     NUMERIC NOT NULL,
  UNIQUE(chofer_id, fecha)
);

-- 7. Francos
CREATE TABLE francos (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id   UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  chofer_id UUID REFERENCES choferes(id) ON DELETE CASCADE NOT NULL,
  fecha     DATE NOT NULL,
  motivo    TEXT DEFAULT 'franco_especial',
  UNIQUE(chofer_id, fecha)
);

-- 8. Gastos
CREATE TABLE gastos (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  auto_id     UUID REFERENCES autos(id) ON DELETE CASCADE NOT NULL,
  descripcion TEXT NOT NULL,
  monto       NUMERIC NOT NULL,
  categoria   TEXT NOT NULL,
  fecha       DATE NOT NULL
);

-- 9. Kms
CREATE TABLE kms (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  auto_id        UUID REFERENCES autos(id) ON DELETE CASCADE NOT NULL,
  kms_actuales   INTEGER NOT NULL DEFAULT 0,
  actualizado_en DATE,
  UNIQUE(user_id, auto_id)
);

-- 10. Mantenimiento realizado
CREATE TABLE mantenimiento (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  auto_id        UUID REFERENCES autos(id) ON DELETE CASCADE NOT NULL,
  tipo           TEXT NOT NULL,
  kms_en_service INTEGER,
  costo          NUMERIC,
  fecha          DATE NOT NULL
);

-- 11. Items de mantenimiento por usuario
CREATE TABLE user_mant_items (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  nombre         TEXT NOT NULL,
  frecuencia_kms INTEGER NOT NULL,
  auto_id        UUID REFERENCES autos(id) ON DELETE SET NULL
  -- NULL = aplica a todos los autos
);

-- ── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE profiles          ENABLE ROW LEVEL SECURITY;
ALTER TABLE autos             ENABLE ROW LEVEL SECURITY;
ALTER TABLE choferes          ENABLE ROW LEVEL SECURITY;
ALTER TABLE config            ENABLE ROW LEVEL SECURITY;
ALTER TABLE turnos            ENABLE ROW LEVEL SECURITY;
ALTER TABLE francos           ENABLE ROW LEVEL SECURITY;
ALTER TABLE gastos            ENABLE ROW LEVEL SECURITY;
ALTER TABLE kms               ENABLE ROW LEVEL SECURITY;
ALTER TABLE mantenimiento     ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_mant_items   ENABLE ROW LEVEL SECURITY;

-- Función para chequear si el usuario actual es admin (SECURITY DEFINER evita recursión RLS)
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT COALESCE((SELECT is_admin FROM profiles WHERE id = auth.uid()), FALSE);
$$;

-- Policies: profiles — propio + admin ve todos
CREATE POLICY "profiles_access" ON profiles FOR ALL TO authenticated
  USING  (auth.uid() = id OR is_admin())
  WITH CHECK (auth.uid() = id OR is_admin());

-- Policies: resto de tablas — solo datos propios
CREATE POLICY "own" ON autos         FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own" ON choferes      FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own" ON config        FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own" ON turnos        FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own" ON francos       FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own" ON gastos        FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own" ON kms           FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own" ON mantenimiento     FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own" ON user_mant_items  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ── TRIGGER: crear perfil automáticamente al registrarse ──────────────────────
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO profiles (id, nombre) VALUES (NEW.id, NEW.email);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ── PASO FINAL: activar tu propio usuario como admin ─────────────────────────
-- Después de registrarte, ejecutá esto reemplazando TU_EMAIL:
-- UPDATE profiles SET activo = TRUE, is_admin = TRUE WHERE nombre = 'TU_EMAIL';
