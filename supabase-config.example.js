// Copy to supabase-config.js. Never use a PAT, service_role or secret API key here.
// historyToken is a dedicated credential for call_monitor_history RPC only.
globalThis.SupabaseHistoryConfig={
 url:'https://YOUR_PROJECT.supabase.co',
 anonKey:'YOUR_PUBLIC_ANON_KEY',
 historyToken:'YOUR_RESTRICTED_HISTORY_TOKEN'
};
