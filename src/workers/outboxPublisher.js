#!/usr/bin/env node
const mongoose = require('mongoose');
const axios = require('axios');
const OutboxEvent = require('../models/outboxEvent');
const { connectDatabase } = require('../config/database');

const POLL_INTERVAL_MS = Number(process.env.OUTBOX_POLL_INTERVAL_MS || 1000);
const MAX_ATTEMPTS = Number(process.env.OUTBOX_MAX_ATTEMPTS || 5);

async function publishEvent(event) {
  const publishUrl = process.env.OUTBOX_PUBLISH_URL;
  if (!publishUrl) {
    // fallback: console log
    console.log('Outbox publish (console):', event.eventType, event.payload);
    return { ok: true };
  }

  // attempt HTTP POST
  try {
    const res = await axios.post(publishUrl, { eventType: event.eventType, payload: event.payload }, { timeout: 5000 });
    return { ok: true, status: res.status };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

async function workerLoop() {
  await connectDatabase();
  console.log('Outbox worker connected to DB');

  while (true) {
    try {
      const event = await OutboxEvent.findOneAndUpdate(
        { status: 'pending', availableAt: { $lte: new Date() } },
        { $inc: { attempts: 1 }, $set: { status: 'processing' } },
        { sort: { createdAt: 1 }, new: true }
      );

      if (!event) {
        await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
        continue;
      }

      const result = await publishEvent(event);
      if (result.ok) {
        await OutboxEvent.updateOne({ _id: event._id }, { $set: { status: 'published', publishedAt: new Date() } });
        console.log('Published outbox event', event._id.toString());
      } else {
        console.error('Failed to publish outbox event', event._id.toString(), result.error);
        if (event.attempts >= MAX_ATTEMPTS) {
          await OutboxEvent.updateOne({ _id: event._id }, { $set: { status: 'failed', availableAt: new Date(Date.now() + 60 * 60 * 1000) } });
        } else {
          // exponential backoff
          const backoffMs = Math.min(60_000, 500 * Math.pow(2, event.attempts));
          await OutboxEvent.updateOne({ _id: event._id }, { $set: { status: 'pending', availableAt: new Date(Date.now() + backoffMs) } });
        }
      }
    } catch (err) {
      console.error('Outbox worker loop error', err);
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    }
  }
}

if (require.main === module) {
  workerLoop().catch(err => {
    console.error('Outbox worker failed', err);
    process.exit(1);
  });
}

module.exports = { workerLoop };
