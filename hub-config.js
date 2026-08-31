/* ============================================================================
   Training Hub - site configuration
   ----------------------------------------------------------------------------
   Fill these two values in ONCE and everybody who opens the hub is connected.
   Without this file the hub falls back to sample data and asks each person to
   set it up on their own device, which is fine for a look around but no good
   for a squadron.

   WHERE THE VALUES COME FROM
     Supabase > your project > Project Settings > API Keys
       url            the Project URL,        e.g. https://abcdefgh.supabase.co
       publishableKey the PUBLISHABLE key,    starts with sb_publishable_

   IS IT SAFE TO PUT A KEY IN A FILE LIKE THIS?
     Yes - for the publishable key. That is exactly what it is for: it names
     your project, it does not grant access. Every Supabase web app ships it in
     the browser. What actually protects cadet data is the row-level security
     in hub-schema.sql, which is why running that file matters.

     NEVER put a secret key here. Secret keys ignore those rules entirely.
   ============================================================================ */
window.HUB_CONFIG = {
  url: https://wkpbuijctawdngcafiex.supabase.co'',
  publishableKey: 'sb_publishable_oyQZES6wQ1SArkhtUWfmrA_tm6EPbS-',
};
