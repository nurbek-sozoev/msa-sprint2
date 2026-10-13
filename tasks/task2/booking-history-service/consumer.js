const { Pool } = require('pg');
const { Kafka } = require('kafkajs');

const pool = new Pool({
  host: process.env.DB_HOST || 'history-db',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'history',
  user: process.env.DB_USER || 'history',
  password: process.env.DB_PASSWORD || 'history',
});

const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || 'kafka:9092').split(',');
const kafka = new Kafka({
  clientId: 'booking-history-service',
  brokers: KAFKA_BROKERS,
  retry: { retries: 10, initialRetryTime: 3000 },
});
const consumer = kafka.consumer({ groupId: 'booking-history-service' });

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function waitForDb(maxRetries = 20) {
  for (let i = 1; i <= maxRetries; i++) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (err) {
      console.log(`DB not ready (attempt ${i}/${maxRetries}): ${err.message}`);
      await sleep(2000);
    }
  }
  throw new Error('DB not available after retries');
}

async function main() {
  await waitForDb();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS booking_history (
      id SERIAL PRIMARY KEY,
      booking_id TEXT,
      user_id TEXT,
      hotel_id TEXT,
      promo_code TEXT,
      discount_percent DOUBLE PRECISION,
      price DOUBLE PRECISION,
      created_at TIMESTAMP,
      received_at TIMESTAMP NOT NULL DEFAULT now()
    );
  `);
  console.log('History DB table ready');

  await consumer.connect();
  await consumer.subscribe({ topic: 'BookingCreated', fromBeginning: true });
  console.log('Subscribed to BookingCreated');

  await consumer.run({
    eachMessage: async ({ message }) => {
      try {
        const event = JSON.parse(message.value.toString());
        await pool.query(
          `INSERT INTO booking_history
             (booking_id, user_id, hotel_id, promo_code, discount_percent, price, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            event.id,
            event.user_id,
            event.hotel_id,
            event.promo_code || null,
            event.discount_percent,
            event.price,
            event.created_at,
          ]
        );
        console.log('History record saved: booking_id=' + event.id);
      } catch (err) {
        console.error('Error processing message:', err.message);
      }
    },
  });
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
