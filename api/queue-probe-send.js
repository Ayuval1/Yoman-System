// ניסוי בלבד (ענף claude/queue-experiment, לא למיזוג): שולח הודעה מושהית ל-Vercel Queues כדי למדוד את דיוק ההגעה.
// הנחה, לא אומת: ש-@vercel/queue עובד מקובץ api/*.js פשוט. זה מה שהניסוי בודק.
import { send } from '@vercel/queue';

export default async function handler(req, res) {
  const delaySeconds = 120;
  const sentAt = new Date();
  const targetAt = new Date(sentAt.getTime() + delaySeconds * 1000);
  const result = await send('probe-delay', { sentAt: sentAt.toISOString(), targetAt: targetAt.toISOString() }, { delaySeconds, retentionSeconds: 86400 });
  console.log(JSON.stringify({ event: 'probe-sent', sentAt: sentAt.toISOString(), targetAt: targetAt.toISOString() }));
  res.status(200).json({ sentAt: sentAt.toISOString(), targetAt: targetAt.toISOString(), result: String(result?.messageId ?? 'sent') });
}
