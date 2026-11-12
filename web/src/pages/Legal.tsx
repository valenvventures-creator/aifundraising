/**
 * Public legal pages: End-User License Agreement (/terms) and Privacy Policy (/privacy).
 * The operator's legal name, contact email, address and governing law come from environment variables
 * (LEGAL_COMPANY_NAME, LEGAL_CONTACT_EMAIL, LEGAL_ADDRESS, LEGAL_GOVERNING_LAW, LEGAL_EFFECTIVE_DATE) via /api/public/legal.
 */
import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../lib/api';
import { BrandLockup } from '../components/Brand';

type Legal = { company: string | null; email: string | null; address: string | null; governingLaw: string | null; effectiveDate: string; ai: boolean };

function useLegal(): Legal {
  const { data } = useApi<Legal>('/public/legal');
  return data ?? { company: null, email: null, address: null, governingLaw: null, effectiveDate: 'November 12, 2026', ai: true };
}
const operator = (l: Legal) => l.company || 'the operator of A.I. Fundraising';
const Contact = ({ l }: { l: Legal }) => (l.email
  ? <a className="font-medium text-brand-700 underline" href={`mailto:${l.email}`}>{l.email}</a>
  : <span>the contact details provided on our website</span>);

function Page({ title, intro, sections, l }: { title: string; intro: React.ReactNode; sections: [string, string, React.ReactNode][]; l: Legal }) {
  useEffect(() => { const t = document.title; document.title = `${title} · A.I. Fundraising`; window.scrollTo(0, 0); return () => { document.title = t; }; }, [title]);
  return (
    <div className="min-h-screen bg-white text-slate-800">
      <header className="border-b border-slate-100">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Link to="/" aria-label="A.I. Fundraising home"><BrandLockup size="sm" /></Link>
          <nav className="flex gap-4 text-sm text-slate-600"><Link to="/terms" className="hover:text-slate-900">Terms</Link><Link to="/privacy" className="hover:text-slate-900">Privacy</Link><Link to="/login" className="hover:text-slate-900">Sign in</Link></nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:grid lg:grid-cols-[220px_1fr] lg:gap-12">
        <aside className="mb-8 lg:mb-0">
          <nav className="lg:sticky lg:top-6" aria-label="On this page">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">On this page</div>
            <ol className="space-y-1.5 text-sm">{sections.map(([id, h], i) => <li key={id}><a href={`#${id}`} className="text-slate-600 hover:text-brand-700">{i + 1}. {h}</a></li>)}</ol>
          </nav>
        </aside>
        <article className="min-w-0">
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">{title}</h1>
          <p className="mt-2 text-sm text-slate-500">Effective {l.effectiveDate}</p>
          <div className="mt-6 space-y-4 text-[15px] leading-7 text-slate-700">{intro}</div>
          {sections.map(([id, h, body], i) => (
            <section key={id} id={id} className="scroll-mt-6 border-t border-slate-100 pt-6 mt-8">
              <h2 className="text-lg font-semibold text-slate-900">{i + 1}. {h}</h2>
              <div className="mt-3 space-y-3 text-[15px] leading-7 text-slate-700 [&_li]:ml-5 [&_li]:list-disc [&_li]:pl-1 [&_ul]:space-y-1.5">{body}</div>
            </section>
          ))}
          <footer className="mt-12 border-t border-slate-100 pt-6 text-sm text-slate-500">
            {l.company && <div className="font-medium text-slate-700">{l.company}</div>}
            {l.address && <div>{l.address}</div>}
            <div>Questions: <Contact l={l} /></div>
          </footer>
        </article>
      </main>
    </div>
  );
}

// ───────────────────────── End-User License Agreement ─────────────────────────
export function TermsPage() {
  const l = useLegal(); const op = operator(l);
  const sections: [string, string, React.ReactNode][] = [
    ['acceptance', 'Acceptance of this agreement', <>
      <p>This End-User License Agreement (the “Agreement”) is between you and {op} (“we”, “us”). It governs your use of A.I. Fundraising, including the website, web application and related services (the “Service”).</p>
      <p>By creating an account, signing in, or using the Service, you agree to this Agreement. If you use the Service for an organization, you confirm that you are authorized to accept this Agreement for that organization, and “you” includes the organization.</p>
    </>],
    ['license', 'License', <>
      <p>Subject to this Agreement, we grant you a limited, non-exclusive, non-transferable, revocable license to access and use the Service for your organization’s internal fundraising, accounting, grants, programs and operations.</p>
      <p>You may invite team members to use the Service under your account. You are responsible for their use and for the roles and permissions you give them.</p>
    </>],
    ['restrictions', 'Restrictions', <>
      <p>You agree not to:</p>
      <ul>
        <li>copy, modify, resell, sublicense or create derivative works of the Service, except as allowed by law;</li>
        <li>reverse engineer or attempt to access the Service’s source code, except where the law expressly permits it;</li>
        <li>access another organization’s data, test the Service’s security without our written permission, or interfere with its operation;</li>
        <li>upload malicious code or content you do not have the right to use;</li>
        <li>use the Service to send spam, or to contact people in a way that breaks anti-spam or privacy laws; or</li>
        <li>use the Service for any unlawful purpose.</li>
      </ul>
    </>],
    ['accounts', 'Accounts and security', <>
      <p>You must give accurate information when you register and keep your password confidential. Tell us promptly if you believe your account has been accessed without permission. We may suspend access to protect the Service or other customers.</p>
    </>],
    ['data', 'Your data', <>
      <p>You keep all rights to the information you put into the Service, such as donor, gift, financial, grant and program records (“Customer Data”). You give us permission to host, process and transmit Customer Data only as needed to provide the Service to you, as described in our <Link to="/privacy" className="font-medium text-brand-700 underline">Privacy Policy</Link>.</p>
      <p>You are responsible for having the right to collect and use the Customer Data you put into the Service, including obtaining any consents required from donors and other individuals. You can export your data at any time using the Service’s export tools.</p>
    </>],
    ['ai', 'A.I. features', <>
      <p>The Service includes optional A.I. features that read your data to answer questions, explain numbers, make recommendations and write drafts. A.I. features only suggest; they do not send messages, post accounting entries, move money, change records or invite users. A person in your organization decides whether to use any suggestion.</p>
      <p>A.I. output can be wrong or incomplete. You are responsible for reviewing it before relying on it or sharing it, including checking facts, figures and anything sent to donors, funders or government agencies.</p>
    </>],
    ['third-party', 'Third-party services', <>
      <p>You may connect the Service to third-party services such as QuickBooks Online (Intuit), Stripe, Square, PayPal, Google and Plaid. Your use of those services is governed by their own terms. When you connect a service, you authorize us to exchange data with it on your behalf to provide the feature you turned on (for example, sending posted accounting entries to QuickBooks or receiving gift payments from Stripe). You can disconnect a service at any time.</p>
      <p>Payments are processed by your payment providers. The Service does not store full card numbers.</p>
      <p>Grant search results come from public government sources such as Grants.gov and the Government of Canada. We do not guarantee their accuracy or availability. Always confirm eligibility and deadlines with the funder.</p>
    </>],
    ['financial', 'Not professional advice', <>
      <p>The Service helps you keep records and prepare reports, receipts and applications. It does not provide legal, tax, accounting or investment advice. You are responsible for your organization’s books, tax receipts, filings and compliance. Consult a qualified professional where needed.</p>
    </>],
    ['fees', 'Fees', <>
      <p>Any fees for the Service will be as agreed with you or shown when you subscribe. If we introduce or change fees, we will tell you in advance, and you may stop using the Service before the change takes effect.</p>
    </>],
    ['ip', 'Our property', <>
      <p>The Service, including its software, design, logos and content (other than Customer Data), belongs to us or our licensors and is protected by law. This Agreement does not give you any ownership rights. If you send us feedback, we may use it without obligation to you.</p>
    </>],
    ['termination', 'Suspension and termination', <>
      <p>You may stop using the Service and close your account at any time. We may suspend or end your access if you materially breach this Agreement, if required by law, or to protect the Service or others. Where reasonable, we will give notice first.</p>
      <p>After termination, you may request an export of your Customer Data for 30 days. After that, we may delete it, except where we must keep it by law.</p>
    </>],
    ['warranty', 'Disclaimer of warranties', <>
      <p>The Service is provided “as is” and “as available”. To the fullest extent permitted by law, we disclaim all warranties, whether express or implied, including merchantability, fitness for a particular purpose and non-infringement. We do not promise that the Service will be uninterrupted or error-free.</p>
    </>],
    ['liability', 'Limitation of liability', <>
      <p>To the fullest extent permitted by law, we will not be liable for indirect, incidental, special, consequential or punitive damages, or for lost profits, revenue, donations or data, arising from your use of the Service. Our total liability for any claim relating to the Service is limited to the amount you paid us for the Service in the 12 months before the claim (or 100 US dollars if you paid nothing).</p>
      <p>Some jurisdictions do not allow certain limitations, so some of these may not apply to you.</p>
    </>],
    ['indemnity', 'Your responsibility for claims', <>
      <p>You agree to defend and indemnify us against claims arising from your Customer Data, your use of the Service in breach of this Agreement or the law, or your communications with donors and others through the Service.</p>
    </>],
    ['changes', 'Changes to this agreement', <>
      <p>We may update this Agreement from time to time. We will post the new version on this page with a new effective date and, for material changes, notify account administrators. Continuing to use the Service after a change takes effect means you accept it.</p>
    </>],
    ['law', 'Governing law', <>
      <p>{l.governingLaw ? <>This Agreement is governed by the laws of {l.governingLaw}, without regard to conflict-of-law rules. The courts located there will have jurisdiction over any dispute, unless the law requires otherwise.</> : <>This Agreement is governed by the laws of the jurisdiction where {op} is established, without regard to conflict-of-law rules.</>}</p>
    </>],
    ['contact', 'Contact', <><p>Questions about this Agreement can be sent to <Contact l={l} />.</p></>],
  ];
  return <Page title="End-User License Agreement" l={l} sections={sections} intro={<p>Please read this agreement carefully. It explains the rules for using A.I. Fundraising and the responsibilities of both sides.</p>} />;
}

// ───────────────────────── Privacy Policy ─────────────────────────
export function PrivacyPage() {
  const l = useLegal();
  const sections: [string, string, React.ReactNode][] = [
    ['who', 'Who we are', <>
      <p>{l.company ? <>A.I. Fundraising (the “Service”) is operated by {l.company} (“we”, “us”).</> : <>A.I. Fundraising (the “Service”, “we”, “us”) is an online service.</>} The Service helps nonprofit organizations manage donors, giving, fund accounting, grants, programs, events, email and impact.</p>
      <p>Organizations that use the Service (“customers”) decide what information to put into it. For that information, the customer is responsible for its collection and use, and we process it on the customer’s behalf and according to their instructions.</p>
    </>],
    ['collect', 'Information we handle', <>
      <ul>
        <li><b>Account information:</b> names, email addresses and passwords (stored only as secure hashes) of people who use the Service, and their roles and access.</li>
        <li><b>Customer Data:</b> information organizations enter or import, such as donor contact details, gifts and pledges, receipts, notes, fund and accounting records, payroll entries, invoices, grants, tasks, events and registrations, impact results and uploaded files.</li>
        <li><b>Connected-service data:</b> when an organization connects QuickBooks Online, Stripe, Square, PayPal, Google or Plaid, the information exchanged with that service, such as payments, refunds, bank transactions, company and account details, and calendar or email-sending access.</li>
        <li><b>Usage and security records:</b> an activity history of sign-ins, exports, imports, accounting actions, access changes and A.I. drafts, including date, time, user and IP address.</li>
        <li><b>Email engagement:</b> if an organization sends email campaigns through the Service, whether messages were delivered, opened (estimated) or clicked, and unsubscribe requests.</li>
      </ul>
    </>],
    ['use', 'How we use information', <>
      <ul>
        <li>to provide, secure and support the Service, including the features each organization turns on;</li>
        <li>to calculate the reports, donor scores, priorities and summaries shown in the Service;</li>
        <li>to send service emails such as password resets, invitations, receipts and campaigns that an organization chooses to send;</li>
        <li>to prevent fraud and abuse, keep the activity history and meet legal obligations.</li>
      </ul>
      <p>We do not sell personal information, and we do not use Customer Data for advertising.</p>
    </>],
    ['quickbooks', 'QuickBooks and other connected services', <>
      <p>When an organization connects QuickBooks Online, we use the access Intuit grants only to provide the accounting sync the organization requested: reading company and account information, and sending the accounting entries the organization has posted in the Service. We do not use QuickBooks data for any other purpose, do not sell or share it, and do not combine it with other customers’ data.</p>
      <p>Connection credentials for QuickBooks and other services are encrypted (AES-256-GCM) and never shown in the browser. An organization can disconnect a service at any time from Integrations; doing so revokes our access. On request, we will delete data received from a connected service, subject to legal record-keeping requirements.</p>
      <p>Card payments are processed by Stripe, Square or PayPal. We never store full card numbers.</p>
    </>],
    ['ai', 'A.I. features', <>
      <p>{l.ai ? 'A.I. features are turned on for this Service.' : 'If A.I. features are turned on for this Service,'} When someone in an organization asks a question or requests a draft, the relevant records they are allowed to see are sent to our A.I. provider, Anthropic, to produce the answer or draft. Anthropic processes this information to provide the response under its commercial terms, which do not permit using it to train its models.</p>
      <p>A.I. features only read and suggest. They never send messages, change records, post accounting entries, move money or invite users.</p>
    </>],
    ['share', 'Who we share information with', <>
      <p>We share information only with service providers that help us run the Service, and only as needed:</p>
      <ul>
        <li><b>Netlify</b>: hosting, database and file storage;</li>
        <li><b>Anthropic</b>: A.I. answers and drafts (when turned on);</li>
        <li><b>Resend</b> or an organization’s own Gmail or email server: delivering email;</li>
        <li><b>Google Fonts</b>: website fonts, which means your browser requests font files from Google;</li>
        <li>the <b>connected services</b> each organization chooses (Intuit QuickBooks, Stripe, Square, PayPal, Google, Plaid);</li>
        <li>public grant sources (<b>Grants.gov</b>, <b>Government of Canada open data</b>), which receive only the search words, never organization data.</li>
      </ul>
      <p>We may also disclose information if required by law, to protect rights and safety, or as part of a merger or sale of the business, in which case this policy will continue to apply.</p>
    </>],
    ['security', 'How we protect information', <>
      <ul>
        <li>Each organization’s data is separated at the database level, so one organization cannot see another’s records.</li>
        <li>Access inside an organization is controlled by roles, permissions and workspace access set by its administrators.</li>
        <li>Connections use encrypted HTTPS. Passwords are stored as one-way hashes, and connection credentials are encrypted.</li>
        <li>Sign-in sessions use secure, http-only cookies, and important actions are recorded in an activity history.</li>
      </ul>
      <p>No system is perfectly secure. If we learn of a security incident affecting personal information, we will notify affected organizations as required by law.</p>
    </>],
    ['cookies', 'Cookies', <>
      <p>We use one essential cookie to keep you signed in. We do not use advertising or cross-site tracking cookies. Your browser may store small preferences, such as whether a panel is collapsed, on your own device.</p>
    </>],
    ['retention', 'How long we keep information', <>
      <p>We keep Customer Data for as long as the organization’s account is active. When an account is closed, the organization may request an export for 30 days, after which we delete it, except where the law requires us to keep records longer (for example, financial records). Copies in backups are removed as those backups expire.</p>
    </>],
    ['rights', 'Your choices and rights', <>
      <p>Depending on where you live, you may have the right to access, correct, delete or receive a copy of your personal information, or to object to certain uses. Donors and other people whose information an organization holds should contact that organization first, since it controls those records. Organizations can export, correct and delete their data in the Service.</p>
      <p>You can unsubscribe from campaign emails using the link in each message.</p>
    </>],
    ['location', 'Where information is stored', <>
      <p>Information may be stored and processed in the United States and other countries where our service providers operate. When information moves across borders, we rely on our providers’ safeguards and contractual protections.</p>
    </>],
    ['children', 'Children', <>
      <p>The Service is for organizations and is not directed to children under 16. We do not knowingly collect personal information from children through the Service.</p>
    </>],
    ['changes', 'Changes to this policy', <>
      <p>We may update this policy from time to time. We will post the new version on this page with a new effective date and, for material changes, notify account administrators.</p>
    </>],
    ['contact', 'Contact', <><p>For privacy questions or requests, contact <Contact l={l} />.</p></>],
  ];
  return <Page title="Privacy Policy" l={l} sections={sections} intro={<p>This policy explains what information A.I. Fundraising handles, how it is used and protected, and the choices available to you.</p>} />;
}
