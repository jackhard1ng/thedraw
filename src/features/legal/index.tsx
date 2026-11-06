/**
 * Terms, Privacy, Refunds, and Support — the legal + support surface a product
 * that charges cards needs before it takes a dollar. Stripe activation and any
 * app-store listing both require public Terms + Privacy URLs; a real user in
 * trouble needs a way to reach a human.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ BEFORE LAUNCH (docs/LAUNCH.md gate): have a lawyer review this copy and   │
 * │ the refund terms, and confirm the skill-based-contest position for MO/KS  │
 * │ before flipping markets/kc.paidEventsEnabled = true. This is honest,      │
 * │ plain-English starter text written to match how the product ACTUALLY      │
 * │ behaves — not a substitute for counsel.                                   │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * These pages must resolve for SIGNED-OUT visitors (Stripe/app-store crawlers,
 * a shared link), so they're mounted in both route trees in App.tsx.
 */
import { Link, Route, useNavigate } from 'react-router-dom';
import { Card, Rule } from '@/components/ui';

/** The address a user in trouble reaches you at. MUST point somewhere you read. */
export const SUPPORT_EMAIL = 'support@thedraw.app';

/** Last substantive revision — bump when you change the terms. */
const EFFECTIVE = 'August 2026';

function LegalLayout({ title, children }: { title: string; children: React.ReactNode }) {
  const nav = useNavigate();
  return (
    <div className="mx-auto max-w-sheet px-4 py-6">
      <button onClick={() => nav(-1)} className="btn-quiet mb-4 px-0">
        ← Back
      </button>
      <h1 className="text-2xl">{title}</h1>
      <p className="mt-1 text-xs text-ink-faint">Effective {EFFECTIVE} · Kansas City</p>
      <div className="mt-6 space-y-5 text-sm leading-relaxed text-ink-soft">
        {children}
      </div>
      <Rule className="my-8" />
      <LegalFooter />
    </div>
  );
}

function H({ children }: { children: React.ReactNode }) {
  return <h2 className="font-display uppercase tracking-wide text-xs text-ink">{children}</h2>;
}

/** Footer row of legal + support links. Drop into landing, profile, shells. */
export function LegalFooter() {
  return (
    <nav className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-ink-faint">
      <Link to="/terms" className="underline underline-offset-2 hover:text-ink-soft">Terms</Link>
      <Link to="/privacy" className="underline underline-offset-2 hover:text-ink-soft">Privacy</Link>
      <Link to="/refunds" className="underline underline-offset-2 hover:text-ink-soft">Refunds</Link>
      <Link to="/support" className="underline underline-offset-2 hover:text-ink-soft">Support</Link>
    </nav>
  );
}

/**
 * Legal routes, mounted in BOTH the signed-out and signed-in route trees so the
 * pages resolve for Stripe/app-store crawlers and shared links alike. The
 * signed-out tree wraps these in <PublicShell> at the call site.
 */
export const legalRoutes = [
  <Route key="terms" path="/terms" element={<TermsPage />} />,
  <Route key="privacy" path="/privacy" element={<PrivacyPage />} />,
  <Route key="refunds" path="/refunds" element={<RefundsPage />} />,
  <Route key="support" path="/support" element={<SupportPage />} />,
];

export function TermsPage() {
  return (
    <LegalLayout title="Terms of Service">
      <p>
        The Draw is a platform for finding and running golf competitions — leagues,
        tournaments, one-off matches, and scrambles — in the Kansas City area. By
        creating an account you agree to these terms. If you don’t, don’t use it.
      </p>

      <div className="space-y-2">
        <H>Who can use it</H>
        <p>
          You must be 18 or older, use your real name, and give accurate
          information — including an honest handicap. Accounts that misrepresent
          identity or skill may be adjusted, restricted, or removed.
        </p>
      </div>

      <div className="space-y-2">
        <H>Contests of skill</H>
        <p>
          Entries buy a place in a contest of skill: golf, scored under a stated
          format and handicap system, where the outcome is determined by how you
          play. The Draw is not a game of chance and not a sportsbook. You are
          entering a competition, not placing a bet.
        </p>
      </div>

      <div className="space-y-2">
        <H>Money</H>
        <p>
          When you enter a paid event your card is <em>authorized</em>, not charged.
          If the event fills its minimum, authorizations are captured at close and
          the purse is paid out. If the field falls short of the minimum, your
          authorization is voided and you are never charged. Winnings transfer
          directly to your own connected payout account — The Draw never holds a
          withdrawable balance of your money. See the{' '}
          <Link to="/refunds" className="underline">Refund &amp; Cancellation Policy</Link>{' '}
          for withdrawals and no-shows.
        </p>
        <p>
          <strong>Green fees are separate.</strong> You pay the course directly for
          your round. Entry fees cover the competition purse and a stated admin fee
          only.
        </p>
      </div>

      <div className="space-y-2">
        <H>Playing fair</H>
        <p>
          Report real scores. Rounds are attested by your group and may be reviewed.
          Sandbagging, false scores, and manipulating your handicap to gain strokes
          are grounds for voiding results, forfeiting winnings, and removal. The
          Draw may adjust a player’s competition index to keep events fair.
        </p>
      </div>

      <div className="space-y-2">
        <H>Disputes</H>
        <p>
          The event organizer resolves scoring and eligibility disputes in the
          first instance. The Draw is the final arbiter and may void or adjust a
          result to protect the integrity of a competition.
        </p>
      </div>

      <div className="space-y-2">
        <H>Golf is played at your own risk</H>
        <p>
          The Draw organizes competition; it does not operate golf courses. You are
          responsible for your own conduct, safety, transportation, and compliance
          with each course’s rules. The Draw is not liable for injury, course
          conditions, weather, or anything that happens on the course.
        </p>
      </div>

      <div className="space-y-2">
        <H>Ending your account</H>
        <p>
          You can delete your account at any time from your profile. We may suspend
          or remove accounts that break these terms. Some records required by law
          (e.g. payment ledger entries) are retained in anonymized form after
          deletion.
        </p>
      </div>

      <div className="space-y-2">
        <H>Changes &amp; governing law</H>
        <p>
          We may update these terms; material changes will be posted here with a new
          effective date. These terms are governed by the laws of the State of
          Missouri. Questions:{' '}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="underline">{SUPPORT_EMAIL}</a>.
        </p>
      </div>
    </LegalLayout>
  );
}

export function PrivacyPage() {
  return (
    <LegalLayout title="Privacy Policy">
      <p>
        Short version: we collect what we need to run competitions and pay winners,
        we keep your contact and payment details private, and we don’t sell your
        data.
      </p>

      <div className="space-y-2">
        <H>What we collect</H>
        <p>
          Your name, phone number, age confirmation (to verify you’re 18+), handicap
          and its source, your market and course preferences, competition results,
          and — for paid events — payment details handled by Stripe. If you enable
          notifications we store a device token to send them.
        </p>
      </div>

      <div className="space-y-2">
        <H>What other members can see</H>
        <p>
          Your public profile shows your name, handicap tier, reliability, and
          competitive record. Your phone number, exact age, and payment identifiers
          are kept in a private record that other members never receive.
        </p>
      </div>

      <div className="space-y-2">
        <H>Payments</H>
        <p>
          Card payments are processed by Stripe. The Draw does not store your full
          card number. Payouts go to a Stripe Connect account you control, and
          Stripe may report payouts to tax authorities where the law requires —
          winnings may be taxable income to you.
        </p>
      </div>

      <div className="space-y-2">
        <H>Messages</H>
        <p>
          We send transactional notifications (event reminders, results, critical
          deadlines) by in-app inbox, push, and — for time-critical items — SMS.
          You can turn off push and non-essential alerts in your profile.
        </p>
      </div>

      <div className="space-y-2">
        <H>Deleting your data</H>
        <p>
          Deleting your account removes your profile and posts. Records the law
          requires us to keep (such as payment ledger entries) are retained in
          anonymized form. Requests:{' '}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="underline">{SUPPORT_EMAIL}</a>.
        </p>
      </div>

      <div className="space-y-2">
        <H>Service providers</H>
        <p>
          We use Google Firebase (hosting, database, auth), Stripe (payments), and
          messaging providers to operate the service. We share only what each needs
          to do its job. We do not sell personal data.
        </p>
      </div>
    </LegalLayout>
  );
}

export function RefundsPage() {
  return (
    <LegalLayout title="Refund & Cancellation Policy">
      <p>
        Because of how The Draw handles money, most “refunds” never need to happen —
        you’re not charged unless an event actually runs.
      </p>

      <div className="space-y-2">
        <H>Before an event fills</H>
        <p>
          Entering authorizes your card; it does not charge it. If the event never
          reaches its minimum field, the authorization is voided and you pay
          nothing.
        </p>
      </div>

      <div className="space-y-2">
        <H>Withdrawing before entries lock</H>
        <p>
          You can withdraw any time before the entry deadline. Your authorization is
          released and you are not charged.
        </p>
      </div>

      <div className="space-y-2">
        <H>Withdrawing after lock, or not showing up</H>
        <p>
          Once entries lock, the field and purse are set around you. If you withdraw
          after the deadline or don’t show, your entry fee may be captured and kept
          in the purse for the players who did show, and a reliability event is
          recorded on your profile. If something genuinely went wrong — injury,
          emergency, a course closure — email us and we’ll look at it.
        </p>
      </div>

      <div className="space-y-2">
        <H>Green fees</H>
        <p>
          Green fees are paid directly to the course and are never collected or
          refunded by The Draw. A refund of an entry fee does not include any money
          you paid a course.
        </p>
      </div>

      <div className="space-y-2">
        <H>Payouts &amp; problems</H>
        <p>
          Winnings are transferred after an event closes to your connected payout
          account. If a charge or payout looks wrong, contact us within 30 days at{' '}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="underline">{SUPPORT_EMAIL}</a>{' '}
          and we’ll make it right or explain what happened.
        </p>
      </div>
    </LegalLayout>
  );
}

export function SupportPage() {
  return (
    <LegalLayout title="Support">
      <p>
        Real person, real reply. If something’s wrong — a charge, a score, an event
        that didn’t run right — reach out and we’ll sort it.
      </p>

      <Card className="p-4">
        <p className="font-display uppercase tracking-wide text-xs text-ink-faint">Email us</p>
        <a
          href={`mailto:${SUPPORT_EMAIL}`}
          className="mt-1 block text-lg text-tournament underline underline-offset-2"
        >
          {SUPPORT_EMAIL}
        </a>
        <p className="mt-3 text-sm text-ink-soft">
          Include your name, the event, and what happened — a screenshot helps.
        </p>
      </Card>

      <div className="space-y-2">
        <H>Money problems come first</H>
        <p>
          If it’s about a charge or a payout, say “PAYMENT” in the subject and we’ll
          prioritize it. The Draw never holds your money overnight — a payout goes
          straight to your own account — so most issues are quick to trace.
        </p>
      </div>

      <div className="space-y-2">
        <H>Reporting a player or a result</H>
        <p>
          You can report a player or a score directly from their profile or the
          event. For anything urgent about safety or fair play, email us and we’ll
          act on it.
        </p>
      </div>
    </LegalLayout>
  );
}
