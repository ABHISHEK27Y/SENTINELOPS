import { Kafka, type Producer } from 'kafkajs';
import { createLogger, type Logger } from '@sentinelops/logger';
import type { EventEnvelope, TopicName } from '@sentinelops/shared-types';
import { createKafka } from './client.js';

/**
 * Best-effort event producer. Connect failures and send failures are logged and
 * swallowed by default so a broker outage never takes down a data-plane service
 * (telemetry is best-effort, like tracing). Set `strict` to surface errors.
 */
export class EventProducer {
  private producer: Producer;
  private connected = false;
  private connecting: Promise<void> | null = null;
  private log: Logger;

  constructor(
    private opts: { kafka?: Kafka; strict?: boolean; logger?: Logger } = {},
  ) {
    const kafka = opts.kafka ?? createKafka();
    this.producer = kafka.producer({
      allowAutoTopicCreation: true,
      idempotent: false,
    });
    this.log = opts.logger ?? createLogger({ service: 'kafka-producer' });
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    if (this.connecting) return this.connecting;
    const p = this.producer
      .connect()
      .then(() => {
        this.connected = true;
        this.log.info('kafka producer connected');
      })
      .catch((err: unknown) => {
        this.log.warn(
          { err: (err as Error).message },
          'kafka producer connect failed',
        );
        if (this.opts.strict) throw err;
      })
      .finally(() => {
        this.connecting = null;
      });
    this.connecting = p;
    return p;
  }

  /** Send one enveloped event. Key defaults to the envelope's service. */
  async send<T>(
    topic: TopicName,
    envelope: EventEnvelope<T>,
    key?: string,
  ): Promise<boolean> {
    try {
      if (!this.connected) await this.connect();
      if (!this.connected) return false; // connect failed (non-strict)
      await this.producer.send({
        topic,
        messages: [
          {
            key: key ?? envelope.service,
            value: JSON.stringify(envelope),
            headers: { type: envelope.type, eventId: envelope.eventId },
          },
        ],
      });
      return true;
    } catch (err) {
      this.log.warn(
        { topic, type: envelope.type, err: (err as Error).message },
        'kafka send failed',
      );
      if (this.opts.strict) throw err;
      return false;
    }
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;
    try {
      await this.producer.disconnect();
    } catch {
      /* ignore */
    }
    this.connected = false;
  }
}
