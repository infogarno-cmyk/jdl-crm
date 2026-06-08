#!/bin/bash
# Run this script locally to deploy the Edge Function

# Install Supabase CLI if not installed
# npm install -g supabase

JDL_PROJECT="dkhkowkgiricjxkcngbf"
GARNO_URL="https://bnyjwjuejrfalbubdbcv.supabase.co"
GARNO_SERVICE="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJueWp3anVlanJmYWxidWJkYmN2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTcyNDQ2NSwiZXhwIjoyMDk1MzAwNDY1fQ.l9ka9b_PzKdu-gock8ZACqODicJDZYCc1laMw_HMBvA"
JDL_URL="https://dkhkowkgiricjxkcngbf.supabase.co"
JDL_SERVICE="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRraGtvd2tnaXJpY2p4a2NuZ2JmIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDkxNjc0MSwiZXhwIjoyMDk2NDkyNzQxfQ.keV6W8dGhuFj-8aVtVcqHrbLQTfzUmffekencivsWq4"
FB_TOKEN="EAAOnLZBVcuOcBRqiiSfByZCFHNbI7p0uQS607Vd6OJkhfgLRlzZCCFbZAQ4H76GpcoPDALpBrXWAyGIztiXSI8jQl43216pBPvA4QcZBv3KLlJPYNIe8fZBZCwUYTaT65JJg4UhSWeZByO6HNxDXT7Bwq1cAyyRRThEOe4xyjVeSkQLvcExG2DX3OvhAjDRII9P4QisrBTjsrfb2uOY4ajgaHV9ZAe9kIcDmwbvfIGV8U6bByeCjmCVU9iQ3FLBZCe9jbEnhYWeCHGXLITTaUOap5ZAPQ79"

echo "Linking project..."
supabase link --project-ref $JDL_PROJECT

echo "Setting secrets..."
supabase secrets set \
  JDL_SUPABASE_URL=$JDL_URL \
  JDL_SUPABASE_SERVICE_KEY=$JDL_SERVICE \
  GARNO_SUPABASE_URL=$GARNO_URL \
  GARNO_SUPABASE_SERVICE_KEY=$GARNO_SERVICE \
  FB_ACCESS_TOKEN=$FB_TOKEN \
  FB_ACCOUNT_PL=365036380705019 \
  FB_ACCOUNT_PLUA=277964906875809 \
  --project-ref $JDL_PROJECT

echo "Deploying Edge Function..."
supabase functions deploy sync --project-ref $JDL_PROJECT --no-verify-jwt

echo "Done! Now set up cron in Supabase Dashboard:"
echo "Edge Functions -> sync -> Schedule: 0 * * * *"
