-- ============================================================
-- FIX: get_mis_turnos — "structure of query does not match function result type"
-- Causa: turnos.monto es NUMERIC pero la función declaraba INTEGER
-- Ejecutar en: Supabase → SQL Editor
-- ============================================================

CREATE OR REPLACE FUNCTION get_mis_turnos(p_year INTEGER, p_month INTEGER)
RETURNS TABLE(
  fecha           DATE,
  monto           NUMERIC,
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
  v_turno_base NUMERIC;
BEGIN
  SELECT c.id, c.user_id, COALESCE(a.turno_base::NUMERIC, 50000)
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
    t.monto::NUMERIC,
    CASE
      WHEN t.monto::NUMERIC >= v_turno_base THEN 'completo'::TEXT
      WHEN t.monto::NUMERIC  > 0            THEN 'parcial'::TEXT
      ELSE 'debe'::TEXT
    END AS estado,
    t.comprobante_url::TEXT,
    COALESCE(t.marcado_por, 'dueno')::TEXT
  FROM turnos t
  WHERE t.chofer_id = v_chofer_id
    AND t.user_id   = v_dueno_id
    AND EXTRACT(YEAR  FROM t.fecha) = p_year
    AND EXTRACT(MONTH FROM t.fecha) = p_month
  ORDER BY t.fecha;
END;
$$;
