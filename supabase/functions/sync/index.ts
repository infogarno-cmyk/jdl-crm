import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const JDL_URL = Deno.env.get("JDL_SUPABASE_URL")!
const JDL_KEY = Deno.env.get("JDL_SUPABASE_SERVICE_KEY")!
const GARNO_URL = Deno.env.get("GARNO_SUPABASE_URL")!
const GARNO_KEY = Deno.env.get("GARNO_SUPABASE_SERVICE_KEY")!
const FB_TOKEN = Deno.env.get("FB_ACCESS_TOKEN")!
const FB_ACCOUNT_PL = Deno.env.get("FB_ACCOUNT_PL")! // 365036380705019
const FB_ACCOUNT_PLUA = Deno.env.get("FB_ACCOUNT_PLUA")! // 277964906875809

const jdl = createClient(JDL_URL, JDL_KEY)
const garno = createClient(GARNO_URL, GARNO_KEY)

// PL domains from GarnoCRM source field
const PL_DOMAINS = ["garnofurniture.com","garno.com","kalkulator","pl.calc","plkalc","wizyta","pl-"]
const PLUA_DOMAINS = ["plua","ua.calculatorkuchni","fast-roda","roda-plkalc","uagarno"]

function isPlDomain(source: string): boolean {
  const s = (source || "").toLowerCase()
  return PL_DOMAINS.some(d => s.includes(d)) && !PLUA_DOMAINS.some(d => s.includes(d))
}
function isPluaDomain(source: string): boolean {
  const s = (source || "").toLowerCase()
  return PLUA_DOMAINS.some(d => s.includes(d))
}

function parseDate(dateStr: string): Date | null {
  if (!dateStr) return null
  // "08.06.2026" or "2026-06-08"
  if (dateStr.includes("-")) return new Date(dateStr)
  const parts = dateStr.split(".")
  if (parts.length === 3) {
    return new Date(`${parts[2]}-${parts[1]}-${parts[0]}`)
  }
  return null
}

async function fetchGarnoData() {
  const { data, error } = await garno
    .from("garnocrm")
    .select("data")
    .eq("id", 1)
    .single()

  if (error || !data) {
    console.error("Garno fetch error:", error)
    return { leads: [], sales: [] }
  }

  const leads: any[] = data.data?.leads || []
  const sales: any[] = data.data?.sales || []
  return { leads, sales }
}

async function fetchFBInsights(accountId: string, datePreset: string) {
  const fields = "campaign_name,spend,impressions,clicks,ctr,cpm,cpc,actions"
  const url = `https://graph.facebook.com/v19.0/act_${accountId}/insights?fields=${fields}&date_preset=${datePreset}&level=campaign&access_token=${FB_TOKEN}`
  try {
    const res = await fetch(url)
    const json = await res.json()
    return json.data || []
  } catch (e) {
    console.error("FB API error:", e)
    return []
  }
}

async function fetchFBInsightsByDateRange(accountId: string, since: string, until: string) {
  const fields = "campaign_name,spend,impressions,clicks,ctr,cpm,cpc,actions,date_start"
  const url = `https://graph.facebook.com/v19.0/act_${accountId}/insights?fields=${fields}&time_range={"since":"${since}","until":"${until}"}&level=campaign&time_increment=1&access_token=${FB_TOKEN}`
  try {
    const res = await fetch(url)
    const json = await res.json()
    return json.data || []
  } catch (e) {
    console.error("FB API error:", e)
    return []
  }
}

function getLeadCount(actions: any[]): number {
  if (!actions) return 0
  const leadAction = actions.find((a: any) => 
    a.action_type === "lead" || a.action_type === "onsite_conversion.lead_grouped"
  )
  return leadAction ? parseInt(leadAction.value) || 0 : 0
}

serve(async (req) => {
  const today = new Date().toISOString().split("T")[0]

  try {
    // ── 1. READ GARNO DATA ──
    console.log("Fetching GarnoCRM data...")
    const { leads, sales } = await fetchGarnoData()
    
    // ── 2. COMPUTE METRICS PER DAY (last 90 days) ──
    const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]
    
    // Group leads by date and geo
    const leadsByDay: Record<string, { pl: number, plua: number, quals: number, quals_pl: number, quals_plua: number }> = {}
    const salesByDay: Record<string, { amount_zl: number, count: number }> = {}

    for (const lead of leads) {
      const dateStr = lead.dateOverride || lead.createdAt
      const d = parseDate(dateStr)
      if (!d || d.toISOString().split("T")[0] < since) continue
      const day = d.toISOString().split("T")[0]
      if (!leadsByDay[day]) leadsByDay[day] = { pl: 0, plua: 0, quals: 0, quals_pl: 0, quals_plua: 0 }
      
      const src = lead.source || ""
      const isPL = isPlDomain(src)
      const isPLUA = isPluaDomain(src)
      
      if (isPL) leadsByDay[day].pl++
      else if (isPLUA) leadsByDay[day].plua++
      
      const score = parseInt(lead.score) || 0
      if (score >= 4) {
        leadsByDay[day].quals++
        if (isPL) leadsByDay[day].quals_pl++
        else if (isPLUA) leadsByDay[day].quals_plua++
      }
    }

    for (const sale of sales) {
      const dateStr = sale.createdAt
      const d = parseDate(dateStr)
      if (!d || d.toISOString().split("T")[0] < since) continue
      const day = d.toISOString().split("T")[0]
      if (!salesByDay[day]) salesByDay[day] = { amount_zl: 0, count: 0 }
      salesByDay[day].amount_zl += sale.saleAmount || 0
      salesByDay[day].count++
    }

    // ── 3. FETCH FB INSIGHTS (last 90 days by day) ──
    console.log("Fetching FB insights...")
    const [fbPL, fbPLUA] = await Promise.all([
      fetchFBInsightsByDateRange(FB_ACCOUNT_PL, since, today),
      fetchFBInsightsByDateRange(FB_ACCOUNT_PLUA, since, today),
    ])

    // Group FB by day
    const fbByDay: Record<string, { spend_pl: number, spend_plua: number, impressions_pl: number, impressions_plua: number, clicks_pl: number, clicks_plua: number, leads_pl: number, leads_plua: number }> = {}
    
    for (const row of fbPL) {
      const day = row.date_start
      if (!fbByDay[day]) fbByDay[day] = { spend_pl:0, spend_plua:0, impressions_pl:0, impressions_plua:0, clicks_pl:0, clicks_plua:0, leads_pl:0, leads_plua:0 }
      fbByDay[day].spend_pl += parseFloat(row.spend) || 0
      fbByDay[day].impressions_pl += parseInt(row.impressions) || 0
      fbByDay[day].clicks_pl += parseInt(row.clicks) || 0
      fbByDay[day].leads_pl += getLeadCount(row.actions)
    }
    for (const row of fbPLUA) {
      const day = row.date_start
      if (!fbByDay[day]) fbByDay[day] = { spend_pl:0, spend_plua:0, impressions_pl:0, impressions_plua:0, clicks_pl:0, clicks_plua:0, leads_pl:0, leads_plua:0 }
      fbByDay[day].spend_plua += parseFloat(row.spend) || 0
      fbByDay[day].impressions_plua += parseInt(row.impressions) || 0
      fbByDay[day].clicks_plua += parseInt(row.clicks) || 0
      fbByDay[day].leads_plua += getLeadCount(row.actions)
    }

    // ── 4. MERGE AND UPSERT INTO JDL metrics_daily ──
    console.log("Upserting daily metrics...")
    const allDays = new Set([
      ...Object.keys(leadsByDay),
      ...Object.keys(salesByDay),
      ...Object.keys(fbByDay)
    ])

    const rows = []
    for (const day of allDays) {
      const ld = leadsByDay[day] || { pl:0, plua:0, quals:0, quals_pl:0, quals_plua:0 }
      const sd = salesByDay[day] || { amount_zl:0, count:0 }
      const fb = fbByDay[day] || { spend_pl:0, spend_plua:0, impressions_pl:0, impressions_plua:0, clicks_pl:0, clicks_plua:0, leads_pl:0, leads_plua:0 }
      
      const total_spend = fb.spend_pl + fb.spend_plua
      const total_leads = ld.pl + ld.plua
      const total_clicks = fb.clicks_pl + fb.clicks_plua
      const total_impressions = fb.impressions_pl + fb.impressions_plua
      const cpl = total_leads > 0 ? total_spend / total_leads : 0
      const cql = ld.quals > 0 ? total_spend / ld.quals : 0
      const ctr = total_impressions > 0 ? (total_clicks / total_impressions) * 100 : 0
      const profit = sd.amount_zl * 0.3
      const roi = total_spend > 0 ? ((profit * 0.25) - total_spend) / total_spend * 100 : 0 // zł to $ ~0.25

      rows.push({
        day,
        spend_pl: fb.spend_pl,
        spend_plua: fb.spend_plua,
        leads_pl: ld.pl,
        leads_plua: ld.plua,
        quals: ld.quals,
        quals_pl: ld.quals_pl,
        quals_plua: ld.quals_plua,
        sales_count: sd.count,
        sales_amount_zl: sd.amount_zl,
        fb_leads_pl: fb.leads_pl,
        fb_leads_plua: fb.leads_plua,
        cpl: Math.round(cpl * 100) / 100,
        cql: Math.round(cql * 100) / 100,
        ctr: Math.round(ctr * 100) / 100,
        roi: Math.round(roi * 100) / 100,
        synced_at: new Date().toISOString()
      })
    }

    if (rows.length > 0) {
      const { error: upsertErr } = await jdl
        .from("metrics_daily")
        .upsert(rows, { onConflict: "day" })
      if (upsertErr) console.error("Upsert error:", upsertErr)
      else console.log(`Upserted ${rows.length} days`)
    }

    // ── 5. UPSERT TODAY'S SNAPSHOT ──
    const todayFB = fbByDay[today] || { spend_pl:0, spend_plua:0, impressions_pl:0, impressions_plua:0, clicks_pl:0, clicks_plua:0, leads_pl:0, leads_plua:0 }
    const todayLD = leadsByDay[today] || { pl:0, plua:0, quals:0, quals_pl:0, quals_plua:0 }
    const todaySD = salesByDay[today] || { amount_zl:0, count:0 }

    await jdl.from("sync_log").insert({
      synced_at: new Date().toISOString(),
      leads_today: todayLD.pl + todayLD.plua,
      quals_today: todayLD.quals,
      spend_today: todayFB.spend_pl + todayFB.spend_plua,
      sales_today: todaySD.count,
      days_synced: rows.length
    })

    return new Response(JSON.stringify({ 
      ok: true, 
      days: rows.length,
      today: { leads: todayLD.pl + todayLD.plua, quals: todayLD.quals, spend: todayFB.spend_pl + todayFB.spend_plua }
    }), { headers: { "Content-Type": "application/json" } })

  } catch (e: any) {
    console.error("Sync error:", e)
    return new Response(JSON.stringify({ error: e.message }), { status: 500 })
  }
})
