import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

let supabaseClient: ReturnType<typeof createClient> | null = null
let supabaseAdminClient: ReturnType<typeof createClient> | null = null

export function getSupabase() {
    if (!supabaseUrl || !supabaseAnonKey) {
        throw new Error('Missing Supabase environment variables')
    }

    if (!supabaseClient) {
        supabaseClient = createClient(supabaseUrl, supabaseAnonKey)
    }

    return supabaseClient
}

// Client for server-side with elevated privileges (admin use)
export function getSupabaseAdmin() {
    if (!supabaseUrl || !supabaseAnonKey) {
        throw new Error('Missing Supabase environment variables')
    }

    if (!supabaseServiceRoleKey) {
        throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for privileged storage operations')
    }

    if (!supabaseAdminClient) {
        supabaseAdminClient = createClient(supabaseUrl, supabaseServiceRoleKey)
    }

    return supabaseAdminClient
}
