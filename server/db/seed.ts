/**
 * Demo data: one organization with two workspaces, ~160 donors with three years
 * of giving, campaigns, projects, grants, events, tasks, expenses, payroll,
 * budgets, impact metrics and messages. Every gift is posted to the ledger
 * through the same services the app uses.
 *
 *   npm run seed            (login: demo@ainonprofits.org / demo-password-123)
 */
import bcrypt from 'bcryptjs';
import { migrate } from './migrate.js';
import { pool, withSystem, withTenant, one, many } from './pool.js';
import { bootstrapTenant } from '../services/tenant.js';
import { systemReq } from '../services/integrations.js';
import { createGift } from '../routes/giving.js';
import { postExpense, postPayroll, accountByCode, createEntry } from '../services/ledger.js';
import { recalcDonors } from '../services/intelligence.js';
import { gazetteer } from '../services/geo.js';
import { addDays } from '../lib/util.js';

let seed = 42;
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
const daysAgo = (n: number) => addDays(new Date().toISOString().slice(0, 10), -n);

const FIRST = ['James', 'Mary', 'John', 'Patricia', 'Robert', 'Jennifer', 'Michael', 'Linda', 'David', 'Elizabeth', 'William', 'Barbara', 'Richard', 'Susan', 'Joseph', 'Jessica', 'Thomas', 'Sarah', 'Daniel', 'Karen', 'Matthew', 'Nancy', 'Anthony', 'Lisa', 'Mark', 'Betty', 'Paul', 'Grace', 'Andrew', 'Emily', 'Joshua', 'Hannah', 'Kevin', 'Rachel', 'Brian', 'Naomi', 'Samuel', 'Ruth', 'Caleb', 'Abigail'];
const LAST = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Thompson', 'White', 'Harris', 'Clark', 'Lewis', 'Walker', 'Hall', 'Young', 'King', 'Wright', 'Scott', 'Green', 'Baker', 'Adams', 'Nelson', 'Hill', 'Campbell', 'Mitchell', 'Roberts', 'Carter'];
const CITIES: [string, string][] = [['Nashville', 'TN'], ['Nashville', 'TN'], ['Franklin', 'TN'], ['Brentwood', 'TN'], ['Murfreesboro', 'TN'], ['Hendersonville', 'TN'], ['Knoxville', 'TN'], ['Atlanta', 'GA'], ['Birmingham', 'AL'], ['Louisville', 'KY'], ['Dallas', 'TX'], ['Austin', 'TX'], ['Charlotte', 'NC'], ['Raleigh', 'NC'], ['Chicago', 'IL'], ['Denver', 'CO'], ['Orlando', 'FL'], ['Chattanooga', 'TN']];

async function main() {
  await migrate();
  const exists = await withSystem((db) => one(db, `SELECT id FROM users WHERE email='demo@ainonprofits.org'`));
  if (exists) { console.log('Demo data already present.'); return; }

  const { userId, tenantId } = await withSystem(async (db) => {
    const u = await one(db, `INSERT INTO users(email,name,password_hash) VALUES ('demo@ainonprofits.org','Valerie Demo',$1) RETURNING id`, [await bcrypt.hash('demo-password-123', 12)]);
    const t = await bootstrapTenant(db, { name: 'Thought Authorities Ministries', ownerUserId: u.id, firstWorkspace: 'Hope Community Church' });
    await db.query(`UPDATE tenants SET legal_name='Thought Authorities Ministries, Inc.', email='office@example.org', phone='(615) 555-0100', address1='100 Main St', city='Nashville', region='TN', postal_code='37201', tax_id='12-3456789',
      receipt_settings='{"signatory":"Valerie Demo, Executive Director"}' WHERE id=$1`, [t.id]);
    // Teammates
    const staff = [['Marcus Finance', 'marcus@ainonprofits.org', 'Finance/Accounting'], ['Dana Development', 'dana@ainonprofits.org', 'Development/Fundraising'], ['Gina Grants', 'gina@ainonprofits.org', 'Grant Manager']];
    for (const [name, email, role] of staff) {
      const su = await one(db, `INSERT INTO users(email,name,password_hash) VALUES ($1,$2,$3) RETURNING id`, [email, name, await bcrypt.hash('demo-password-123', 12)]);
      const r = await one(db, `SELECT id FROM roles WHERE tenant_id=$1 AND name=$2`, [t.id, role]);
      await db.query(`INSERT INTO memberships(tenant_id,user_id,role_id,status,all_ministries) VALUES ($1,$2,$3,'active',true)`, [t.id, su.id, r.id]);
      const conv = await one(db, `SELECT id FROM conversations WHERE tenant_id=$1 AND name='general'`, [t.id]);
      await db.query(`INSERT INTO conversation_members(tenant_id,conversation_id,user_id) VALUES ($1,$2,$3)`, [t.id, conv.id, su.id]);
    }
    return { userId: u.id, tenantId: t.id };
  });

  await withTenant(tenantId, async (db) => {
    const req = systemReq(tenantId); (req.auth as any).userId = userId;
    const m1 = (await one(db, `SELECT id FROM ministries LIMIT 1`)).id;
    const m2 = (await one(db, `INSERT INTO ministries(tenant_id,name,color) VALUES ($1,'Global Missions Network','#0ea5e9') RETURNING id`, [tenantId])).id;
    await db.query(`INSERT INTO voice_profiles(tenant_id, ministry_id, tone, faith_enabled) VALUES ($1,$2,'Hopeful and global-minded',true)`, [tenantId, m2]);
    await db.query(`UPDATE voice_profiles SET tone='Warm, grateful, hopeful', leader_voice='Pastoral, personal, plain-spoken', faith_language='Natural and sincere', scripture_usage='Occasional, short verses', themes='Generosity, community, hope', words_to_use='partner, together, hope', words_to_avoid='guilt, desperate' WHERE ministry_id=$1`, [m1]);
    const team = await many(db, `SELECT u.id, u.name FROM users u JOIN memberships m ON m.user_id=u.id`);
    const funds = Object.fromEntries((await many(db, `SELECT id, name FROM funds`)).map((f) => [f.name, f.id]));
    const camp1 = (await one(db, `INSERT INTO campaigns(tenant_id,ministry_id,name,goal,starts_on,ends_on,status,description) VALUES ($1,$2,'Year-End Hope Campaign',150000,$3,$4,'active','Year-end appeal for community programs') RETURNING id`, [tenantId, m1, daysAgo(60), addDays(daysAgo(0), 60)])).id;
    const camp2 = (await one(db, `INSERT INTO campaigns(tenant_id,ministry_id,name,goal,starts_on,ends_on,status) VALUES ($1,$2,'Clean Water Wells',80000,$3,$4,'active') RETURNING id`, [tenantId, m2, daysAgo(200), addDays(daysAgo(0), 90)])).id;
    const camp3 = (await one(db, `INSERT INTO campaigns(tenant_id,ministry_id,name,goal,starts_on,ends_on,status) VALUES ($1,$2,'Building Renewal 2025',250000,$3,$4,'completed') RETURNING id`, [tenantId, m1, daysAgo(700), daysAgo(400)])).id;
    const proj1 = (await one(db, `INSERT INTO projects(tenant_id,ministry_id,name,description,goal,budget,fund_id,campaign_id,owner_user_id,status,starts_on) VALUES ($1,$2,'Wells for Rural Villages','Drill 8 wells in partnership with local churches',80000,72000,$3,$4,$5,'active',$6) RETURNING id`, [tenantId, m2, funds.Missions, camp2, userId, daysAgo(200)])).id;
    const proj2 = (await one(db, `INSERT INTO projects(tenant_id,ministry_id,name,description,goal,budget,fund_id,owner_user_id,status,starts_on) VALUES ($1,$2,'Youth Summer Camp','Week-long camp for 120 students',40000,38000,$3,$4,'active',$5) RETURNING id`, [tenantId, m1, funds.Youth, userId, daysAgo(120)])).id;

    // Donors
    const donorIds: { id: string; tier: number; ministry: string }[] = [];
    for (let i = 0; i < 150; i++) {
      const [city, region] = pick(CITIES); const g = gazetteer(city, region)!;
      const isOrg = i % 17 === 0;
      const first = pick(FIRST), last = pick(LAST);
      const ministry = rnd() < 0.7 ? m1 : m2;
      const d = await one(db, `INSERT INTO donors(tenant_id, ministry_id, donor_type, first_name, last_name, org_name, spouse_name, email, phone, address1, city, region, postal_code, country, lat, lng, tags, source, owner_user_id, capacity_estimate, notes)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'US',$14,$15,$16,$17,$18,$19,$20) RETURNING id`,
        [tenantId, ministry, isOrg ? pick(['foundation', 'business', 'church']) : 'individual', isOrg ? null : first, isOrg ? null : last, isOrg ? `${last} ${pick(['Family Foundation', 'Group', 'Community Church'])}` : null,
         !isOrg && rnd() < 0.4 ? pick(FIRST) : null, `${first.toLowerCase()}.${last.toLowerCase()}${i}@example.com`, `(615) 555-${String(1000 + i).slice(-4)}`, `${100 + i} ${pick(['Oak', 'Maple', 'Cedar', 'Elm'])} St`,
         city, region, String(37000 + Math.floor(rnd() * 999)), g.lat + (rnd() - 0.5) * 0.15, g.lng + (rnd() - 0.5) * 0.15, rnd() < 0.2 ? ['board'] : rnd() < 0.3 ? ['volunteer'] : [],
         pick(['Event', 'Website', 'Referral', 'Church service', 'Mailing']), pick(team).id, rnd() < 0.15 ? Math.round(50000 + rnd() * 500000) : null, rnd() < 0.2 ? 'Prefers phone calls in the afternoon.' : null]);
      donorIds.push({ id: d.id, tier: rnd() < 0.08 ? 3 : rnd() < 0.3 ? 2 : 1, ministry });
    }
    // Gifts over 3 years with varied patterns
    const fundsList = [funds.General, funds.General, funds.General, funds.Missions, funds.Building, funds.Youth, funds.Benevolence];
    for (const [idx, d] of donorIds.entries()) {
      const pattern = idx % 6; // 0 active, 1 lapsing, 2 lapsed major, 3 recurring, 4 first-time, 5 cooling
      const base = d.tier === 3 ? 3000 : d.tier === 2 ? 900 : 160;
      const dates: number[] = [];
      if (pattern === 0) for (let k = 0; k < 6; k++) dates.push(Math.floor(rnd() * 330) + 5);
      if (pattern === 1) for (let k = 0; k < 4; k++) dates.push(600 + Math.floor(rnd() * 120));
      if (pattern === 2) for (let k = 0; k < 5; k++) dates.push(760 + Math.floor(rnd() * 300));
      if (pattern === 3) for (let k = 0; k < 14; k++) dates.push(10 + k * 30);
      if (pattern === 4) dates.push(Math.floor(rnd() * 40) + 2);
      if (pattern === 5) for (let k = 0; k < 3; k++) dates.push(380 + Math.floor(rnd() * 140));
      const amt = pattern === 2 ? base * 4 : pattern === 3 ? [25, 50, 100, 250][d.tier] : base;
      for (const [k, ago] of dates.sort((a, b) => b - a).entries()) {
        const recent = ago < 25;
        const gift = await createGift(db, req, {
          donor_id: d.id, ministry_id: d.ministry, amount: Math.round(amt * (0.6 + rnd() * 0.9)), gift_date: daysAgo(ago), fund_id: pattern === 3 ? funds['Staff Support'] : pick(fundsList),
          campaign_id: ago < 60 && rnd() < 0.5 ? camp1 : ago > 400 && ago < 700 && rnd() < 0.3 ? camp3 : d.ministry === m2 && ago < 200 && rnd() < 0.5 ? camp2 : null,
          project_id: d.ministry === m2 && ago < 200 && rnd() < 0.3 ? proj1 : null,
          gift_type: pattern === 3 ? 'recurring' : 'one_time', payment_method: pick(['check', 'card', 'ach', 'cash', 'stripe']),
          receipt_status: recent && rnd() < 0.6 ? 'pending' : 'sent', thank_you_status: recent && rnd() < 0.7 ? 'pending' : 'sent',
          recurring: pattern === 3 && k === 0 ? { frequency: 'monthly' } : undefined,
        });
        if (pattern === 3 && k === 0) await db.query(`UPDATE recurring_gifts SET started_on=$2 WHERE id=$1`, [gift.recurring_gift_id, daysAgo(ago)]);
      }
      if (rnd() < 0.25) await db.query(`INSERT INTO communications(tenant_id,ministry_id,donor_id,user_id,type,subject,body,occurred_at,duration_hours) VALUES ($1,$2,$3,$4,$5,$6,$7,now() - make_interval(days => $8),0.25)`,
        [tenantId, d.ministry, d.id, pick(team).id, pick(['phone', 'meeting', 'email']), pick(['Check-in call', 'Coffee meeting', 'Thank-you call', 'Campaign update']), 'Good conversation about upcoming plans.', Math.floor(rnd() * 200)]);
    }
    // Opening balances so restricted funds and cash are realistic
    const cash = await accountByCode(db, '1000'), naW = await accountByCode(db, '3000'), naR = await accountByCode(db, '3100');
    await createEntry(db, tenantId, userId, { entry_date: daysAgo(1100), memo: 'Opening balances', source: 'manual', lines: [
      { account_id: cash, fund_id: funds.General, debit: 260000 }, { account_id: naW, fund_id: funds.General, credit: 260000 },
      { account_id: cash, fund_id: funds.Endowment, debit: 250000 }, { account_id: naR, fund_id: funds.Endowment, credit: 250000 },
      { account_id: cash, fund_id: funds.Building, debit: 40000 }, { account_id: naR, fund_id: funds.Building, credit: 40000 }] });
    // Move undeposited funds to checking (deposits)
    const und = await accountByCode(db, '1050');
    for (const f of await many(db, `SELECT jl.fund_id, sum(jl.debit-jl.credit)::float bal FROM journal_lines jl JOIN journal_entries je ON je.id=jl.entry_id AND je.status='posted' WHERE jl.account_id=$1 GROUP BY 1 HAVING sum(jl.debit-jl.credit) > 0`, [und])) {
      await createEntry(db, tenantId, userId, { entry_date: daysAgo(3), memo: 'Bank deposit', source: 'manual', lines: [{ account_id: cash, fund_id: f.fund_id, debit: f.bal }, { account_id: und, fund_id: f.fund_id, credit: Math.round(f.bal * 100) / 100 }] });
    }
    // Expenses & payroll
    const exp = async (vendor: string, code: string, fund: string, amount: number, ago: number, project?: string) => {
      const x = await one(db, `INSERT INTO expenses(tenant_id, ministry_id, vendor, expense_date, amount, account_id, fund_id, project_id, payment_account_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [tenantId, m1, vendor, daysAgo(ago), amount, await accountByCode(db, code), funds[fund], project ?? null, cash, userId]);
      await postExpense(db, tenantId, userId, x.id);
    };
    for (let mth = 0; mth < 11; mth++) {
      await exp('Property Management LLC', '5100', 'General', 1800, 15 + mth * 30);
      await exp('Cloud Software Co.', '5600', 'General', 380, 12 + mth * 30);
      const p = await one(db, `INSERT INTO payroll_entries(tenant_id, ministry_id, staff_name, pay_date, gross, employer_taxes, benefits, department, account_id, fund_id) VALUES ($1,$2,'Pastoral & Program Staff',$3,5200,400,450,'Programs',$4,$5) RETURNING id`,
        [tenantId, m1, daysAgo(5 + mth * 30), await accountByCode(db, '5000'), funds.General]);
      await postPayroll(db, tenantId, userId, p.id);
    }
    await exp('Rural Water Partners', '5300', 'Missions', 18000, 90, proj1);
    await exp('Rural Water Partners', '5300', 'Missions', 12500, 30, proj1);
    await exp('Camp Pine Ridge', '5200', 'Youth', 9800, 45, proj2);
    await exp('Family assistance — rent', '5950', 'Benevolence', 1200, 20);
    // Budget
    const yr = new Date().getFullYear();
    const bud = await one(db, `INSERT INTO budgets(tenant_id,name,period_start,period_end) VALUES ($1,$2,$3,$4) RETURNING id`, [tenantId, `FY${yr} Operating Budget`, `${yr}-01-01`, `${yr}-12-31`]);
    for (const [code, amt] of [['4000', 300000], ['5000', 120000], ['5100', 28800], ['5600', 4000], ['5300', 35000], ['5200', 12000], ['5500', 8000]] as [string, number][])
      await db.query(`INSERT INTO budget_lines(tenant_id,budget_id,account_id,amount) VALUES ($1,$2,$3,$4)`, [tenantId, bud.id, await accountByCode(db, code), amt]);
    // Bank feed sample (unreviewed)
    const ba = await one(db, `SELECT id FROM bank_accounts LIMIT 1`);
    for (const [desc, amt, ago] of [['ONLINE TRANSFER — STRIPE PAYOUT', 1240.5, 2], ['UTILITY CO AUTOPAY', -612.33, 4], ['OFFICE SUPPLY STORE', -148.2, 6], ['DEPOSIT', 3200, 1]] as [string, number, number][])
      await db.query(`INSERT INTO bank_transactions(tenant_id, bank_account_id, txn_date, description, amount, external_id) VALUES ($1,$2,$3,$4,$5,$6)`, [tenantId, ba.id, daysAgo(ago), desc, amt, `seed-${desc}-${ago}`]);
    // Grants
    const f1 = (await one(db, `INSERT INTO funders(tenant_id,name,contact_name,email,focus_areas) VALUES ($1,'Lilly Community Foundation','Ann Program','ann@example.org','Youth, community development') RETURNING id`, [tenantId])).id;
    const f2 = (await one(db, `INSERT INTO funders(tenant_id,name,contact_name,email,focus_areas) VALUES ($1,'Clean Water Trust','Tom Officer','tom@example.org','Water, sanitation') RETURNING id`, [tenantId])).id;
    for (const [title, funder, req_, status, dl, ministry, project] of [
      ['Youth Mentoring Expansion', f1, 50000, 'preparing', addDays(daysAgo(0), 12), m1, proj2], ['Village Wells Phase 2', f2, 75000, 'submitted', daysAgo(20), m2, proj1],
      ['Community Food Pantry', f1, 25000, 'awarded', daysAgo(150), m1, null], ['Leadership Training Grant', f1, 15000, 'researching', addDays(daysAgo(0), 45), m1, null]] as any[])
      await db.query(`INSERT INTO grants(tenant_id, ministry_id, funder_id, title, request_amount, awarded_amount, status, deadline, assignee_id, project_id, report_due, decision_on) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [tenantId, ministry, funder, title, req_, status === 'awarded' ? req_ : null, status, dl, team.find((t) => t.name.startsWith('Gina'))?.id ?? userId, project, status === 'awarded' ? addDays(daysAgo(0), 20) : null, status === 'awarded' ? daysAgo(120) : null]);
    // Events
    const ev = await one(db, `INSERT INTO events(tenant_id, ministry_id, name, event_type, starts_at, location, description, capacity, slug, campaign_id) VALUES ($1,$2,'Vision Dinner 2026','fundraiser',now() + interval '21 days','Hope Hall, Nashville','An evening celebrating what God is doing through our community.',200,'vision-dinner-2026',$3) RETURNING id`, [tenantId, m1, camp1]);
    for (const d of donorIds.slice(0, 18)) {
      const dd = await one(db, `SELECT first_name, last_name, email FROM donors WHERE id=$1`, [d.id]);
      await db.query(`INSERT INTO registrations(tenant_id,event_id,donor_id,name,email) VALUES ($1,$2,$3,$4,$5)`, [tenantId, ev.id, d.id, `${dd.first_name ?? 'Guest'} ${dd.last_name ?? ''}`.trim(), dd.email]);
    }
    await db.query(`INSERT INTO events(tenant_id, ministry_id, name, event_type, starts_at, location, slug, status) VALUES ($1,$2,'Missions Webinar','webinar',now() + interval '9 days','Online','missions-webinar-q4','published')`, [tenantId, m2]);
    // Tasks, jobs, time
    const rt = await many(db, `SELECT id FROM rate_types`);
    for (const [title, due, status, prog] of [['Prepare year-end appeal letter', 3, 'in_progress', 60], ['Board report for Q3', -2, 'todo', 0], ['Update donor database tags', 10, 'todo', 10], ['Grant narrative: Youth Mentoring', 8, 'in_progress', 40], ['Plan Vision Dinner seating', 14, 'waiting', 20], ['Reconcile October bank statement', -5, 'todo', 0]] as [string, number, string, number][])
      await db.query(`INSERT INTO tasks(tenant_id, ministry_id, title, due_date, status, progress, assignee_id, created_by, rate_type_id, est_hours, billable, category) VALUES ($1,$2,$3,$4,$5,$6,$7,$7,$8,$9,$10,'General')`,
        [tenantId, m1, title, addDays(daysAgo(0), due), status, prog, pick(team).id, pick(rt).id, 2 + Math.floor(rnd() * 8), rnd() < 0.3]);
    const job = await one(db, `INSERT INTO jobs(tenant_id, ministry_id, title, client_name, status, engagement_type, assignee_id, due_date) VALUES ($1,$2,'Website refresh for partner church','Grace Fellowship','in_progress','hourly',$3,$4) RETURNING id`, [tenantId, m1, userId, addDays(daysAgo(0), 6)]);
    for (let k = 0; k < 6; k++) await db.query(`INSERT INTO time_entries(tenant_id, ministry_id, user_id, entry_date, hours, description, rate_type_id, billable, job_id) VALUES ($1,$2,$3,$4,$5,'Design and build',$6,true,$7)`, [tenantId, m1, userId, daysAgo(k), 1.5 + k % 3, rt[1].id, job.id]);
    // Impact
    const im = await one(db, `INSERT INTO impact_metrics(tenant_id, ministry_id, project_id, fund_id, name, unit, target, period_start, period_end) VALUES ($1,$2,$3,$4,'Wells completed','wells',8,$5,$6) RETURNING id`, [tenantId, m2, proj1, funds.Missions, `${yr}-01-01`, `${yr}-12-31`]);
    await db.query(`INSERT INTO impact_entries(tenant_id, metric_id, value, entry_date) VALUES ($1,$2,3,$3),($1,$2,2,$4)`, [tenantId, im.id, daysAgo(80), daysAgo(20)]);
    const im2 = await one(db, `INSERT INTO impact_metrics(tenant_id, ministry_id, project_id, name, unit, target, period_start, period_end) VALUES ($1,$2,$3,'Students served','students',120,$4,$5) RETURNING id`, [tenantId, m1, proj2, `${yr}-01-01`, `${yr}-12-31`]);
    await db.query(`INSERT INTO impact_entries(tenant_id, metric_id, value, entry_date) VALUES ($1,$2,96,$3)`, [tenantId, im2.id, daysAgo(40)]);
    await db.query(`INSERT INTO impact_stories(tenant_id, ministry_id, project_id, title, story, beneficiaries, shareable) VALUES ($1,$2,$3,'Water in Kibera village','For the first time, families in the village no longer walk four hours for water. Children are back in school.',420,true)`, [tenantId, m2, proj1]);
    // Email
    const aud = await one(db, `INSERT INTO audiences(tenant_id, name, description, filters) VALUES ($1,'Lapsed donors','Donors lapsing or lapsed','{"lapsed":true}') RETURNING id`, [tenantId]);
    await db.query(`INSERT INTO audiences(tenant_id, name, filters) VALUES ($1,'Monthly partners','{"recurring":true}'),($1,'Major donors ($5k+ lifetime)','{"minLifetime":5000}')`, [tenantId]);
    await db.query(`INSERT INTO email_campaigns(tenant_id, ministry_id, name, subject, preview_text, blocks, audience_id, campaign_id, created_by) VALUES ($1,$2,'We miss you — a quick update','{{first_name}}, here''s what your past gifts made possible','A short story from this year',$3,$4,$5,$6)`,
      [tenantId, m1, JSON.stringify([{ type: 'heading', text: 'Look what you helped build' }, { type: 'text', text: 'Dear {{first_name}},\n\nYour generosity helped launch our community programs. Here is a short update…' }, { type: 'donate', text: 'Will you partner with us again?', url: 'https://example.org/give', amounts: [25, 50, 100, 250] }]), aud.id, camp1, userId]);
    await db.query(`INSERT INTO journeys(tenant_id, name, trigger, mode, steps, status) VALUES ($1,'First-time donor welcome','first_gift','approval',$2,'paused')`, [tenantId, JSON.stringify([
      { delayDays: 1, subject: 'Welcome to the family, {{first_name}}!', blocks: [{ type: 'text', text: 'Thank you for your first gift of {{last_gift_amount}}. Here is what happens next…' }] },
      { delayDays: 14, subject: 'See your gift at work', blocks: [{ type: 'text', text: 'Two weeks ago you gave for the first time. Here is a story from the field…' }] }])]);
    await db.query(`INSERT INTO growth_goals(tenant_id, name, metric, target, period_start, period_end) VALUES ($1,'Raise $450K this year','giving_total',450000,$2,$3),($1,'Add 60 new donors','new_donors',60,$2,$3),($1,'Retention above 55%','retention_rate',55,$2,$3)`, [tenantId, `${yr}-01-01`, `${yr}-12-31`]);
    // Messages
    const conv = await one(db, `SELECT id FROM conversations WHERE name='general'`);
    await db.query(`INSERT INTO messages(tenant_id, conversation_id, user_id, body) VALUES ($1,$2,$3,'Welcome to A.I. Nonprofits! Year-end campaign kickoff is Monday.')`, [tenantId, conv.id, userId]);
    await recalcDonors(db);
  });
  console.log('Seeded demo organization. Login: demo@ainonprofits.org / demo-password-123');
}

main().then(() => pool.end()).catch((e) => { console.error(e); process.exit(1); });
