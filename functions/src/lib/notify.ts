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
import { db, FieldValue, getPrivate } from '../shared';

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

  // FCM web push — real device banners for users who enabled notifications.
  await sendPush(args.userId, args.title, args.body, args.link ?? null);
}

async function sendPush(userId: string, title: string, body: string, link: string | null) {
  try {
    const tokens = (await getPrivate(userId)).fcmTokens;
    if (tokens.length === 0) return;
    const { getMessaging } = await import('firebase-admin/messaging');
    const res = await getMessaging().sendEachForMulticast({
      tokens,
      notification: { title, body },
      data: link ? { link } : {},
      webpush: { notification: { icon: '/icon.svg' } },
    });
    // Prune dead tokens so the list stays clean.
    const dead = tokens.filter((_, i) => {
      const err = res.responses[i].error?.code ?? '';
      return err.includes('registration-token-not-registered') || err.includes('invalid-argument');
    });
    if (dead.length) {
      await db
        .doc(`users/${userId}/private/data`)
        .set({ fcmTokens: FieldValue.arrayRemove(...dead) }, { merge: true });
    }
  } catch (e) {
    console.error(`[push:error] ${userId}: ${(e as Error).message}`);
  }
}

async function sendSms(userId: string, message: string) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM;
  if (!sid || !token || !from) {
    console.log(`[sms:noop] ${userId}: ${message.replace(/\n/g, ' ')}`);
    return;
  }
  const to = (await getPrivate(userId)).phone;
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
