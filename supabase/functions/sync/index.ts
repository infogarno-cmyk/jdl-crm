import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const JDL_URL = Deno.env.get("JDL_SUPABASE_URL")!
const JDL_KEY = Deno.env.get("JDL_SUPABASE_SERVICE_KEY")!
const GARNO_URL = Deno.env.get("GARNO_SUPABASE_URL")!
const GARNO_KEY = Deno.env.get("GARNO_SUPABASE_SERVICE_KEY")!
const FB_TOKEN = Deno.env.get("FB_ACCESS_TOKEN")!
// 365036380705019 = личный кабинет (PL кампании)
// 277964906875809 = Roda Amsterdam (PLUA кампании)
const FB_ACCOUNT_1 = Deno.env.get("FB_ACCOUNT_PL")!   // 365036380705019
const FB_ACCOUNT_2 = Deno.env.get("FB_ACCOUNT_PLUA")! // 277964906875809

const jdl = createClient(JDL_URL, JDL_KEY)
const garno = createClient(GARNO_URL, GARNO_KEY)

const PL_DOMAINS = ["garnofurniture.com","kalkulator","wizyta","garno.com","pl-kalc","plkalk","garno.pl"]
const PLUA_DOMAINS = ["plua","ua.calculatorkuchni","fast-roda","roda-plkalc","uagarno","ua-"]

function isPlDomain(s: string): boolean {
  const src = (s||"").toLowerCase()
  return PL_DOMAINS.some(d=>src.includes(d)) && !PLUA_DOMAINS.some(d=>src.includes(d))
}
function isPluaDomain(s: string): boolean {
  return PLUA_DOMAINS.some(d=>(s||"").toLowerCase().includes(d))
}
function parseDate(ds: string): Date|null {
  if(!ds) return null
  if(ds.includes("-")) return new Date(ds)
  const p=ds.split(".")
  if(p.length===3) return new Date(`${p[2]}-${p[1]}-${p[0]}`)
  return null
}

// Fetch campaign-level insights with impressions, clicks, spend, leads
async function fbFetch(accId: string, since: string, until: string) {
  const fields = "campaign_name,spend,impressions,clicks,actions,date_start"
  const timeRange = encodeURIComponent(JSON.stringify({"since":since,"until":until}))
  const url = `https://graph.facebook.com/v19.0/act_${accId}/insights?fields=${fields}&time_range=${timeRange}&level=campaign&time_increment=1&access_token=${FB_TOKEN}`
  try {
    const r = await fetch(url)
    const j = await r.json()
    if (j.error) {
      console.error("FB error for account", accId, ":", JSON.stringify(j.error))
      return []
    }
    console.log(`FB account ${accId}: got ${(j.data||[]).length} rows`)
    return j.data || []
  } catch(e) {
    console.error("FB fetch error:", e)
    return []
  }
}

function getLeads(actions: any[]): number {
  if(!actions) return 0
  const a = actions.find((x:any) =>
    x.action_type === "lead" ||
    x.action_type === "onsite_conversion.lead_grouped" ||
    x.action_type === "onsite_conversion.messaging_conversation_started_7d"
  )
  return a ? parseInt(a.value)||0 : 0
}

// Determine if campaign belongs to PL or PLUA based on name
function campaignGeo(name: string): "pl"|"plua"|"other" {
  const n = (name||"").toUpperCase()
  if (n.includes("PLUA") || n.includes("UA/PL") || n.includes("PL/UA")) return "plua"
  if (n.includes("/PL/") || n.includes("/PL ") || n.match(/[^A-Z]PL[^A-Z]/)) return "pl"
  if (n.startsWith("PL") || n.includes(" PL ") || n.includes("/PL")) return "pl"
  if (n.includes("UA") || n.includes("RODA") || n.includes("FAST")) return "plua"
  return "pl" // default to PL for account 1
}

serve(async()=>{
  const today = new Date().toISOString().split("T")[0]
  const since = new Date(Date.now()-90*864e5).toISOString().split("T")[0]

  try {
    console.log("=== JDL SYNC START ===")
    console.log("Period:", since, "->", today)

    // 1. GarnoCRM leads & sales
    console.log("Fetching GarnoCRM...")
    const {data:gd, error:ge} = await garno.from("garnocrm").select("data").eq("id",1).single()
    if(ge) console.error("GarnoCRM error:", ge)
    const leads:any[] = gd?.data?.leads || []
    const sales:any[] = gd?.data?.sales || []
    console.log(`GarnoCRM: ${leads.length} leads, ${sales.length} sales`)

    // Group by day
    const ldMap:Record<string,{pl:number,plua:number,quals:number}> = {}
    const sdMap:Record<string,{amount:number,count:number}> = {}

    for(const l of leads){
      const d = parseDate(l.dateOverride||l.createdAt)
      if(!d) continue
      const day = d.toISOString().split("T")[0]
      if(day<since) continue
      if(!ldMap[day]) ldMap[day]={pl:0,plua:0,quals:0}
      const src = l.source||""
      if(isPluaDomain(src)) ldMap[day].plua++
      else ldMap[day].pl++ // default to PL (garnofurniture.com, garno.ukr etc)
      if(parseInt(l.score)>=4) ldMap[day].quals++
    }
    for(const s of sales){
      const d = parseDate(s.createdAt)
      if(!d) continue
      const day = d.toISOString().split("T")[0]
      if(day<since) continue
      if(!sdMap[day]) sdMap[day]={amount:0,count:0}
      sdMap[day].amount += s.saleAmount||0
      sdMap[day].count++
    }

    // 2. Facebook - both accounts
    console.log("Fetching FB account 1 (PL):", FB_ACCOUNT_1)
    console.log("Fetching FB account 2 (PLUA):", FB_ACCOUNT_2)
    const [fb1, fb2] = await Promise.all([
      fbFetch(FB_ACCOUNT_1, since, today),
      fbFetch(FB_ACCOUNT_2, since, today),
    ])

    const fbMap:Record<string,{spl:number,splua:number,imp:number,clk:number,leads_pl:number,leads_plua:number}> = {}

    // Account 1 - detect PL vs PLUA by campaign name
    for(const r of fb1){
      const day = r.date_start
      if(!fbMap[day]) fbMap[day]={spl:0,splua:0,imp:0,clk:0,leads_pl:0,leads_plua:0}
      const geo = campaignGeo(r.campaign_name||"")
      const sp = parseFloat(r.spend)||0
      const imp = parseInt(r.impressions)||0
      const clk = parseInt(r.clicks)||0
      const lds = getLeads(r.actions)
      if(geo==="plua"){
        fbMap[day].splua += sp
        fbMap[day].leads_plua += lds
      } else {
        fbMap[day].spl += sp
        fbMap[day].leads_pl += lds
      }
      fbMap[day].imp += imp
      fbMap[day].clk += clk
    }

    // Account 2 (Roda Amsterdam) - all PLUA
    for(const r of fb2){
      const day = r.date_start
      if(!fbMap[day]) fbMap[day]={spl:0,splua:0,imp:0,clk:0,leads_pl:0,leads_plua:0}
      fbMap[day].splua += parseFloat(r.spend)||0
      fbMap[day].imp += parseInt(r.impressions)||0
      fbMap[day].clk += parseInt(r.clicks)||0
      fbMap[day].leads_plua += getLeads(r.actions)
    }

    // 3. Merge & upsert
    const allDays = new Set([...Object.keys(ldMap),...Object.keys(sdMap),...Object.keys(fbMap)])
    console.log(`Merging ${allDays.size} days...`)

    const rows = []
    for(const day of allDays){
      const l = ldMap[day]||{pl:0,plua:0,quals:0}
      const s = sdMap[day]||{amount:0,count:0}
      const f = fbMap[day]||{spl:0,splua:0,imp:0,clk:0,leads_pl:0,leads_plua:0}
      const spend = f.spl + f.splua
      const tl = l.pl + l.plua
      const ctr = f.imp > 0 ? Math.round(f.clk/f.imp*10000)/100 : 0
      const cpl = tl > 0 ? Math.round(spend/tl*100)/100 : 0
      const cql = l.quals > 0 ? Math.round(spend/l.quals*100)/100 : 0
      // ROI: sales profit in $ (zł * 0.3 margin * 0.25 usd rate) vs spend
      const profit_usd = s.amount * 0.3 * 0.25
      const roi = spend > 0 ? Math.round((profit_usd-spend)/spend*10000)/100 : 0

      rows.push({
        day, spend_pl:f.spl, spend_plua:f.splua,
        leads_pl:l.pl, leads_plua:l.plua, quals:l.quals,
        fb_leads_pl:f.leads_pl, fb_leads_plua:f.leads_plua,
        sales_count:s.count, sales_amount_zl:s.amount,
        cpl, cql, ctr, roi,
        synced_at:new Date().toISOString()
      })
    }

    if(rows.length>0){
      const {error:ue} = await jdl.from("metrics_daily").upsert(rows,{onConflict:"day"})
      if(ue) console.error("Upsert error:", ue)
      else console.log(`Upserted ${rows.length} rows OK`)
    }

    // Log today's snapshot
    const tf = fbMap[today]||{spl:0,splua:0,imp:0,clk:0,leads_pl:0,leads_plua:0}
    const tl = ldMap[today]||{pl:0,plua:0,quals:0}
    const ts = sdMap[today]||{amount:0,count:0}
    await jdl.from("sync_log").insert({
      synced_at:new Date().toISOString(),
      leads_today:tl.pl+tl.plua,
      quals_today:tl.quals,
      spend_today:tf.spl+tf.splua,
      sales_today:ts.count,
      days_synced:rows.length
    })

    const result = {
      ok:true, days:rows.length,
      today:{
        spend_pl:tf.spl, spend_plua:tf.splua,
        leads:tl.pl+tl.plua, quals:tl.quals
      },
      fb1_rows:fb1.length, fb2_rows:fb2.length,
      garno_leads:leads.length, garno_sales:sales.length
    }
    console.log("=== SYNC DONE ===", JSON.stringify(result))
    return new Response(JSON.stringify(result),{headers:{"Content-Type":"application/json"}})

  } catch(e:any){
    console.error("SYNC ERROR:", e)
    return new Response(JSON.stringify({error:e.message}),{status:500})
  }
})
