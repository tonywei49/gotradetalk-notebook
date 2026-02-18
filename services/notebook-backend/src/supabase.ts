import { createClient } from '@supabase/supabase-js'

const supabaseUrl = String(process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
const supabaseAnonKey = String(process.env.SUPABASE_ANON_KEY || '').trim()

export const isSupabaseAuthConfigured = Boolean(supabaseUrl && supabaseServiceKey)

export const supabaseAdmin = isSupabaseAuthConfigured
  ? createClient(supabaseUrl, supabaseServiceKey)
  : null

export const supabaseAuth = isSupabaseAuthConfigured && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: false
      }
    })
  : null
