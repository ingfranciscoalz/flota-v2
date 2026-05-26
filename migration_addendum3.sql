-- ============================================================
-- FLOTA — ADDENDUM 3: Login de choferes + comprobantes
-- Ejecutar en: Supabase → SQL Editor
-- NO borra datos existentes
-- ============================================================

-- 1. Choferes: vinculación con cuenta propia ──────────────────
ALTER TABLE choferes
  ADD COLUMN IF NOT EXISTS chofer_user_id         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS link_token             TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS link_token_expires_at  TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_choferes_chofer_user_id ON choferes(chofer_user_id);
CREATE INDEX IF NOT EXISTS idx_choferes_link_token     ON choferes(link_token);

-- 2. Turnos: comprobante + quién marcó ───────────────────────
ALTER TABLE turnos
  ADD COLUMN IF NOT EXISTS comprobante_url TEXT,
  ADD COLUMN IF NOT EXISTS marcado_por     TEXT DEFAULT 'dueno'
    CHECK (marcado_por IN ('dueno', 'chofer'));

-- 3. Función: detectar si el usuario logueado es un chofer ───
CREATE OR REPLACE FUNCTION get_mi_chofer_data()
RETURNS TABLE(
  chofer_id   UUID,
  nombre      TEXT,
  auto_id     UUID,
  auto_nombre TEXT,
  turno_base  INTEGER,
  dueno_id    UUID,
  franco_weekday INTEGER
)
SECURITY DEFINER
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id        AS chofer_id,
    c.nombre    AS nombre,
    c.auto_id   AS auto_id,
    a.nombre    AS auto_nombre,
    COALESCE(a.turno_base, 50000) AS turno_base,
    c.user_id   AS dueno_id,
    CAST(COALESCE(
      (SELECT valor::INTEGER FROM config
       WHERE user_id = c.user_id AND clave = 'franco_weekday' LIMIT 1),
      1
    ) AS INTEGER) AS franco_weekday
  FROM choferes c
  JOIN autos a ON a.id = c.auto_id
  WHERE c.chofer_user_id = auth.uid()
  LIMIT 1;
END;
$$;

-- 4. Función: obtener los turnos del mes para el chofer ──────
-- estado se calcula desde monto vs turno_base (no existe columna estado en turnos)
CREATE OR REPLACE FUNCTION get_mis_turnos(p_year INTEGER, p_month INTEGER)
RETURNS TABLE(
  fecha           DATE,
  monto           INTEGER,
  estado          TEXT,
  comprobante_url TEXT,
  marcado_por     TEXT
)
SECURITY DEFINER
LANGUAGE plpgsql
AS $$
DECLARE
  v_chofer_id  UUID;
  v_dueno_id   UUID;
  v_turno_base INTEGER;
BEGIN
  SELECT c.id, c.user_id, COALESCE(a.turno_base, 50000)
    INTO v_chofer_id, v_dueno_id, v_turno_base
  FROM choferes c
  JOIN autos a ON a.id = c.auto_id
  WHERE c.chofer_user_id = auth.uid()
  LIMIT 1;

  IF v_chofer_id IS NULL THEN
    RAISE EXCEPTION 'No sos un chofer vinculado';
  END IF;

  RETURN QUERY
  SELECT
    t.fecha,
    t.monto,
    CASE
      WHEN t.monto >= v_turno_base THEN 'completo'
      WHEN t.monto  > 0            THEN 'parcial'
      ELSE 'debe'
    END AS estado,
    t.comprobante_url,
    t.marcado_por
  FROM turnos t
  WHERE t.chofer_id = v_chofer_id
    AND t.user_id   = v_dueno_id
    AND EXTRACT(YEAR  FROM t.fecha) = p_year
    AND EXTRACT(MONTH FROM t.fecha) = p_month
  ORDER BY t.fecha;
END;
$$;

-- 5. Función: chofer marca su propio turno con comprobante ───
-- Nota: turnos no tiene columna "estado" — se calcula client-side
CREATE OR REPLACE FUNCTION chofer_marcar_turno(
  p_fecha           DATE,
  p_monto           INTEGER,
  p_comprobante_url TEXT
)
RETURNS JSON
SECURITY DEFINER
LANGUAGE plpgsql
AS $$
DECLARE
  v_chofer choferes%ROWTYPE;
BEGIN
  SELECT * INTO v_chofer FROM choferes WHERE chofer_user_id = auth.uid() LIMIT 1;
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Usuario no vinculado como chofer');
  END IF;

  INSERT INTO turnos (user_id, chofer_id, fecha, monto, comprobante_url, marcado_por)
  VALUES (v_chofer.user_id, v_chofer.id, p_fecha, p_monto, p_comprobante_url, 'chofer')
  ON CONFLICT (chofer_id, fecha)
  DO UPDATE SET
    monto           = p_monto,
    comprobante_url = p_comprobante_url,
    marcado_por     = 'chofer';

  RETURN json_build_object('ok', true);
END;
$$;

-- 6. Función: vincular chofer con su cuenta de auth ──────────
CREATE OR REPLACE FUNCTION vincular_chofer(p_token TEXT, p_chofer_id UUID)
RETURNS JSON
SECURITY DEFINER
LANGUAGE plpgsql
AS $$
DECLARE
  v_chofer choferes%ROWTYPE;
BEGIN
  -- Buscar el chofer con ese token válido
  SELECT * INTO v_chofer
  FROM choferes
  WHERE id = p_chofer_id
    AND link_token = p_token
    AND (link_token_expires_at IS NULL OR link_token_expires_at > NOW())
    AND chofer_user_id IS NULL;  -- no vinculado aún

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Token inválido, expirado o chofer ya vinculado');
  END IF;

  -- Vincular el usuario actual al chofer
  UPDATE choferes
  SET chofer_user_id         = auth.uid(),
      link_token             = NULL,
      link_token_expires_at  = NULL
  WHERE id = p_chofer_id;

  -- Crear un profile para el chofer si no tiene uno
  INSERT INTO profiles (id, nombre, activo, is_admin)
  VALUES (auth.uid(), v_chofer.nombre, TRUE, FALSE)
  ON CONFLICT (id) DO NOTHING;

  RETURN json_build_object(
    'ok',     true,
    'nombre', v_chofer.nombre,
    'auto_id', v_chofer.auto_id
  );
END;
$$;

-- 7. Función: obtener francos del chofer en un mes ───────────
CREATE OR REPLACE FUNCTION get_mis_francos(p_year INTEGER, p_month INTEGER)
RETURNS TABLE(fecha DATE, motivo TEXT)
SECURITY DEFINER
LANGUAGE plpgsql
AS $$
DECLARE
  v_chofer_id UUID;
  v_dueno_id  UUID;
BEGIN
  SELECT c.id, c.user_id INTO v_chofer_id, v_dueno_id
  FROM choferes c WHERE c.chofer_user_id = auth.uid() LIMIT 1;

  IF v_chofer_id IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT f.fecha, f.motivo
  FROM francos f
  WHERE f.chofer_id = v_chofer_id
    AND f.user_id   = v_dueno_id
    AND EXTRACT(YEAR  FROM f.fecha) = p_year
    AND EXTRACT(MONTH FROM f.fecha) = p_month;
END;
$$;

-- ============================================================
-- STORAGE (instrucciones — ejecutar por separado si falla)
-- ============================================================
-- Opción A: desde Supabase Dashboard > Storage > New bucket
--   Nombre: comprobantes
--   Public: YES (los URLs son opacos/UUID — no adivinables)
--
-- Opción B: SQL (requiere extensión pg_storage habilitada):
-- SELECT storage.create_bucket('comprobantes', '{"public": true}'::jsonb);
--
-- Policy de upload (solo choferes vinculados pueden subir):
-- Nombre del bucket: comprobantes
-- Allowed operations: INSERT, SELECT
-- Policy (INSERT): auth.role() = 'authenticated'
-- Policy (SELECT): true  (público — URLs son opacos)
-- ============================================================
