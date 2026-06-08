-- ── METRICS DAILY (populated by Edge Function hourly) ──
CREATE TABLE IF NOT EXISTS metrics_daily (
  day DATE PRIMARY KEY,
  spend_pl DECIMAL(10,2) DEFAULT 0,
  spend_plua DECIMAL(10,2) DEFAULT 0,
  leads_pl INTEGER DEFAULT 0,
  leads_plua INTEGER DEFAULT 0,
  quals INTEGER DEFAULT 0,
  quals_pl INTEGER DEFAULT 0,
  quals_plua INTEGER DEFAULT 0,
  sales_count INTEGER DEFAULT 0,
  sales_amount_zl DECIMAL(12,2) DEFAULT 0,
  fb_leads_pl INTEGER DEFAULT 0,
  fb_leads_plua INTEGER DEFAULT 0,
  cpl DECIMAL(10,2) DEFAULT 0,
  cql DECIMAL(10,2) DEFAULT 0,
  ctr DECIMAL(6,3) DEFAULT 0,
  roi DECIMAL(10,2) DEFAULT 0,
  synced_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── SYNC LOG ──
CREATE TABLE IF NOT EXISTS sync_log (
  id BIGSERIAL PRIMARY KEY,
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  leads_today INTEGER DEFAULT 0,
  quals_today INTEGER DEFAULT 0,
  spend_today DECIMAL(10,2) DEFAULT 0,
  sales_today INTEGER DEFAULT 0,
  days_synced INTEGER DEFAULT 0
);

-- ── ZALIVS ──
CREATE TABLE IF NOT EXISTS zalivs (
  id BIGSERIAL PRIMARY KEY,
  geo TEXT NOT NULL CHECK (geo IN ('PL','PLUA')),
  name TEXT NOT NULL,
  ad_budget DECIMAL(10,2) DEFAULT 0,
  rk_budget DECIMAL(10,2) DEFAULT 0,
  domain TEXT,
  creos JSONB DEFAULT '[]',
  goals JSONB DEFAULT '[]',
  ind TEXT DEFAULT 'profit' CHECK (ind IN ('profit','drop','off')),
  status TEXT DEFAULT 'Test',
  insights TEXT DEFAULT '',
  buyer TEXT DEFAULT 'Illia',
  funnel TEXT DEFAULT 'Калькулятор',
  score INTEGER DEFAULT 0 CHECK (score >= 0 AND score <= 6),
  date TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── DOMAINS ──
CREATE TABLE IF NOT EXISTS domains (
  id BIGSERIAL PRIMARY KEY,
  url TEXT NOT NULL,
  description TEXT DEFAULT '',
  geos JSONB DEFAULT '[]',
  funnel TEXT DEFAULT 'Калькулятор',
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── TASKS ──
CREATE TABLE IF NOT EXISTS tasks (
  id BIGSERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  col TEXT DEFAULT 'todo' CHECK (col IN ('all','todo','process','done')),
  assignee TEXT DEFAULT '',
  deadline DATE,
  priority TEXT DEFAULT 'mid' CHECK (priority IN ('high','mid','low')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── JOURNAL ──
CREATE TABLE IF NOT EXISTS journal_docs (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT DEFAULT '',
  folder_id TEXT DEFAULT '',
  folder_name TEXT DEFAULT '',
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── RLS: allow all for anon (team uses shared anon key) ──
ALTER TABLE metrics_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE zalivs ENABLE ROW LEVEL SECURITY;
ALTER TABLE domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_docs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public_all" ON metrics_daily FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "public_all" ON sync_log FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "public_all" ON zalivs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "public_all" ON domains FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "public_all" ON tasks FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "public_all" ON journal_docs FOR ALL USING (true) WITH CHECK (true);

-- Enable Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE zalivs;
ALTER PUBLICATION supabase_realtime ADD TABLE tasks;
ALTER PUBLICATION supabase_realtime ADD TABLE domains;
ALTER PUBLICATION supabase_realtime ADD TABLE journal_docs;
ALTER PUBLICATION supabase_realtime ADD TABLE metrics_daily;
