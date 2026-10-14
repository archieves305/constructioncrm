-- Read-only probe for the GC Partnerships plan (2026-10-13). SELECTs only.
-- Run on the droplet:  psql "${DATABASE_URL%%\?*}" -f gc-probe-2026-10-13.sql
\pset format aligned
select 'leads_total' k, count(*) v from leads
union all select 'leads_commercial', count(*) from leads where property_type = 'COMMERCIAL'
union all select 'leads_with_company', count(*) from leads where company_name is not null and company_name <> ''
union all select 'jobs_total', count(*) from jobs
union all select 'jobs_progress_billing', count(*) from jobs where billing_method = 'PROGRESS'
union all select 'vendors', count(*) from vendors
union all select 'invoices', count(*) from invoices
union all select 'invoices_paid', count(*) from invoices where status = 'PAID'
union all select 'payments_linked_to_invoice', count(*) from payments where invoice_id is not null
union all select 'payments_total', count(*) from payments
union all select 'communications', count(*) from communications
union all select 'activity_logs', count(*) from activity_logs
union all select 'inbound_email_events', count(*) from inbound_email_events
union all select 'estimates', count(*) from estimates
union all select 'roof_estimates', count(*) from roof_estimates
union all select 'users_active', count(*) from users where is_active;

select company_name, count(*) from leads
 where company_name is not null and company_name <> ''
 group by 1 order by 2 desc limit 15;

select s.name as source, count(*) from leads l left join lead_sources s on s.id = l.source_id
 group by 1 order by 2 desc;

select st.name as stage, st.stage_order, count(l.id)
  from lead_stages st left join leads l on l.current_stage_id = st.id
 group by 1, 2 order by 2;

-- The commercial / progress-billed / large jobs: the GC pattern already on prod.
select j.job_number, j.title, j.job_type, j.billing_method, j.contract_amount, j.retainage_percent,
       l.company_name, l.full_name, l.property_type, l.city
  from jobs j join leads l on l.id = j.lead_id
 where j.billing_method = 'PROGRESS' or l.property_type = 'COMMERCIAL' or j.contract_amount > 200000
 order by j.contract_amount desc limit 12;

-- Days-to-pay today, where a payment is linked to its invoice.
select j.job_number, i.invoice_number, i.issue_date::date, p.received_date::date,
       (p.received_date::date - i.issue_date::date) as days_to_pay
  from payments p join invoices i on i.id = p.invoice_id join jobs j on j.id = i.job_id
 where p.status = 'RECEIVED'
 order by i.issue_date limit 30;
