import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Missing Supabase environment variables')
}

// Client for general use (client-side safe)
export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Client for server-side with elevated privileges (admin use)
export const supabaseAdmin = createClient(
    supabaseUrl,
    supabaseServiceRoleKey || supabaseAnonKey // Fallback to anon if service role is missing
)
