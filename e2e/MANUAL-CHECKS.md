# Manual checks for launch (Phase 15, plan 15-20)

These are the checks no tool can do for us: a real screen reader, a real Safari, a person using only the keyboard, the licence screens from Phase 14, and a person who has never seen the product. The automated checks that sit beside them (axe in `e2e/a11y-screens.spec.ts`, the viewport sweep in `e2e/responsive.spec.ts`, the keyboard run in `e2e/keyboard.spec.ts`) are listed in each section so the tester knows what is already proved and what is not.

**Where the results go.** Fill in the results tables below as you go (or copy them into a separate file per tester). Plan 15-31 copies the filled tables into `15-LAUNCH-REPORT.md`. A step that fails is written up in the Notes column with the screen address, what happened and what you expected, and is raised as a finding in the launch report. A failure on a critical security, payment, authorisation or private-file step is never waived (D-07).

**How to read a step.** Each step has a number, what to do and the result you should see. Mark each step pass or fail in the results table. If a step cannot be done (the screen does not exist yet, the device is missing), write "not done" and say why. Do not leave it blank.

**Results table columns (the same in every section):** Step, Tester, Device, Operating system and version, Browser and version, Assistive technology and version, Date, Pass or fail, Notes.

**Before you start (all sections).**

1. Use a build that matches what will go live: the staging deploy preview for the Safari, iPhone and unassisted journey sections, or a local production build (`npm run build`, then `npm run start`) against a local database for the other sections. Never point a local build at the shared database.
2. On a local build, the verification and password reset emails are not sent anywhere. Start the local capture server (`npx tsx e2e/support/email-capture-server.ts`) and read the emails at its inbox page (`http://localhost:4010/inbox`).
3. Sign in with the seeded development accounts for the staff steps. The learner account is any account you register yourself, or the seeded learner. The development password is in `prisma/seed.ts`; it must not exist in production.
4. Write down the exact versions as you start: operating system, browser, screen reader. The versions are part of the result.

---

## Screen reader pass

**Purpose.** WCAG 2.2 AA (NFR-09) needs a real screen reader pass. axe proves the rules it can check; it cannot tell you whether the page makes sense when read aloud.

**Set-up.**

- Desktop: NVDA (free, Windows) with Firefox or Chrome. Browse mode for reading, Tab for controls. Turn on speech viewer (NVDA menu, Tools, Speech viewer) so you can copy what was announced.
- Mobile: VoiceOver on iPhone with Safari. Swipe right and left to move, double-tap to activate, rotor for headings, landmarks and form controls.
- Run the numbered steps once on each device. Record the tester, device and versions on every row.

| Step | What to do | Expected result |
| --- | --- | --- |
| SR-01 | Open the home page and the course catalogue. Open the landmarks list (NVDA: D key, or the elements list; VoiceOver: rotor, Landmarks). | One banner, one main, navigation and a footer are listed and named. "Skip to main content" is the first link and moves reading to the main area. |
| SR-02 | List the headings (NVDA: H key or the elements list; VoiceOver: rotor, Headings) on the catalogue, a course page, the learner dashboard and a staff list page. | Exactly one level-one heading that names the page, and sensible sub-headings in order, with no level skipped. |
| SR-03 | Go to the sign-in page. Tab through the form. | Each field is announced with its visible label ("Email address", "Password"); the "Show password" or similar control says whether the password is shown; the button says "Sign in". |
| SR-04 | Submit the sign-in form with a wrong password. | The error is announced straight away without you moving ("Those details do not match an account..."), focus is on the message, and the typed email address is still in the field. |
| SR-05 | Open the register page and submit it empty, then with a short password. | The error summary or field errors are announced, each field with an error says so (invalid), and the terms and privacy checkboxes are announced with their full labels. |
| SR-06 | Repeat the sign-in failure until the rate-limit message appears (or use a test address already limited). | The "Too many sign-in attempts" message is announced as an alert and reads fully with no truncated text. |
| SR-07 | Staff: open a list with row actions (for example the enrolments list) and open a row's actions menu with the keyboard. | The button announces as a menu button that is collapsed or expanded; the menu announces its items; arrow keys move between items; Escape closes the menu and focus returns to the button. |
| SR-08 | Staff: choose an action that opens the confirmation dialog (for example an action that asks for a reason). | The dialog is announced with its title and description, the reason field has its label and the character counter is read, the confirm button says why it is disabled while the reason is too short, Escape cancels, and focus returns to the control that opened it. |
| SR-09 | Perform an action that shows a notification (a toast). | The notification is announced without moving focus, once, and it does not steal focus. |
| SR-10 | Open a data table (payments, enrolments, the roster, the results table). Move through it with the table commands (NVDA: Ctrl+Alt+arrows; VoiceOver: rotor, Tables). | Column headers are announced with each cell, row actions are reachable and named for their row ("Actions for ..."), a table that scrolls sideways is announced as a labelled region. |
| SR-11 | Open a lesson that has a video. Use the player controls. | Play, pause, volume, captions and full screen each have a name and announce their state. If captions are built for the lesson, the captions control is present and the caption text is available; if not, write "no captions on this lesson" (this is the known accessible-media gap and is recorded as a waiver or a finding in the launch report). |
| SR-12 | Open a text lesson, then a quiz or assignment lesson. Answer a quiz question and submit; submit an assignment with a file. | Question text and choices are announced as one group with the question as the group name; the submit result ("Submitted", score) is announced; the file field says which file was chosen. |
| SR-13 | Open the certificate check page. Check a valid reference, an invalid reference and (if you can) trigger the rate-limit. | The result (valid, not found, revoked, too many checks) is announced without you moving; the details (name, course, date) read in a sensible order. |
| SR-14 | Staff: open the operations status page and the privacy lookup. | The status headings and the "All clear" or "Needs attention" state are read as text, not only as colour; the lookup field and its button are labelled; the anonymise confirmation describes what will happen and which account it applies to. |
| SR-15 | On iPhone with VoiceOver: repeat SR-03, SR-04, SR-07 (the three-dots menu), SR-08 and SR-12 on the staff and learner screens. | Everything above works with swipe navigation and double-tap; nothing is only reachable by a gesture you cannot make with VoiceOver; the menu and dialog trap and return focus correctly. |

**Results**

| Step | Tester | Device | Operating system and version | Browser and version | Assistive technology and version | Date | Pass or fail | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| SR-01 | | | | | | | | |
| SR-02 | | | | | | | | |
| SR-03 | | | | | | | | |
| SR-04 | | | | | | | | |
| SR-05 | | | | | | | | |
| SR-06 | | | | | | | | |
| SR-07 | | | | | | | | |
| SR-08 | | | | | | | | |
| SR-09 | | | | | | | | |
| SR-10 | | | | | | | | |
| SR-11 | | | | | | | | |
| SR-12 | | | | | | | | |
| SR-13 | | | | | | | | |
| SR-14 | | | | | | | | |
| SR-15 | | | | | | | | |

---

## Real Safari and iPhone

**Purpose.** Playwright WebKit is not Safari (it is built from WebKit's latest source and does not match the shipping Safari). D-14 asks for one check on real Safari for macOS and on an iPhone. The versions you record here are also the evidence for the "previous major version" statement (NFR-12): the Next.js 16 browser floor is Chrome and Edge 111, Firefox 111 and Safari 16.4, and the launch report states that the tested versions sit above it.

**Set-up.** A Mac with the current Safari and an iPhone with the current Safari. If a device on the previous major iOS or macOS is available, repeat the journey on it and record it as a second row. Use the staging deploy preview with payment in provider test mode.

| Step | What to do | Expected result |
| --- | --- | --- |
| SF-01 | Open the catalogue, a course page and the programmes page. | Pages render with no overlapping or cut-off text; images and the page header display; the page does not scroll sideways. |
| SF-02 | Register a new account with a real address you can read. Open the verification email and follow the link. | The form submits, the verification email arrives, the link verifies the account, and you land signed in or on the sign-in page with a clear message. |
| SF-03 | Sign out and sign in. Fail one sign-in on purpose. | Sign-in works and stays signed in after a refresh (cookies are kept); the failure message shows inside its box and focus is on it. |
| SF-04 | Enrol in the paid cohort and pay in provider test mode. | The checkout page shows the amount and currency; payment completes through the provider's test page; you return to the site and see the confirming page, then the enrolment as active. |
| SF-05 | Open the course home, then a text lesson, then a video lesson. Play the video, pause, change the volume, go full screen and leave it. | The video plays inline on iPhone (not forced into the system player unless the player is built that way); the controls work by touch; captions show if built. |
| SF-06 | Submit a quiz and an assignment with a file (on iPhone choose a file from Photos or Files). | The file picker opens, the file uploads, and the submission shows as received. |
| SF-07 | Open the learner dashboard, results and support pages. Create a support request. | The pages render and the request is created with a reference. |
| SF-08 | Open the staff screens on the Mac: overview, cohorts, a cohort roster, enrolments, payments. Open a row actions menu and a confirmation dialog. | Tables scroll only inside their own box; the menu and dialog open at the right place and close; dates show in Lagos time. |
| SF-09 | On iPhone, open the staff overview, a list and a row actions menu (the three-dots menu). | The menu opens, every item is tappable (at least 44 by 44 points), and the dialog it opens fits the screen with the keyboard open. |
| SF-10 | Open a certificate, download the PDF and open the certificate check page with its reference. | The PDF opens in Safari; the check page shows the certificate as valid. |
| SF-11 | Rotate the iPhone to landscape on the lesson page and a form. | The layout adjusts with no sideways scroll and no content hidden behind the browser toolbar or the home indicator. |
| SF-12 | Record the versions: macOS and Safari, iOS and Safari (Settings, General, About). | Versions are written in the results table. |

**Results**

| Step | Tester | Device | Operating system and version | Browser and version | Assistive technology and version | Date | Pass or fail | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| SF-01 | | | | | | | | |
| SF-02 | | | | | | | | |
| SF-03 | | | | | | | | |
| SF-04 | | | | | | | | |
| SF-05 | | | | | | | | |
| SF-06 | | | | | | | | |
| SF-07 | | | | | | | | |
| SF-08 | | | | | | | | |
| SF-09 | | | | | | | | |
| SF-10 | | | | | | | | |
| SF-11 | | | | | | | | |
| SF-12 | | | | | | | | |

---

## Keyboard-only walkthrough

**Purpose.** `e2e/keyboard.spec.ts` proves the mechanical parts (skip link first, visible and unobscured focus, no trap, menu and dialog return focus, focus to the alert after a failed form). A person confirms the parts a script cannot judge: that the focus order makes sense, that every control can be used, and that nothing needs a mouse.

**Set-up.** Unplug or ignore the mouse and touchpad. Use Tab, Shift+Tab, Enter, Space, arrow keys and Escape only. Use a desktop browser (Chrome or Edge on Windows; Safari on the Mac if you can).

| Step | What to do | Expected result |
| --- | --- | --- |
| KB-01 | Public journey. Open the catalogue, press Tab once. | The first thing focused is "Skip to main content", it appears on screen, and Enter moves you into the main area. |
| KB-02 | Public journey. Go from the catalogue to a course page, to register, to the sign-in page using only the keyboard. Submit the sign-in form with a wrong password. | Every link and field is reachable; the focus ring is always visible and never hidden behind a header or banner; after the failure focus is on the error message. |
| KB-03 | Public journey. Open the certificate check page and check a reference. | The field and button work by keyboard; the result is reachable and read in order. |
| KB-04 | Learner journey. Sign in, open the dashboard, open the course, open a lesson, complete it, open the assessment, submit. | Focus order follows the reading order; the lesson navigation (next and previous) is reachable; the submit works; the result is reachable. |
| KB-05 | Learner journey. Open the support page, create a request, open the ticket. | The form fields, the category choice and the submit work; the error summary takes focus when a field is empty. |
| KB-06 | Staff journey. Sign in as an administrator. Open the staff overview, the cohorts list, a cohort, its roster. | The staff navigation is reachable; the tabs work with the keyboard; the focus ring is visible on every tab and row. |
| KB-07 | Staff journey. In the enrolments list open a row's actions menu, choose an item that opens a confirmation dialog, type a reason, confirm, then repeat and press Escape. | The menu opens with Enter or arrow keys, arrow keys move, Escape closes it and focus returns to the button; the dialog traps focus, and Escape or Cancel returns focus to the control that opened it. |
| KB-08 | Staff journey. Open a table that scrolls sideways (the learner results table) and scroll it with the arrow keys. | The scrolling box takes focus (a visible ring) and scrolls with the arrows. |
| KB-09 | At any point, try to get stuck: Tab around a dialog, a menu and the notifications. | You can always leave with Escape, Tab or Shift+Tab; there is no place where Tab does nothing. |
| KB-10 | Staff journey. Open the operations status page and the privacy lookup, look a learner up and open the anonymise confirmation (cancel it). | Everything is reachable; the confirmation names the learner; cancel returns focus to the button. |

**Results**

| Step | Tester | Device | Operating system and version | Browser and version | Assistive technology and version | Date | Pass or fail | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| KB-01 | | | | | | | | |
| KB-02 | | | | | | | | |
| KB-03 | | | | | | | | |
| KB-04 | | | | | | | | |
| KB-05 | | | | | | | | |
| KB-06 | | | | | | | | |
| KB-07 | | | | | | | | |
| KB-08 | | | | | | | | |
| KB-09 | | | | | | | | |
| KB-10 | | | | | | | | |

---

## Licence screens (Phase 14 folded)

**Purpose.** Phase 14 left browser and accessibility checks unrun (`14-UAT.md` test 4, and the unrun-verify entries for plans 14-10, 14-15, 14-19 in `.planning/WINDOWS.md`). They are folded into this launch check so they are done once, with the rest. The licence page is `/staff/licence`; the banner shows on staff screens; the activation dialog opens from the page's "Activate licence" button.

**Set-up.** A local or staging deployment where you can sign in as an administrator who holds the licence-view permission. For the restricted-mode steps, a deployment whose licence state is restricted (expired or unlicensed with the grace period over). For the "no permission" steps, a staff account without the licence-view permission (for example the instructor).

| Step | What to do | Expected result |
| --- | --- | --- |
| LC-01 | Keyboard: open `/staff/licence` and use only the keyboard to reach every control (copy buttons, the diagnostic download, "Activate licence"). | Every control is reachable, the focus ring is visible, the order follows the reading order, the copy button changes to a check mark and goes back after a moment. |
| LC-02 | Keyboard: open the activation dialog with Enter, Tab around it, press Escape; open it again and choose Cancel. | Focus moves into the dialog on open, stays inside while it is open, and returns to the "Activate licence" button on Escape and on Cancel. |
| LC-03 | Keyboard: in the activation dialog choose a licence file, read the preview, then take the second step (confirm). Try a file with one character changed. | The preview appears without echoing the file's text; the changed file shows the "bad signature" message and "Nothing was changed."; a good file activates and the banner, status and lists update without a reload. |
| LC-04 | Screen reader (NVDA and VoiceOver): read the licence page, the banner and the activation dialog. | The state is stated in words (not only colour or icon); the banner is announced as a status; the dialog announces its title, the file field is labelled, the preview and errors are announced. |
| LC-05 | Narrow width: set the window to 320 pixels wide (or open on a phone) and open the licence page. | No sideways scrolling of the page; the right-hand rail stacks below the content under 1024 pixels; a 200-character client name and a 120-character renewal email address wrap inside their boxes. |
| LC-06 | 200 percent zoom: zoom the browser to 200 percent at 1280 pixels wide (or 400 percent at 1280 for the strict reflow test) on the licence page. | The page reflows to one column, nothing is cut off or overlaps, and every control is still usable. |
| LC-07 | Banner: open any staff screen in a restricted deployment at 1280 pixels, 320 pixels and 200 percent zoom. | The banner sits between the header and the page; the state label and icon show; at narrow width the link wraps onto its own line; the link has a visible focus ring; a staff account without licence view sees no banner. |
| LC-08 | File name: choose a licence file with a 120-character name. | The name shows truncated with an ellipsis and does not widen the 400-pixel rail. |
| LC-09 | Restricted mode: check the disabled write controls (cohort cancel, add enrolment, publish). | Each is disabled with a visible reason line; refunds, manual payment, grade entry, attendance and the unsaved-changes guards still work; "Deactivate" works and "Reactivate" is disabled with a reason; staff without licence view see "ask an administrator". |
| LC-10 | Learners: in a restricted deployment try a new registration and a checkout. | The wording is neutral and does not mention the licence; nothing on any learner screen names the licence or shows signing material. |
| LC-11 | Staff without the licence-view permission: open `/staff/licence` and look at the staff navigation. | The page shows the refusal panel (note whether it has a page heading: the refusal screens of the operations and privacy pages had none when last checked), and there is no Licence item in the navigation. |

**Results**

| Step | Tester | Device | Operating system and version | Browser and version | Assistive technology and version | Date | Pass or fail | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| LC-01 | | | | | | | | |
| LC-02 | | | | | | | | |
| LC-03 | | | | | | | | |
| LC-04 | | | | | | | | |
| LC-05 | | | | | | | | |
| LC-06 | | | | | | | | |
| LC-07 | | | | | | | | |
| LC-08 | | | | | | | | |
| LC-09 | | | | | | | | |
| LC-10 | | | | | | | | |
| LC-11 | | | | | | | | |

---

## Unassisted manual journey (D-08)

**Purpose.** D-08 asks that a person who has not seen the product completes the journey from discovery to a certificate without help. The automated journey (`e2e/journey.spec.ts`) proves the system works; this proves a stranger can find their way. It is done on the staging deploy preview during plan 15-30, with payment in provider test mode.

**Set-up.**

- A tester who has never used or been shown the product. They are given only the address of the staging deploy preview and the goal: "Find a course, sign up, pay, learn and get your certificate."
- An observer who does not help. The observer starts a timer and writes down every point where the tester stopped, asked a question, or went the wrong way. If the tester asks for help, the observer notes the exact question and the time, then gives the smallest hint that lets them continue.
- Test payment details from the provider's test mode are given to the tester when they reach the payment page (that is the only help given in advance).
- A staff member prepares what the learner cannot do alone: confirms the cohort is open and priced, marks attendance, grades the assignment and issues the certificate (the staff steps are done by the observer or a second person, and the time the tester waits is noted separately).

| Step | What the tester does | Expected result |
| --- | --- | --- |
| UJ-01 | Find the course catalogue and choose a course. | The tester reaches a course page without help. |
| UJ-02 | Read the course and open the open cohort. Start to enrol. | The tester finds how to enrol and sees the price and currency. |
| UJ-03 | Create an account. | The tester registers, reads the verification email and verifies the account. |
| UJ-04 | Pay in provider test mode. | The tester completes payment and sees the enrolment confirmed. |
| UJ-05 | Find the course in the learner area and open the first lesson. | The tester reaches the lesson from the dashboard without help. |
| UJ-06 | Work through the lessons. | The tester finishes the readings and the video and knows what is next. |
| UJ-07 | Attend or acknowledge the live session. | The tester finds the session time and link (time shown in Lagos time). |
| UJ-08 | Submit the assignment with a file. | The tester finds the assignment and submits; the confirmation is clear. |
| UJ-09 | Receive the result and see progress. | The tester finds the released grade and their progress. |
| UJ-10 | Get the certificate, download it, and check it on the certificate check page. | The tester finds the certificate, downloads the PDF and sees it verified. |
| UJ-11 | Ask for help: raise a support request about anything. | The tester finds support and creates a request with a reference. |

For each step the observer records the time taken, any point where the tester needed help (with the question asked), and any wording or screen the tester found confusing. The overall result is "pass" only if every step was done without help; a step done after a hint is "pass with help" and is written up as a finding.

**Results**

| Step | Tester | Device | Operating system and version | Browser and version | Assistive technology and version | Date | Pass or fail | Notes (time taken, help needed) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| UJ-01 | | | | | | | | |
| UJ-02 | | | | | | | | |
| UJ-03 | | | | | | | | |
| UJ-04 | | | | | | | | |
| UJ-05 | | | | | | | | |
| UJ-06 | | | | | | | | |
| UJ-07 | | | | | | | | |
| UJ-08 | | | | | | | | |
| UJ-09 | | | | | | | | |
| UJ-10 | | | | | | | | |
| UJ-11 | | | | | | | | |
