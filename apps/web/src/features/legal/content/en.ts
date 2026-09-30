import type { LegalContent } from "./types";

/**
 * Terms of Use · Privacy Notice (English) — **draft; must be reviewed by a Thai lawyer before production**
 * Internal users only (staff, managers, accounting, administrators) · shop facts live in legal-config.ts
 */
export default {
  terms: {
    title: "Terms of Use",
    subtitle:
      "For users of the counter buy-in and membership system of {{companyName}} · version {{version}} · effective {{effectiveDate}}",
    sections: [
      {
        heading: "1. Scope and acceptance",
        body: [
          "These Terms govern the use of the counter buy-in and membership system (the “System”) of {{companyName}} (the “Company”). The System is an internal tool for employees and other persons authorised by the Company only; it is not available to customers or the public.",
          "By signing in you confirm that you have read, understood and accept these Terms, the Privacy Notice and the Company's related policies and instructions. If you do not accept them, do not use the System and inform your supervisor.",
        ],
      },
      {
        heading: "2. Purpose and authorised use",
        body: [
          "You may use the System only to perform the duties assigned to you by the Company — such as recording purchases, managing customer records, issuing and printing purchase receipts, setting gold prices and preparing reports — and only within the role and branches you have been granted.",
          "You must not use the System for personal purposes or for the benefit of anyone else, or access information unrelated to your assigned work, even where the System technically allows you to see it.",
        ],
      },
      {
        heading: "3. Accounts and passwords",
        body: [
          {
            list: [
              "Your account is personal to you. Do not lend it, share it, or sign in on behalf of anyone else.",
              "Keep your password confidential; do not write it where others can see it or send it over insecure channels.",
              "Always sign out when you finish, especially on shared counter devices.",
              "If you suspect that your password has been disclosed or your account used by someone else, tell the administrator immediately so the account can be suspended and the password reset.",
              "You are responsible for all actions carried out under your account unless you can show they were not caused by your own fault.",
            ],
          },
        ],
      },
      {
        heading: "4. Confidentiality of customer data",
        body: [
          "The System contains customers' personal data — including national ID numbers, photographs, copies of ID cards, addresses, phone numbers and transaction history — which is protected by the Personal Data Protection Act B.E. 2562 (2019). You must:",
          {
            list: [
              "access and use customer data only as needed to serve that customer;",
              "not copy, screenshot, photograph, print, download or export data outside the System, except through the System's own features and as your work requires (for example, printing a receipt for the customer or sending reports to accounting);",
              "not disclose data to anyone without a right to it, including colleagues who are not involved;",
              "keep printed documents from the System secure and destroy them in line with Company rules when no longer needed.",
            ],
          },
          "This duty of confidentiality continues after your employment or access rights end.",
        ],
      },
      {
        heading: "5. Prohibited conduct",
        body: [
          {
            list: [
              "attempting to access data, branches or functions you are not authorised for, or circumventing the System's security measures;",
              "entering false data or fictitious bills, or altering data to conceal facts;",
              "using bots, scripts or scraping tools against the System without written permission;",
              "uploading files containing malicious code or doing anything that disrupts the System;",
              "any act contrary to law, including the Computer-Related Crime Act B.E. 2550 (2007) and personal data protection law.",
            ],
          },
        ],
      },
      {
        heading: "6. Monitoring and audit logging",
        body: [
          "For security, fraud prevention and legal compliance, the System keeps audit logs of activity such as sign-ins; creating, editing or voiding bills; editing customer records; setting gold prices; opening ID card copies; and downloading files — together with the time, user account, branch and related network information.",
          "The Company may review these logs where necessary and proportionate, as described in the Privacy Notice, and may use them as evidence in investigations and in disciplinary or legal proceedings.",
        ],
      },
      {
        heading: "7. Accuracy of entries",
        body: [
          "Purchase receipts and reports from the System are accounting and tax records. Check customer details, items, weights, prices and payments before saving. If you find an error after saving, correct it through the System's own procedure (for example, voiding the bill with a reason) and inform your supervisor. Never alter documents outside the System.",
        ],
      },
      {
        heading: "8. Incident reporting",
        body: [
          "Promptly report to the administrator or your supervisor any actual or suspected security incident or personal data breach — such as unauthorised use of an account, a lost device, lost customer documents or abnormal System behaviour — so that the Company can assess it and notify the relevant authorities within the time required by law.",
        ],
      },
      {
        heading: "9. Suspension and termination",
        body: [
          "The Company may suspend, restrict or revoke access immediately when employment ends, duties change, there is reasonable suspicion of a breach of these Terms, or for the security of the System. Breaches may lead to disciplinary action under Company rules and to legal action.",
        ],
      },
      {
        heading: "10. Intellectual property and ownership",
        body: [
          "The System, its software, documents and all data in it belong to the Company or its licensors. Using the System under these Terms does not transfer any rights to you.",
        ],
      },
      {
        heading: "11. Limitation of liability",
        body: [
          "The System is an internal tool provided as is. The Company will take reasonable care to keep it available but does not guarantee uninterrupted or error-free operation. When the System is unavailable, follow the Company's fallback procedure. Nothing in these Terms excludes any right or liability that cannot be excluded by law.",
        ],
      },
      {
        heading: "12. Changes to these Terms",
        body: [
          "The Company may update these Terms from time to time and will publish new versions on the sign-in page or through internal channels. Continued use of the System after a new version is published means you accept it.",
        ],
      },
      {
        heading: "13. Governing law and contact",
        body: [
          "These Terms are governed by the laws of Thailand. If the Thai and English versions conflict, the Thai version prevails.",
          "Questions about these Terms: {{companyName}} · {{registeredAddress}} · email {{privacyEmail}} · phone {{privacyPhone}}",
        ],
      },
    ],
  },
  privacy: {
    title: "Privacy Notice",
    subtitle:
      "For personal data of System users, under the Personal Data Protection Act B.E. 2562 (2019) · version {{version}} · effective {{effectiveDate}}",
    sections: [
      {
        heading: "1. Data controller",
        body: [
          "{{companyName}}, tax ID {{taxId}}, with its head office at {{registeredAddress}} (the “Company”), is the data controller for the processing described in this Notice.",
          "This Notice explains how the Company collects, uses and discloses personal data of users of the counter buy-in and membership system — staff, managers, accounting and administrators. Personal data of customers that users record in the System is covered by a separate customer privacy notice.",
        ],
      },
      {
        heading: "2. Personal data we collect",
        body: [
          {
            list: [
              "Account data: name, email, role, main and permitted branches, account status (passwords are stored only as one-way hashes; the Company cannot read them).",
              "Sign-in and session data: sign-in and sign-out times, session identifiers, IP address and browser or device information (user agent).",
              "Audit trail: actions in the System such as creating, editing or voiding bills, editing customer records, setting gold prices, opening ID card copies and downloading files, with time and branch.",
              "Data shown on documents the System issues, such as the name of the person who recorded a receipt or report.",
              "Device preferences: the theme and language you choose (stored in that device's browser).",
            ],
          },
        ],
      },
      {
        heading: "3. Sources",
        body: [
          "We receive this data from the administrator or HR staff who create your account, from you directly, and automatically from your use of the System.",
        ],
      },
      {
        heading: "4. Purposes and lawful bases",
        body: [
          {
            list: [
              "To create and manage your account, authenticate you, grant access by role and branch, and enable you to do your work — contractual basis (employment or engagement), section 24(3).",
              "To secure the System, prevent and detect fraud or misuse, investigate incidents and verify transactions — the Company's legitimate interests, section 24(5), which the Company has assessed as proportionate to your rights.",
              "To prepare and retain accounting and tax records and comply with orders of competent authorities — legal obligation, section 24(6), e.g. the Revenue Code and the Accounting Act B.E. 2543 (2000).",
              "To establish, exercise or defend legal claims.",
            ],
          },
          "The Company does not use your data for marketing and does not make automated decisions that produce legal effects concerning you.",
        ],
      },
      {
        heading: "5. Cookies and browser storage",
        body: [
          "The System uses a strictly necessary session cookie to keep you securely signed in. It is HttpOnly and expires when you sign out or the session times out. Your theme and language preferences are kept in the browser's local storage on the device you use. No advertising or cross-site tracking cookies are used, so no consent is required for these.",
        ],
      },
      {
        heading: "6. Recipients and processors",
        body: [
          {
            list: [
              "Your supervisors, administrators and the Company's accounting staff, as their duties require.",
              "The cloud infrastructure provider that hosts the System's servers, database and file storage (Railway), as a data processor under contract.",
              "The PDF rendering service that runs inside the Company's own System and does not send data to third parties.",
              "Government agencies, courts or officials with legal authority, where disclosure is required by law.",
              "The Company's auditors, legal counsel and professional advisers, under duties of confidentiality.",
            ],
          },
        ],
      },
      {
        heading: "7. Cross-border transfer",
        body: [
          "The System runs in the cloud provider's data centre in the Singapore region, so personal data is stored and processed outside Thailand. The Company complies with sections 28 and 29 of the Personal Data Protection Act B.E. 2562 (2019) by applying appropriate safeguards, such as data processing terms with the provider, encryption in transit and access controls. Singapore has its own data protection law (the Personal Data Protection Act 2012). You may request details of these safeguards through the contact in section 12.",
        ],
      },
      {
        heading: "8. Retention",
        body: [
          "The Company keeps data only as long as necessary for the purposes above and as required by law, on these principles (exact periods to be confirmed by the Company and its legal counsel):",
          {
            list: [
              "Account data: while your access is active and, after the account is closed, for as long as needed for audit purposes [exact period — to be confirmed].",
              "Audit and sign-in logs: [exact period — to be confirmed], or longer where relevant to an investigation or dispute.",
              "Purchase receipts, reports and other accounting or tax records that include the recording user's name: at least 5 years under the Revenue Code and the Accounting Act B.E. 2543 (2000), or longer if ordered by an authority [exact period — to be confirmed].",
              "Session cookie: until sign-out or session expiry · theme and language preferences: until you clear your browser data.",
            ],
          },
          "After these periods, the Company deletes, destroys or anonymises the data.",
        ],
      },
      {
        heading: "9. Security",
        body: [
          "The Company applies appropriate organisational and technical measures, including encryption in transit (HTTPS), one-way hashed passwords, HttpOnly session cookies, role- and branch-based access control, no public links to files, logging of file access and backups, and reviews these measures periodically.",
        ],
      },
      {
        heading: "10. Your rights",
        body: [
          "Subject to the conditions set by law, you have the right to:",
          {
            list: [
              "access and obtain a copy of your data, and ask how data you did not consent to was obtained;",
              "have your data corrected, kept up to date and completed;",
              "have your data erased, destroyed or anonymised;",
              "restrict the use of your data;",
              "object to processing based on legitimate interests;",
              "receive your data, or have it transferred, in a machine-readable format;",
              "withdraw consent where processing relies on consent (without affecting processing carried out before withdrawal);",
              "lodge a complaint with the Office of the Personal Data Protection Committee (PDPC) if you believe the Company has not complied with the law.",
            ],
          },
          "The Company may refuse a request where the law allows — for example, where accounting and tax records must be retained — and will tell you why. The Company will act on a complete request within 30 days of receiving it.",
        ],
      },
      {
        heading: "11. Consequences of not providing data",
        body: [
          "Account data and audit logs are necessary to give you access to the System. If you do not provide this data or ask for its use to be restricted, the Company may be unable to grant you access.",
        ],
      },
      {
        heading: "12. Contact and data protection officer",
        body: [
          "To contact the Company about personal data or to exercise your rights: {{companyName}} · {{registeredAddress}} · email {{privacyEmail}} · phone {{privacyPhone}}",
        ],
      },
      {
        heading: "13. Changes to this Notice",
        body: [
          "The Company may update this Notice from time to time and will publish new versions, with their version number and effective date, on the sign-in page or through internal channels. If the Thai and English versions conflict, the Thai version prevails.",
        ],
      },
    ],
  },
} satisfies LegalContent;
