/**
 * IETC's identity for this deployment (ietc-redesign). The school's name, logo, contact
 * details, accreditation and the landing page's wording live here and nowhere else, so
 * a component never spells out "International Energy Training Centre" itself.
 *
 * Course titles and the accreditation are IETC's own (PRODUCT.md, "Evidence on Hand").
 * Do not add pass rates, learner counts or testimonials: none exist yet.
 */
export const BRAND = {
  /** The name as one string, for page titles and alt text. */
  name: "International Energy Training Centre",
  /** The name as the logo lockup sets it, on two lines. */
  nameLines: ["International Energy", "Training Centre"] as const,
  shortName: "IETC",
  logo: { src: "/brand/ietc-icon.png", width: 300, height: 300 },
  contact: {
    address: "2 Energy Lane, Adeba Road, off Lekki-Epe Expressway, Lagos",
    phone: "0705 978 2762",
    phoneHref: "tel:+2347059782762",
    email: "info@iet-c.org",
  },
  footerBlurb:
    "Professional training in business and energy management, accredited by the American Council of Training and Development.",
  accreditation: {
    seal: { src: "/brand/actd-seal.png", width: 209, height: 209, alt: "ACTD seal" },
    title: "Accredited by ACTD",
    body: "American Council of Training and Development, New Jersey, USA",
    note: "Continuing education units approved by Mississippi State University",
  },
  poweredBy: "Learning platform by KQ Nexus",
} as const;

/**
 * IETC's third offer (iet-c.org/courses): auditing and certification for organisations on
 * behalf of BQSR USA. It is not a class, so it has no course page; it closes the course list.
 */
export const COMPANY_CERTIFICATION = {
  label: "For organisations",
  title: "IETC Company Certification",
  body: "IETC Certification represents BQSR USA Operations, providing organizations with professional auditing and management system certification services aligned with international standards.",
  detail:
    "This is not a class. IETC audits your organisation's management system and, where it conforms, issues certification against these standards:",
  standards: ["ISO 9001", "ISO 14001", "ISO 22000", "ISO 22301", "ISO 27001", "ISO 37001", "ISO 37301", "ISO 45001"],
  cta: "Ask about company certification",
} as const;

/** The landing page's wording. The hero ends on the highlighted word. */
export const LANDING = {
  heroLead: "Train as an ISO lead auditor, in class,",
  heroHighlight: "in Lagos.",
  heroBody:
    "IETC runs dated classes with experienced instructors and limited seats. Finish, and your certificate carries a reference any employer can verify.",
  steps: [
    {
      title: "Reserve your seat",
      body: "Pick a start date and pay by card or bank transfer. Your seat is held while you pay.",
    },
    {
      title: "Learn with your class",
      body: "Study the lessons online and join the scheduled sessions with your instructor.",
    },
    {
      title: "Show what you know",
      body: "Sit the quizzes and hand in your assignments. Results are released to you as they are marked.",
    },
    {
      title: "Earn your certificate",
      body: "Complete the course and download a certificate with its own verification reference.",
    },
  ],
  verifyTitle: "Checking someone's certificate?",
  verifyBody: "Enter the reference printed on it to see who it was issued to, for which course, and when.",
} as const;
