import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  'https://ohvrrfhoqxguxkffmumk.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9odnJyZmhvcXhndXhrZmZtdW1rIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3MDEyOTgsImV4cCI6MjA5NDI3NzI5OH0.jrR2_o-7jI2_PP3zuCSIwIa4C3teTC1V2C5yEbUw7Ms'
)
