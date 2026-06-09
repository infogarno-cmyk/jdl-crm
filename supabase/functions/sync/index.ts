import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const JDL_URL = Deno.env.get("JDL_SUPABASE_URL")!
const JDL_KEY = Deno.env.get("JDL_SUPABASE_SERVICE_KEY")!
const GARNO_URL = Deno.env.get("GARNO_SUPABASE_URL")!
const GARNO_KEY = Deno.env.get("GARNO_SUPABASE_SERVICE_KEY")!
const FB_ACCOUNT_1 = Deno.env.get("FB_ACCOUNT_PL")!
const FB_ACCOUNT_2 = Deno.env.get("FB_ACCOUNT_PLUA")!

const APP_ID = "1028249083492583"
const APP_SECRET = "b3dedc5d7311650be2a33d64332fe3c7"

const jdl = createClient(JDL_URL, JDL_KEY)
const garno = createClient(GARNO_URL, GARNO_KEY)

const PLUA_SRC = ["plua","ua.calculatorkuchni","fast-roda","roda-plkalc","uagarno","ua-"]

function isPluaSrc(s: string): boolean {
  const low = (s || "").toLowerCase()
  return PLUA_SRC.some(d => low.includes(d))
}

function parseDate(ds: string): Date | null {
  if (!ds) return null
  if (ds.includes("-")) return new Date(ds)
  const p = ds.split(".")
  if (p.length === 3) return new Date(p[2] + "-" + p[1] + "-" + p[0])
  return null
}

function getLeads(actions: any[]): number {
  if (!actions) return 0
  for (const a of actions) {
    if (a.action_type === "lead" || a.action_type === "onsite_conversion.lead_grouped")
      return parseInt(a.value) || 0
  }
  return 0
}

function campaignIsPlua(name: string): boolean {
  let n = ""
  for (let i = 0; i < name.length; i++) {
    if (name[i] !== "\\") n += name[i]
  }
  n = n.toUpperCase()
  const brIdx = n.indexOf("}")
  if (brIdx >= 0) {
    const after = n.substring(brIdx + 1, brIdx + 6)
    if (after.indexOf("PL") === 0) return false
    if (after.indexOf("UA") === 0 || after.indexOf("PLUA") === 0) return true
  }
  if (n.indexOf("}UA") >= 0 || n.indexOf("}PLUA") >= 0) return true
  if (n.indexOf("}PL") >= 0) return false
  return true
}

// ── GET VALID TOKEN (auto-refresh) ──
async function getValidToken(): Promise<string> {
  try {
    // 1. Try to get stored long-lived token from Supabase
    const { data } = await jdl
      .from("sync_log")
      .select("fb_token, fb_token_expires")
      .not("fb_token", "is", null)
      .order("synced_at", { ascending: false })
      .limit(1)
      .single()

    if (data?.fb_token && data?.fb_token_expires) {
      const expires = new Date(data.fb_token_expires)
      const daysLeft = (expires.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
      console.log(`Token expires in ${Math.round(daysLeft)} days`)
      
      // If more than 10 days left, use existing token
      if (daysLeft > 10) {
        console.log("Using stored token")
        return data.fb_token
      }
    }
  } catch(e) {
    console.log("No stored token, will generate new one")
  }

  // 2. Get short-lived token using app credentials
  console.log("Generating new long-lived token...")
  
  // First get app access token
  const appTokenRes = await fetch(
    `https://graph.facebook.com/oauth/access_token?client_id=${APP_ID}&client_secret=${APP_SECRET}&grant_type=client_credentials`
  )
  const appTokenData = await appTokenRes.json()
  
  if (appTokenData.error) {
    console.error("App token error:", JSON.stringify(appTokenData.error))
    // Fall back to env token
    return Deno.env.get("FB_ACCESS_TOKEN") || ""
  }

  const appToken = appTokenData.access_token
  console.log("Got app token, extending user token...")

  // Extend the user token stored in env
  const userToken = Deno.env.get("FB_ACCESS_TOKEN") || ""
  if (!userToken) {
    console.error("No FB_ACCESS_TOKEN in env")
    return ""
  }

  const extendRes = await fetch(
    `https://graph.facebook.com/oauth/access_token?grant_type=fb_exchange_token&client_id=${APP_ID}&client_secret=${APP_SECRET}&fb_exchange_token=${userToken}`
  )
  const extendData = await extendRes.json()

  if (extendData.error) {
    console.error("Token extend error:", JSON.stringify(extendData.error))
    return userToken // use original
  }

  const newToken = extendData.access_token
  const expiresIn = extendData.expires_in || 5184000 // 60 days default
  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString()

  console.log(`New token generated, expires at ${expiresAt}`)

  // Store new token in sync_log for reuse
  await jdl.from("sync_log").insert({
    synced_at: new Date().toISOString(),
    fb_token: newToken,
    fb_token_expires: expiresAt,
    days_synced: 0
  })

  return newToken
}

async function fbFetchAll(accId: string, since: string, until: string, token: string): Promise<any[]> {
  const fields = "campaign_name,spend,impressions,clicks,actions,date_start"
  const tr = encodeURIComponent('{"since":"' + since + '","until":"' + until + '"}')
  let url = `https://graph.facebook.com/v19.0/act_${accId}/insights?fields=${fields}&time_range=${tr}&level=campaign&time_increment=1&limit=500&access_token=${token}`
  
  const allData: any[] = []
  let page = 0
  
  while (url && page < 10) {
    page++
    const r = await fetch(url)
    const j = await r.json()
    if (j.error) { console.log(`FB error ${accId}:`, JSON.stringify(j.error)); break }
    for (const row of (j.data || [])) allData.push(row)
    url = j.paging?.next || ""
  }
  
  console.log(`FB ${accId}: ${allData.length} rows (${page} pages)`)
  return allData
}

serve(async () => {
  const today = new Date().toISOString().split("T")[0]
  const since = new Date(Date.now() - 90 * 864e5).toISOString().split("T")[0]

  try {
    console.log("=== JDL SYNC START ===", since, "->", today)

    // Get valid (auto-refreshed) token
    const FB_TOKEN = await getValidToken()
    if (!FB_TOKEN) {
      return new Response(JSON.stringify({ error: "No valid FB token" }), { status: 500 })
    }

    // GarnoCRM
    const gr = await garno.from("garnocrm").select("data").eq("id", 1).single()
    const leads: any[] = gr.data?.data?.leads || []
    const sales: any[] = gr.data?.data?.sales || []
    console.log(`GarnoCRM: ${leads.length} leads, ${sales.length} sales`)

    const ldMap: Record<string, { pl: number, plua: number, quals: number }> = {}
    const sdMap: Record<string, { amount: number, count: number }> = {}

    for (const l of leads) {
      const d = parseDate(l.dateOverride || l.createdAt)
      if (!d) continue
      const day = d.toISOString().split("T")[0]
      if (day < since) continue
      if (!ldMap[day]) ldMap[day] = { pl: 0, plua: 0, quals: 0 }
      if (isPluaSrc(l.source || "")) ldMap[day].plua++
      else ldMap[day].pl++
      if (parseInt(l.score) >= 4) ldMap[day].quals++
    }

    for (const s of sales) {
      const d = parseDate(s.createdAt)
      if (!d) continue
      const day = d.toISOString().split("T")[0]
      if (day < since) continue
      if (!sdMap[day]) sdMap[day] = { amount: 0, count: 0 }
      sdMap[day].amount += s.saleAmount || 0
      sdMap[day].count++
    }

    // Facebook
    const [fb1, fb2] = await Promise.all([
      fbFetchAll(FB_ACCOUNT_1, since, today, FB_TOKEN),
      fbFetchAll(FB_ACCOUNT_2, since, today, FB_TOKEN)
    ])

    const fbMap: Record<string, { spl: number, splua: number, imp: number, clk: number }> = {}

    for (const r of fb1) {
      const day = r.date_start
      if (!fbMap[day]) fbMap[day] = { spl: 0, splua: 0, imp: 0, clk: 0 }
      const sp = parseFloat(r.spend) || 0
      if (campaignIsPlua(r.campaign_name || "")) fbMap[day].splua += sp
      else fbMap[day].spl += sp
      fbMap[day].imp += parseInt(r.impressions) || 0
      fbMap[day].clk += parseInt(r.clicks) || 0
    }

    for (const r of fb2) {
      const day = r.date_start
      if (!fbMap[day]) fbMap[day] = { spl: 0, splua: 0, imp: 0, clk: 0 }
      fbMap[day].splua += parseFloat(r.spend) || 0
      fbMap[day].imp += parseInt(r.impressions) || 0
      fbMap[day].clk += parseInt(r.clicks) || 0
    }

    // Merge & upsert
    const allDays = [...new Set([...Object.keys(ldMap), ...Object.keys(sdMap), ...Object.keys(fbMap)])]
    const rows = []

    for (const day of allDays) {
      const l = ldMap[day] || { pl: 0, plua: 0, quals: 0 }
      const s = sdMap[day] || { amount: 0, count: 0 }
      const f = fbMap[day] || { spl: 0, splua: 0, imp: 0, clk: 0 }
      const spend = f.spl + f.splua
      const tl = l.pl + l.plua
      rows.push({
        day, spend_pl: f.spl, spend_plua: f.splua,
        leads_pl: l.pl, leads_plua: l.plua, quals: l.quals,
        sales_count: s.count, sales_amount_zl: s.amount,
        cpl: tl > 0 ? Math.round(spend / tl * 100) / 100 : 0,
        cql: l.quals > 0 ? Math.round(spend / l.quals * 100) / 100 : 0,
        ctr: f.imp > 0 ? Math.round(f.clk / f.imp * 10000) / 100 : 0,
        roi: spend > 0 ? Math.round((s.amount * 0.3 * 0.25 - spend) / spend * 10000) / 100 : 0,
        synced_at: new Date().toISOString()
      })
    }

    if (rows.length > 0) {
      const { error } = await jdl.from("metrics_daily").upsert(rows, { onConflict: "day" })
      if (error) console.log("Upsert error:", JSON.stringify(error))
      else console.log(`Upserted ${rows.length} rows OK`)
    }

    const tf = fbMap[today] || { spl: 0, splua: 0, imp: 0, clk: 0 }
    const tl2 = ldMap[today] || { pl: 0, plua: 0, quals: 0 }

    await jdl.from("sync_log").insert({
      synced_at: new Date().toISOString(),
      leads_today: tl2.pl + tl2.plua,
      quals_today: tl2.quals,
      spend_today: tf.spl + tf.splua,
      days_synced: rows.length
    })

    const result = {
      ok: true, days: rows.length,
      today: { spend_pl: tf.spl, spend_plua: tf.splua, leads: tl2.pl + tl2.plua, quals: tl2.quals },
      fb1_rows: fb1.length, fb2_rows: fb2.length
    }
    console.log("=== SYNC DONE ===", JSON.stringify(result))
    return new Response(JSON.stringify(result), { headers: { "Content-Type": "application/json" } })

  } catch (e: any) {
    console.log("SYNC ERROR:", e.message)
    return new Response(JSON.stringify({ error: e.message }), { status: 500 })
  }
})
