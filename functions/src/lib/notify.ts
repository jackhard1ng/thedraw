/**
 * Notifications (spec §5 "Notification channels"). SMS is PRIMARY for anything
 * deadline-critical — iOS PWAs can only push when added to the home screen, so
 * push can't be relied on for the forfeit machinery. Push is a bonus channel.
 *
 * Provider-agnostic: SMS goes through whatever is configured (Twilio-style REST
 * via env), and degrades to a logged no-op when unconfigured so the scheduling
 * machinery still runs in dev and free tiers. Every send is also written to a
 * `notifications` collection as an in-app record.
 */
import { db, FieldValue } from '../shared';

export type NotifyChannel = 'sms' | 'push' | 'inApp';

export async function notify(args: {
  userId: string;
  title: string;
  body: string;
  deadlineCritical?: boolean; // routes to SMS
  link?: string;
}) {
  // Always leave an in-app record.
  await db.collection('notifications').add({
    userId: args.userId,
    title: args.title,
    body: args.body,
    link: args.link ?? null,
    createdAt: FieldValue.serverTimestamp(),
    read: false,
  });

  if (args.deadlineCritical) {
    await sendSms(args.userId, `${args.title}\n${args.body}`);
  }
  // FCM push (bonus channel) would fan out here to the user's registered tokens.
}

async function sendSms(userId: string, message: string) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM;
  if (!sid || !token || !from) {
    console.log(`[sms:noop] ${userId}: ${message.replace(/\n/g, ' ')}`);
    return;
  }
  const user = await db.doc(`users/${userId}`).get();
  const to = (user.data()?.phone as string) || '';
  if (!to) return;
  const body = new URLSearchParams({ To: to, From: from, Body: message });
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });
  if (!res.ok) console.error(`[sms:error] ${res.status} ${await res.text()}`);
}
