-- =============================================================
-- BACKUP MENSUAL AUTOMÁTICO — ejecutar UNA VEZ en el SQL Editor
-- Antes de correr este script:
--   Dashboard → Database → Extensions → habilitar "pg_cron"
-- =============================================================

-- 1. Tabla de copias de seguridad
--    Solo service_role puede leer/escribir (sin políticas RLS = acceso bloqueado para anon/authenticated)
CREATE TABLE IF NOT EXISTS public.backups (
  id            bigserial   PRIMARY KEY,
  created_at    timestamptz NOT NULL DEFAULT now(),
  label         text        NOT NULL,
  tables_count  int,
  data          jsonb       NOT NULL
);
ALTER TABLE public.backups ENABLE ROW LEVEL SECURITY;

-- 2. Función que exporta todas las tablas del schema público
CREATE OR REPLACE FUNCTION public.create_monthly_backup()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  backup_data  jsonb := '{}'::jsonb;
  tbl          text;
  tbl_data     jsonb;
  tbl_count    int  := 0;
  lbl          text := 'monthly-' || to_char(
                          now() AT TIME ZONE 'America/Argentina/Buenos_Aires',
                          'YYYY-MM'
                        );
BEGIN
  FOR tbl IN
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type   = 'BASE TABLE'
      AND table_name   NOT LIKE 'backup%'   -- excluye la tabla de backups
    ORDER BY table_name
  LOOP
    EXECUTE format(
      'SELECT coalesce(jsonb_agg(row_to_json(t)), ''[]''::jsonb) FROM (SELECT * FROM public.%I) t',
      tbl
    ) INTO tbl_data;

    backup_data := backup_data || jsonb_build_object(tbl, tbl_data);
    tbl_count   := tbl_count + 1;
  END LOOP;

  -- Eliminar backups con más de 6 meses para no acumular demasiado
  DELETE FROM public.backups
  WHERE created_at < now() - interval '6 months';

  INSERT INTO public.backups (label, tables_count, data)
  VALUES (lbl, tbl_count, backup_data);

  RETURN lbl || ' (' || tbl_count || ' tablas guardadas)';
END;
$$;

-- 3. Cron: todos los 1º de mes a las 03:00 UTC (00:00 hora Argentina)
SELECT cron.schedule(
  'monthly-backup',
  '0 3 1 * *',
  $$SELECT public.create_monthly_backup()$$
);

-- 4. Crear el primer backup ahora mismo para verificar que funciona
SELECT public.create_monthly_backup();

-- Verificar que se creó:
SELECT id, created_at, label, tables_count
FROM public.backups
ORDER BY created_at DESC;
