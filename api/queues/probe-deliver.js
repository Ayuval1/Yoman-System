// ניסוי בלבד (ענף claude/queue-experiment, לא למיזוג): צרכן שמדפיס מתי ההודעה הגיעה בפועל לעומת היעד.
import { QueueClient } from '@vercel/queue';

const queue = new QueueClient();

export default queue.handleNodeCallback(async (message, metadata) => {
  const deliveredAt = new Date();
  const targetAt = new Date(message.targetAt);
  console.log(JSON.stringify({
    event: 'probe-delivered',
    targetAt: message.targetAt,
    deliveredAt: deliveredAt.toISOString(),
    lateSeconds: Math.round((deliveredAt - targetAt) / 100) / 10,
    deliveryCount: metadata?.deliveryCount ?? null,
  }));
});
