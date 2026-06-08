import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const JDL_URL = Deno.env.get("JDL_SUPABASE_URL")!
const JDL_KEY = Deno.env.get("JDL_SUPABASE_SERVICE_KEY")!
const GARNO_URL = Deno.env.get("GARNO_SUPABASE_URL")!
const GARNO_KEY = Deno.env.get("GARNO_SUPABASE_SERVICE_KEY")!
const FB_TOKEN = Deno.env.get("FB_ACCESS_TOKEN")!
const FB_ACCOUNT_1 = Deno.env.get("FB_ACCOUNT_PL")!
const FB_ACCOUNT_2 = Deno.env.get("FB_ACCOUNT_PLUA")!

const jdl = createClient(JDL_URL, JDL_KEY)
const garno = createClient(GARNO_URL, GARNO_KEY)

const PLUA_SRC = ["plua","ua.calculatorkuchni","fast-roda","roda-plkalc","uagarno","ua-"]

function isPluaSrc(s: string): boolean {
  const low = (s || "").toLowerCase()
  return PLUA_SRC.some(function(d) { return low.includes(d) })
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
  for (let i = 0; i < actions.length; i++) {
    const t = actions[i].action_type
    if (t === "lead" || t === "onsite_conversion.lead_grouped") {
      return parseInt(actions[i].value) || 0
    }
  }
  return 0
}

function campaignIsPlua(name: string): boolean {
  // Remove backslashes and normalize
  let n = ""
  for (let i = 0; i < name.length; i++) {
    if (name[i] !== "\\") n += name[i]
  }
  n = n.toUpperCase()
  // Look for }PL/ pattern -> PL campaign
  const brIdx = n.indexOf("}")
  if (brIdx >= 0) {
    const after = n.substring(brIdx + 1, brIdx + 6)
    if (after.indexOf("PL") === 0) return false
    if (after.indexOf("UA") === 0) return true
    if (after.indexOf("PLUA") === 0) return true
  }
  // Fallback
  if (n.indexOf("}UA") >= 0) return true
  if (n.indexOf("}PLUA") >= 0) return true
  if (n.indexOf("}PL") >= 0) return false
  return true
}

async function fbFetch(accId: string, since: string, until: string): Promise<any[]> {
  const fields = "campaign_name,spend,impressions,clicks,actions,date_start"
  const tr = encodeURIComponent('{"since":"' + since + '","until":"' + until + '"}')
  const url = "https://graph.facebook.com/v19.0/act_" + accId + "/insights?fields=" + fields + "&time_range=" + tr + "&level=campaign&time_increment=1&access_token=" + FB_TOKEN
  try {
    const r = await fetch(url)
    const j = await r.json()
    if (j.error) {
      console.log("FB error " + accId + ": " + JSON.stringify(j.error))
      return []
    }
    console.log("FB " + accId + ": " + (j.data || []).length + " rows")
    return j.data || []
  } catch (e) {
    console.log("FB fetch error: " + e)
    return []
  }
}

serve(async function() {
  const today = new Date().toISOString().split("T")[0]
  const since = new Date(Date.now() - 90 * 864e5).toISOString().split("T")[0]

  try {
    console.log("=== JDL SYNC START === " + since + " -> " + today)

    const gr = await garno.from("garnocrm").select("data").eq("id", 1).single()
    const leads: any[] = (gr.data && gr.data.data && gr.data.data.leads) ? gr.data.data.leads : []
    const sales: any[] = (gr.data && gr.data.data && gr.data.data.sales) ? gr.data.data.sales : []
    console.log("GarnoCRM: " + leads.length + " leads, " + sales.length + " sales")

    const ldMap: Record<string, { pl: number, plua: number, quals: number }> = {}
    const sdMap: Record<string, { amount: number, count: number }> = {}

    for (let i = 0; i < leads.length; i++) {
      const l = leads[i]
      const d = parseDate(l.dateOverride || l.createdAt)
      if (!d) continue
      const day = d.toISOString().split("T")[0]
      if (day < since) continue
      if (!ldMap[day]) ldMap[day] = { pl: 0, plua: 0, quals: 0 }
      if (isPluaSrc(l.source || "")) ldMap[day].plua++
      else ldMap[day].pl++
      if (parseInt(l.score) >= 4) ldMap[day].quals++
    }

    for (let i = 0; i < sales.length; i++) {
      const s = sales[i]
      const d = parseDate(s.createdAt)
      if (!d) continue
      const day = d.toISOString().split("T")[0]
      if (day < since) continue
      if (!sdMap[day]) sdMap[day] = { amount: 0, count: 0 }
      sdMap[day].amount += s.saleAmount || 0
      sdMap[day].count++
    }

    const fb1 = await fbFetch(FB_ACCOUNT_1, since, today)
    const fb2 = await fbFetch(FB_ACCOUNT_2, since, today)

    const fbMap: Record<string, { spl: number, splua: number, imp: number, clk: number }> = {}

    for (let i = 0; i < fb1.length; i++) {
      const r = fb1[i]
      const day = r.date_start
      if (!fbMap[day]) fbMap[day] = { spl: 0, splua: 0, imp: 0, clk: 0 }
      const sp = parseFloat(r.spend) || 0
      const isPlua = campaignIsPlua(r.campaign_name || "")
      console.log("CAM: " + (r.campaign_name || "").substring(0, 35) + " -> " + (isPlua ? "PLUA" : "PL") + " $" + sp)
      if (isPlua) fbMap[day].splua += sp
      else fbMap[day].spl += sp
      fbMap[day].imp += parseInt(r.impressions) || 0
      fbMap[day].clk += parseInt(r.clicks) || 0
    }

    for (let i = 0; i < fb2.length; i++) {
      const r = fb2[i]
      const day = r.date_start
      if (!fbMap[day]) fbMap[day] = { spl: 0, splua: 0, imp: 0, clk: 0 }
      fbMap[day].splua += parseFloat(r.spend) || 0
      fbMap[day].imp += parseInt(r.impressions) || 0
      fbMap[day].clk += parseInt(r.clicks) || 0
    }

    const allDays: string[] = []
    const seen: Record<string, boolean> = {}
    const keys1 = Object.keys(ldMap)
    const keys2 = Object.keys(sdMap)
    const keys3 = Object.keys(fbMap)
    for (let i = 0; i < keys1.length; i++) { if (!seen[keys1[i]]) { seen[keys1[i]] = true; allDays.push(keys1[i]) } }
    for (let i = 0; i < keys2.length; i++) { if (!seen[keys2[i]]) { seen[keys2[i]] = true; allDays.push(keys2[i]) } }
    for (let i = 0; i < keys3.length; i++) { if (!seen[keys3[i]]) { seen[keys3[i]] = true; allDays.push(keys3[i]) } }

    const rows = []
    for (let i = 0; i < allDays.length; i++) {
      const day = allDays[i]
      const l = ldMap[day] || { pl: 0, plua: 0, quals: 0 }
      const s = sdMap[day] || { amount: 0, count: 0 }
      const f = fbMap[day] || { spl: 0, splua: 0, imp: 0, clk: 0 }
      const spend = f.spl + f.splua
      const tl = l.pl + l.plua
      rows.push({
        day: day,
        spend_pl: f.spl,
        spend_plua: f.splua,
        leads_pl: l.pl,
        leads_plua: l.plua,
        quals: l.quals,
        sales_count: s.count,
        sales_amount_zl: s.amount,
        cpl: tl > 0 ? Math.round(spend / tl * 100) / 100 : 0,
        cql: l.quals > 0 ? Math.round(spend / l.quals * 100) / 100 : 0,
        ctr: f.imp > 0 ? Math.round(f.clk / f.imp * 10000) / 100 : 0,
        roi: spend > 0 ? Math.round((s.amount * 0.3 * 0.25 - spend) / spend * 10000) / 100 : 0,
        synced_at: new Date().toISOString()
      })
    }

    if (rows.length > 0) {
      const ur = await jdl.from("metrics_daily").upsert(rows, { onConflict: "day" })
      if (ur.error) console.log("Upsert error: " + JSON.stringify(ur.error))
      else console.log("Upserted " + rows.length + " rows OK")
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
      ok: true,
      days: rows.length,
      today: { spend_pl: tf.spl, spend_plua: tf.splua, leads: tl2.pl + tl2.plua, quals: tl2.quals },
      fb1_rows: fb1.length,
      fb2_rows: fb2.length
    }
    console.log("=== SYNC DONE === " + JSON.stringify(result))
    return new Response(JSON.stringify(result), { headers: { "Content-Type": "application/json" } })

  } catch (e: any) {
    console.log("SYNC ERROR: " + e.message)
    return new Response(JSON.stringify({ error: e.message }), { status: 500 })
  }
})
