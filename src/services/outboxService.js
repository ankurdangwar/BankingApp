const OutboxEvent = require('../models/outboxEvent');

async function enqueueOutboxEvent({ session, aggregateType, aggregateId, eventType, payload }) {
  const [event] = await OutboxEvent.create([{
    aggregateType,
    aggregateId: aggregateId.toString(),
    eventType,
    payload,
    status: 'pending',
    availableAt: new Date()
  }], session ? { session } : undefined);

  return event;
}

async function claimPendingOutboxEvent() {
  // Atomically claim a pending event and mark it processing
  return OutboxEvent.findOneAndUpdate(
    { status: 'pending', availableAt: { $lte: new Date() } },
    { $inc: { attempts: 1 }, $set: { status: 'processing' } },
    { sort: { createdAt: 1 }, new: true }
  );
}

async function markOutboxPublished(eventId) {
  return OutboxEvent.updateOne(
    { _id: eventId },
    { $set: { status: 'published', publishedAt: new Date() } }
  );
}

module.exports = {
  enqueueOutboxEvent,
  claimPendingOutboxEvent,
  markOutboxPublished
};
