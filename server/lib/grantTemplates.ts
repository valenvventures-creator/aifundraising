/**
 * Grant application templates by country.
 *
 * Built from the common structure of public-sector grant applications:
 * - United States: the SF-424 family used for federal grants (Application for Federal Assistance,
 *   SF-424A budget object classes), SAM.gov / UEI and Grants.gov registration, and the narrative
 *   sections most notices of funding opportunity ask for (need, objectives, methods, evaluation,
 *   capacity, sustainability, budget justification).
 * - Canada: the sections federal departments ask for in their applicant guides (organization and CRA
 *   business number, objectives, activities and work plan, expected results, GBA Plus, official
 *   languages, eligible cost categories, other sources of funding in cash and in kind).
 *
 * Every program has its own rules. The templates collect what applications usually need so the
 * organization can paste it into the funder's own form or portal. They never submit anything.
 */

export type FieldType = 'text' | 'textarea' | 'number' | 'money' | 'date' | 'select' | 'checkbox' | 'email' | 'phone' | 'budget';

export interface TemplateField {
  key: string;
  label: string;
  type: FieldType;
  help?: string;
  required?: boolean;
  options?: string[];
  words?: number;          // suggested maximum length for narrative answers
  draftable?: boolean;     // A.I. can suggest a draft (the user decides whether to use it)
  placeholder?: string;
  half?: boolean;          // render at half width
}
export interface TemplateSection { key: string; title: string; intro: string; fields: TemplateField[] }
export interface BudgetLine { key: string; label: string; help: string }
export interface GrantTemplate {
  country: 'US' | 'CA';
  name: string;
  currency: string;
  sections: TemplateSection[];
  budgetLines: BudgetLine[];
  attachments: { key: string; label: string; help: string }[];
  resources: { label: string; url: string }[];
}

const US: GrantTemplate = {
  country: 'US',
  name: 'United States: federal-style grant application',
  currency: 'USD',
  sections: [
    {
      key: 'eligibility', title: 'Eligibility & registrations',
      intro: 'Federal applications are rejected if registrations are missing or expired. SAM.gov registration must be renewed every year and can take several weeks, so start early.',
      fields: [
        { key: 'legal_name', label: 'Legal name (exactly as in SAM.gov)', type: 'text', required: true },
        { key: 'ein', label: 'Employer Identification Number (EIN)', type: 'text', required: true, placeholder: '12-3456789', half: true },
        { key: 'uei', label: 'Unique Entity ID (UEI)', type: 'text', required: true, placeholder: '12 characters from SAM.gov', help: 'Replaced the DUNS number. Found in your SAM.gov entity record.', half: true },
        { key: 'org_type', label: 'Organization type', type: 'select', required: true, options: ['Nonprofit with 501(c)(3) status', 'Nonprofit without 501(c)(3) status', 'Faith-based organization', 'Tribal organization', 'Other'], half: true },
        { key: 'sam_expires', label: 'SAM.gov registration expires on', type: 'date', required: true, half: true },
        { key: 'grants_gov_ready', label: 'Grants.gov account set up, with an Authorized Organization Representative (AOR) role', type: 'checkbox', required: true },
        { key: 'address', label: 'Organization address', type: 'textarea', required: true },
        { key: 'congressional_district', label: 'Congressional district (applicant)', type: 'text', placeholder: 'e.g. TX-007', half: true },
        { key: 'fiscal_year_end', label: 'Fiscal year end', type: 'text', placeholder: 'e.g. June 30', half: true },
        { key: 'annual_budget', label: 'Organization annual operating budget', type: 'money', half: true },
        { key: 'single_audit', label: 'Spent $1,000,000+ in federal awards last fiscal year (Single Audit required)', type: 'checkbox' },
        { key: 'federal_debt', label: 'Organization is not delinquent on any federal debt', type: 'checkbox', required: true },
      ],
    },
    {
      key: 'contacts', title: 'People',
      intro: 'The authorized representative signs and certifies the application. The project director runs the work and is usually the funder\'s main contact.',
      fields: [
        { key: 'aor_name', label: 'Authorized representative: name', type: 'text', required: true, half: true },
        { key: 'aor_title', label: 'Title', type: 'text', required: true, half: true },
        { key: 'aor_email', label: 'Email', type: 'email', required: true, half: true },
        { key: 'aor_phone', label: 'Phone', type: 'phone', half: true },
        { key: 'pd_name', label: 'Project director: name', type: 'text', required: true, half: true },
        { key: 'pd_title', label: 'Title', type: 'text', half: true },
        { key: 'pd_email', label: 'Email', type: 'email', required: true, half: true },
        { key: 'pd_phone', label: 'Phone', type: 'phone', half: true },
      ],
    },
    {
      key: 'opportunity', title: 'Funding opportunity',
      intro: 'Copy these from the notice of funding opportunity (NOFO). Read its eligibility, page limits and scoring criteria before writing.',
      fields: [
        { key: 'agency', label: 'Federal agency', type: 'text', required: true, half: true },
        { key: 'opportunity_number', label: 'Funding opportunity number', type: 'text', required: true, half: true },
        { key: 'assistance_listing', label: 'Assistance Listing (CFDA) number', type: 'text', placeholder: 'e.g. 93.136', half: true },
        { key: 'deadline', label: 'Application deadline', type: 'date', required: true, half: true },
        { key: 'submission_type', label: 'Type of application', type: 'select', options: ['New', 'Continuation', 'Revision'], half: true },
        { key: 'scoring', label: 'Review criteria and points (from the notice)', type: 'textarea', help: 'List each criterion and its points. Write to the criteria in that order.' },
      ],
    },
    {
      key: 'summary', title: 'Project summary',
      intro: 'Reviewers read this first. Keep it concrete: who you serve, what you will do, and the measurable result.',
      fields: [
        { key: 'project_title', label: 'Descriptive project title', type: 'text', required: true },
        { key: 'start_date', label: 'Proposed start date', type: 'date', required: true, half: true },
        { key: 'end_date', label: 'Proposed end date', type: 'date', required: true, half: true },
        { key: 'amount_requested', label: 'Federal funds requested', type: 'money', required: true, half: true },
        { key: 'match', label: 'Cost share / match (cash and in-kind)', type: 'money', help: 'Only if the notice requires or rewards cost sharing.', half: true },
        { key: 'areas_affected', label: 'Areas affected (cities, counties, states)', type: 'text' },
        { key: 'abstract', label: 'Project abstract', type: 'textarea', required: true, words: 300, draftable: true, help: 'Usually one page: need, target population, activities, objectives and expected outcomes.' },
      ],
    },
    {
      key: 'narrative', title: 'Project narrative',
      intro: 'Most notices ask for these parts, often with page limits. Use the funder\'s headings if they differ.',
      fields: [
        { key: 'need', label: 'Statement of need', type: 'textarea', required: true, words: 600, draftable: true, help: 'Who is affected, how many, and local data with sources. Show why this matters now and why your community.' },
        { key: 'objectives', label: 'Goals and measurable objectives', type: 'textarea', required: true, words: 400, draftable: true, help: 'SMART objectives: specific, measurable, achievable, relevant, time-bound. e.g. "By June 2028, 120 youth complete 40+ mentoring hours."' },
        { key: 'methods', label: 'Project design, activities and timeline', type: 'textarea', required: true, words: 800, draftable: true, help: 'What you will do, who does it, when, and why this approach works (evidence base).' },
        { key: 'population', label: 'Target population and reach', type: 'textarea', words: 300, draftable: true },
        { key: 'capacity', label: 'Organizational capacity and key personnel', type: 'textarea', required: true, words: 500, draftable: true, help: 'Track record, similar projects, financial management systems, and qualifications of key staff.' },
        { key: 'partners', label: 'Partners and collaboration', type: 'textarea', words: 300, draftable: true },
        { key: 'evaluation', label: 'Evaluation plan and performance measures', type: 'textarea', required: true, words: 500, draftable: true, help: 'Outputs and outcomes, data you will collect, tools, who analyzes it and how often you report.' },
        { key: 'logic_model', label: 'Logic model (inputs → activities → outputs → outcomes)', type: 'textarea', words: 300, draftable: true },
        { key: 'sustainability', label: 'Sustainability plan', type: 'textarea', required: true, words: 300, draftable: true, help: 'How the work continues after the grant ends.' },
      ],
    },
    {
      key: 'budget', title: 'Budget & justification',
      intro: 'Federal budgets use the SF-424A cost categories. Every line needs a justification showing how it was calculated (e.g. 0.5 FTE × $52,000).',
      fields: [
        { key: 'budget', label: 'Budget by category', type: 'budget', required: true },
        { key: 'indirect_basis', label: 'Indirect cost rate basis', type: 'select', options: ['Negotiated rate agreement (NICRA)', 'De minimis rate (up to 15% of modified total direct costs)', 'Not charging indirect costs'], half: true },
        { key: 'indirect_rate', label: 'Indirect rate (%)', type: 'number', half: true },
        { key: 'budget_justification', label: 'Budget justification', type: 'textarea', required: true, words: 800, draftable: true },
      ],
    },
  ],
  budgetLines: [
    { key: 'personnel', label: 'Personnel', help: 'Salaries: name/position × % time × annual salary.' },
    { key: 'fringe', label: 'Fringe benefits', help: 'Benefits rate × personnel costs.' },
    { key: 'travel', label: 'Travel', help: 'Trips, people, mileage, lodging and per diem.' },
    { key: 'equipment', label: 'Equipment', help: 'Items of $10,000+ per unit with a useful life over one year.' },
    { key: 'supplies', label: 'Supplies', help: 'Materials and items under the equipment threshold.' },
    { key: 'contractual', label: 'Contractual', help: 'Contractors, consultants and subawards.' },
    { key: 'construction', label: 'Construction', help: 'Only if the program allows it.' },
    { key: 'other', label: 'Other', help: 'Rent, printing, participant support, evaluation, etc.' },
    { key: 'indirect', label: 'Indirect costs', help: 'Rate × base, per your rate agreement or the de minimis rate.' },
  ],
  attachments: [
    { key: 'sf424', label: 'SF-424 Application for Federal Assistance', help: 'Completed in Grants.gov Workspace.' },
    { key: 'sf424a', label: 'SF-424A Budget Information', help: 'Uses the budget categories above.' },
    { key: 'abstract_doc', label: 'Project abstract', help: 'Usually a one-page PDF.' },
    { key: 'narrative_doc', label: 'Project narrative', help: 'Within the page limit and formatting rules in the notice.' },
    { key: 'budget_just_doc', label: 'Budget justification', help: '' },
    { key: 'sflll', label: 'SF-LLL Disclosure of Lobbying Activities', help: 'Only if you lobby with non-federal funds.' },
    { key: 'nicra', label: 'Indirect cost rate agreement', help: 'If using a negotiated rate.' },
    { key: 'irs_letter', label: 'IRS 501(c)(3) determination letter', help: '' },
    { key: 'resumes', label: 'Résumés or bios of key personnel', help: '' },
    { key: 'letters', label: 'Letters of support or commitment', help: 'From partners named in the narrative.' },
    { key: 'financials', label: 'Audited financial statements / Single Audit', help: 'If requested.' },
    { key: 'board', label: 'Board of directors list', help: 'Often requested by foundations and some agencies.' },
  ],
  resources: [
    { label: 'Search federal grants (Grants.gov)', url: 'https://www.grants.gov/search-grants' },
    { label: 'Register your organization (Grants.gov)', url: 'https://www.grants.gov/applicants/applicant-registration' },
    { label: 'SAM.gov entity registration and UEI', url: 'https://sam.gov/content/entity-registration' },
  ],
};

const CA: GrantTemplate = {
  country: 'CA',
  name: 'Canada: federal-style application for funding',
  currency: 'CAD',
  sections: [
    {
      key: 'organization', title: 'Organization',
      intro: 'Federal departments check legal status, your CRA business number and your mandate first. Have your incorporation documents and latest financial statements ready.',
      fields: [
        { key: 'legal_name', label: 'Legal name', type: 'text', required: true },
        { key: 'operating_name', label: 'Operating name (if different)', type: 'text' },
        { key: 'business_number', label: 'CRA business number (BN)', type: 'text', required: true, placeholder: '9 digits', half: true },
        { key: 'charity_number', label: 'Registered charity number (if a charity)', type: 'text', placeholder: '123456789 RR 0001', half: true },
        { key: 'org_type', label: 'Organization type', type: 'select', required: true, options: ['Not-for-profit organization', 'Registered charity', 'Indigenous organization', 'Co-operative', 'Municipality', 'Other'], half: true },
        { key: 'incorporation', label: 'Incorporated under (act and year)', type: 'text', placeholder: 'e.g. Canada Not-for-profit Corporations Act, 2014', half: true },
        { key: 'mandate', label: 'Mandate / mission', type: 'textarea', required: true, words: 150, draftable: true },
        { key: 'address', label: 'Mailing address', type: 'textarea', required: true },
        { key: 'province', label: 'Province or territory', type: 'select', required: true, options: ['Alberta', 'British Columbia', 'Manitoba', 'New Brunswick', 'Newfoundland and Labrador', 'Northwest Territories', 'Nova Scotia', 'Nunavut', 'Ontario', 'Prince Edward Island', 'Quebec', 'Saskatchewan', 'Yukon'], half: true },
        { key: 'languages', label: 'Official language(s) of service', type: 'select', options: ['English', 'French', 'English and French'], half: true },
        { key: 'staff', label: 'Paid staff (full-time equivalent)', type: 'number', half: true },
        { key: 'volunteers', label: 'Volunteers', type: 'number', half: true },
        { key: 'annual_budget', label: 'Annual operating budget', type: 'money', half: true },
        { key: 'fiscal_year_end', label: 'Fiscal year end', type: 'text', placeholder: 'e.g. March 31', half: true },
      ],
    },
    {
      key: 'contacts', title: 'People',
      intro: 'Most programs need a primary contact plus one or two signing officers who can legally bind the organization.',
      fields: [
        { key: 'contact_name', label: 'Primary contact: name', type: 'text', required: true, half: true },
        { key: 'contact_title', label: 'Title', type: 'text', half: true },
        { key: 'contact_email', label: 'Email', type: 'email', required: true, half: true },
        { key: 'contact_phone', label: 'Phone', type: 'phone', half: true },
        { key: 'signing_officer', label: 'Signing officer(s): names and titles', type: 'textarea', required: true },
      ],
    },
    {
      key: 'program', title: 'Funding program',
      intro: 'Copy these from the program\'s applicant guide. Check the intake dates, eligible applicants and the maximum contribution.',
      fields: [
        { key: 'department', label: 'Department or agency', type: 'text', required: true, half: true },
        { key: 'program_name', label: 'Program and stream', type: 'text', required: true, half: true },
        { key: 'deadline', label: 'Intake deadline', type: 'date', required: true, half: true },
        { key: 'portal', label: 'How to apply', type: 'select', options: ['Online portal (e.g. GCOS)', 'Email', 'Fillable PDF form', 'Other'], half: true },
        { key: 'program_objectives', label: 'Program objectives your project responds to', type: 'textarea', help: 'Quote the objectives from the guide. Assessors score how well you align.' },
      ],
    },
    {
      key: 'project', title: 'Project description',
      intro: 'Assessors look for a clear line from need → objectives → activities → results. Keep each answer specific to this project.',
      fields: [
        { key: 'project_title', label: 'Project title', type: 'text', required: true },
        { key: 'start_date', label: 'Start date', type: 'date', required: true, half: true },
        { key: 'end_date', label: 'End date', type: 'date', required: true, half: true },
        { key: 'locations', label: 'Communities served (and federal ridings, if asked)', type: 'text', required: true },
        { key: 'summary', label: 'Project summary', type: 'textarea', required: true, words: 250, draftable: true },
        { key: 'need', label: 'Need and rationale', type: 'textarea', required: true, words: 500, draftable: true, help: 'Evidence of the need in your community and how the project fits the program\'s objectives.' },
        { key: 'objectives', label: 'Project objectives', type: 'textarea', required: true, words: 300, draftable: true },
        { key: 'activities', label: 'Activities and work plan', type: 'textarea', required: true, words: 700, draftable: true, help: 'Main activities with timelines, who is responsible, and milestones.' },
        { key: 'participants', label: 'Participants and target population', type: 'textarea', words: 250, draftable: true, help: 'Who benefits and how many (direct and indirect).' },
        { key: 'results', label: 'Expected results', type: 'textarea', required: true, words: 400, draftable: true, help: 'Outputs (what you deliver) and outcomes (changes for people), with indicators and targets.' },
        { key: 'measurement', label: 'Performance measurement', type: 'textarea', words: 300, draftable: true, help: 'How you will collect data on each indicator and report it.' },
        { key: 'partners', label: 'Partners and their roles', type: 'textarea', words: 300, draftable: true },
      ],
    },
    {
      key: 'considerations', title: 'Inclusion & risk',
      intro: 'Federal programs commonly ask how the project considers diverse groups (GBA Plus), official language minority communities, accessibility, and risks.',
      fields: [
        { key: 'gba_plus', label: 'GBA Plus considerations', type: 'textarea', required: true, words: 300, draftable: true, help: 'How gender and other identity factors (age, disability, race, Indigeneity, income, location) shape who benefits and how you will reduce barriers.' },
        { key: 'official_languages', label: 'Official languages', type: 'textarea', words: 200, draftable: true, help: 'Whether services are offered in English and French, and any engagement with official language minority communities.' },
        { key: 'accessibility', label: 'Accessibility', type: 'textarea', words: 200, draftable: true },
        { key: 'risks', label: 'Risks and mitigation', type: 'textarea', words: 300, draftable: true },
        { key: 'sustainability', label: 'Sustainability after funding ends', type: 'textarea', words: 250, draftable: true },
      ],
    },
    {
      key: 'budget', title: 'Budget & other funding',
      intro: 'List eligible costs by category and fiscal year if the program asks. Most programs also require other sources of funding (cash and in-kind) and limit the total government share ("stacking").',
      fields: [
        { key: 'budget', label: 'Eligible costs by category', type: 'budget', required: true },
        { key: 'amount_requested', label: 'Amount requested from this program', type: 'money', required: true, half: true },
        { key: 'other_cash', label: 'Other funding: cash (confirmed and pending)', type: 'money', half: true },
        { key: 'other_inkind', label: 'Other funding: in-kind (at fair market value)', type: 'money', half: true },
        { key: 'other_government', label: 'Other government funding for this project', type: 'money', half: true },
        { key: 'other_sources', label: 'Sources of other funding', type: 'textarea', help: 'Name each funder, amount, cash or in-kind, and whether confirmed.' },
        { key: 'budget_notes', label: 'Budget notes and justification', type: 'textarea', required: true, words: 600, draftable: true },
      ],
    },
  ],
  budgetLines: [
    { key: 'salaries', label: 'Salaries and wages', help: 'Position × hours × hourly rate.' },
    { key: 'mercs', label: 'Mandatory employment-related costs (MERCs)', help: 'CPP/QPP, EI, vacation pay, workers\' compensation.' },
    { key: 'professional', label: 'Professional fees and contractors', help: 'Facilitators, evaluators, translators, consultants.' },
    { key: 'travel', label: 'Travel', help: 'Use federal travel rates if the program requires them.' },
    { key: 'materials', label: 'Materials and supplies', help: '' },
    { key: 'rent', label: 'Rent and utilities', help: 'Only the share used by the project.' },
    { key: 'equipment', label: 'Equipment', help: 'Purchase or rental; some programs cap capital costs.' },
    { key: 'communications', label: 'Communications, promotion and translation', help: '' },
    { key: 'admin', label: 'Administration', help: 'Many programs cap administration as a % of costs.' },
    { key: 'other', label: 'Other eligible costs', help: '' },
  ],
  attachments: [
    { key: 'incorporation', label: 'Articles of incorporation / letters patent', help: '' },
    { key: 'financials', label: 'Latest financial statements', help: 'Audited or review engagement, if required.' },
    { key: 'board', label: 'Board of directors list', help: '' },
    { key: 'letters', label: 'Letters of support from partners', help: 'Confirming roles and any cash or in-kind contributions.' },
    { key: 'budget_form', label: 'Program budget template', help: 'Many departments provide their own spreadsheet.' },
    { key: 'workplan', label: 'Work plan / logic model', help: '' },
    { key: 'attestation', label: 'Signed attestation or signature page', help: 'Signed by authorized signing officer(s).' },
  ],
  resources: [
    { label: 'ESDC funding programs finder', url: 'https://www.canada.ca/en/employment-social-development/services/funding/programs.html' },
    { label: 'Canadian Heritage funding', url: 'https://www.canada.ca/en/canadian-heritage/services/funding.html' },
    { label: 'Search federal grants and contributions awarded', url: 'https://search.open.canada.ca/grants/' },
  ],
};

export const GRANT_TEMPLATES: Record<'US' | 'CA', GrantTemplate> = { US, CA };

/** Share of required fields completed, per section and overall. */
export function applicationProgress(t: GrantTemplate, data: Record<string, any>) {
  const filled = (f: TemplateField) => {
    const v = data?.[f.key];
    if (f.type === 'checkbox') return v === true;
    if (f.type === 'budget') return Boolean(v && Object.values(v).some((x: any) => Number(x?.amount) > 0));
    return v !== undefined && v !== null && String(v).trim() !== '';
  };
  const sections = t.sections.map((s) => {
    const req = s.fields.filter((f) => f.required);
    const done = req.filter(filled).length;
    return { key: s.key, done, total: req.length };
  });
  const done = sections.reduce((a, s) => a + s.done, 0), total = sections.reduce((a, s) => a + s.total, 0);
  return { sections, done, total, percent: total ? Math.round((done / total) * 100) : 0 };
}
