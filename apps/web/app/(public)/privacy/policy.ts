/**
 * The privacy policy, as data: App Store Connect wants a public URL for it,
 * and App Review reads it against the app's permission strings (app.json in
 * bitcrm-mobile) and privacy labels. Keep the three in step — the page test
 * checks the promises about location, photos and card data.
 *
 * Written for a technician or a customer reading on a phone, not for a lawyer:
 * short sections, each saying what is taken, why, and who else sees it.
 */

export const COMPANY_LEGAL_NAME = "Sure Lock & Key LLC";

/** The mailbox that answers privacy requests (owner, 2026-10-14). */
export const PRIVACY_CONTACT_EMAIL = "system@surelockkey.com";

export const EFFECTIVE_DATE = "October 14, 2026";

/** A paragraph, or a bulleted list. */
export type Block = string | string[];

export interface PolicySection {
  heading: string;
  body: Block[];
}

export const INTRO = `${COMPANY_LEGAL_NAME} ("we", "us") is a locksmith and security services company in Connecticut, USA. We run BitCRM, the field-service platform our office and technicians use to schedule jobs, keep customer records, send estimates and invoices, and take payments: the web app, the client portal, and the BitCRM app for iPhone and Android. This policy explains what information the platform collects, how we use it, and who else sees it. It covers the people who sign in to BitCRM (our staff and contractors) and the customers whose jobs they handle.`;

export const SECTIONS: PolicySection[] = [
  {
    heading: "Who BitCRM is for",
    body: [
      "BitCRM is a work tool. Accounts are created by our office for employees and subcontractors; there is no public sign-up, and the app does nothing until someone signs in with a work account. Customers do not install the app. They receive estimates, invoices and receipts from us by text message or e-mail, and can view and pay them in the client portal.",
    ],
  },
  {
    heading: "Information in your account",
    body: [
      "When our office creates your account we record your name, work e-mail address, phone number and role. Sign-in is handled by Amazon Cognito; we never see your password in plain text. The app keeps your sign-in tokens in the phone's secure storage (iOS Keychain or Android Keystore) so you stay signed in, and removes them when you sign out.",
    ],
  },
  {
    heading: "Information about jobs and customers",
    body: [
      "The core of BitCRM is the job record: the customer's name, phone numbers and e-mail, the service and billing addresses, what was asked for and done, notes, photos, estimates, invoices and payments. Our office and technicians enter this information in the course of the work. It belongs to the company's business records, and the app shows a technician the jobs assigned to them.",
      "Customers' information comes from the customers themselves when they book a job, by phone, text, e-mail or through our website.",
    ],
  },
  {
    heading: "Location",
    body: [
      "The app asks for your location in two moments only:",
      [
        "When you tap Arrived on a job. One position fix is sent with the arrival, so dispatch can see you reached the job. If the phone gives no fix within eight seconds, the arrival is recorded without coordinates.",
        "While you take a card with Tap to Pay. Apple and Stripe require the phone's location to accept a contactless payment.",
      ],
      "Location is used while the app is open and never tracked in the background. The app keeps no location history. You can decline the permission in your phone's settings: Arrived still works, Tap to Pay does not.",
    ],
  },
  {
    heading: "Camera and photos",
    body: [
      "You can attach photos of the work to a job, taken with the camera or chosen from photos you already have. The app reads only the photos you pick. Photos are uploaded to the job record in our cloud storage (Amazon Web Services, United States) and stay with the job. Nothing else on your camera roll is read or uploaded.",
    ],
  },
  {
    heading: "Payments",
    body: [
      "Card payments are processed by Stripe, Inc. When a card is typed in, the number goes from Stripe's own form on the phone straight to Stripe; we receive a token and the result. With Tap to Pay on iPhone, the card is read by the iPhone's secure hardware and processed by Stripe. We never see or store full card numbers, PINs or security codes.",
      "What we keep for each payment: the amount, the date, the card brand and its last four digits, the outcome, and the e-mail address or phone number a receipt was sent to. Stripe's processing is governed by Stripe's privacy policy (stripe.com/privacy); Tap to Pay on iPhone is subject to Apple's terms.",
    ],
  },
  {
    heading: "Device information and diagnostics",
    body: [
      "The app reads the phone's model and operating system version to decide what it can offer (for example, whether the phone can take Tap to Pay). Our servers log requests with the IP address, time and app version, for security and troubleshooting. The app has no advertising identifiers, no analytics or tracking software, and shows no ads.",
    ],
  },
  {
    heading: "How we use information",
    body: [
      "To schedule, dispatch and complete jobs; to reach customers about their jobs by call, text message and e-mail; to prepare estimates and invoices, take payments and send receipts; to keep the business records the law requires (tax, accounting); and to keep the service secure.",
    ],
  },
  {
    heading: "Who we share it with",
    body: [
      "We do not sell personal information, and we do not share it for advertising. Information is shared only with the providers that run the platform, each for its own job:",
      [
        "Amazon Web Services: hosting, databases, file storage, sign-in (Cognito) and e-mail delivery.",
        "Stripe: card payments, Tap to Pay, receipts and payouts.",
        "Apple: Tap to Pay on iPhone and the App Store; Google: the Play Store and the maps and address lookup in the web app.",
        "Twilio: the phone calls and text messages the office and technicians send from the platform.",
      ],
      "We may also disclose information when the law requires it, to protect our rights or safety, or as part of a sale or merger of the business, in which case this policy continues to apply to it.",
    ],
  },
  {
    heading: "How long we keep it",
    body: [
      "Job, invoice and payment records are kept as long as the business needs them and the law requires (typically seven years for financial records). A staff account is deactivated when the person leaves, and its personal details are removed after that. Customers can ask us to delete their information; we will do so unless a record must be kept by law.",
    ],
  },
  {
    heading: "Security",
    body: [
      "Data travels over TLS and is encrypted at rest. Access is by role: a technician sees their own jobs, the office sees the company's. Sign-in runs through Amazon Cognito with password rules the office sets, and the app stores its tokens in the phone's secure storage. No method is perfect, but these are the measures in place.",
    ],
  },
  {
    heading: "Your choices and rights",
    body: [
      "You control the location, camera and photo permissions in your phone's settings, and can sign out at any time. Staff members' accounts are managed by their employer. Anyone, staff or customer, can ask what information we hold about them and have it corrected or deleted by writing to the address below. Residents of California and other states with privacy laws have the rights those laws give them, including the right not to be discriminated against for exercising them; we do not sell personal information, so there is nothing to opt out of.",
    ],
  },
  {
    heading: "Children",
    body: [
      "BitCRM is a tool for working adults and is not directed to anyone under 18. We do not knowingly collect information from children.",
    ],
  },
  {
    heading: "Changes to this policy",
    body: [
      "When this policy changes we publish the new version here with a new effective date. A change that matters to how your information is used is announced in the app or by e-mail before it takes effect.",
    ],
  },
];
