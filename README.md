# JDL CRM

Traffic team CRM with real-time sync via Supabase.

## Setup

### 1. Run SQL schema
Go to Supabase JDL → SQL Editor → paste contents of `supabase/schema.sql` → Run

### 2. Deploy Edge Function
```bash
npx supabase functions deploy sync --project-ref dkhkowkgiricjxkcngbf
```

### 3. Set Edge Function secrets
```bash
npx supabase secrets set \
  JDL_SUPABASE_URL=https://dkhkowkgiricjxkcngbf.supabase.co \
  JDL_SUPABASE_SERVICE_KEY=YOUR_SERVICE_KEY \
  GARNO_SUPABASE_URL=https://bnyjwjuejrfalbubdbcv.supabase.co \
  GARNO_SUPABASE_SERVICE_KEY=YOUR_GARNO_SERVICE_KEY \
  FB_ACCESS_TOKEN=YOUR_FB_TOKEN \
  FB_ACCOUNT_PL=365036380705019 \
  FB_ACCOUNT_PLUA=277964906875809
```

### 4. Schedule hourly cron
In Supabase Dashboard → Edge Functions → sync → Schedule: `0 * * * *`

### 5. Deploy to Vercel
Connect GitHub repo → Deploy (no env vars needed, keys are in the HTML)
