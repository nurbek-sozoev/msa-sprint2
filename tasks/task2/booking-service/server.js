const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const { Pool } = require('pg');
const { Kafka } = require('kafkajs');
const http = require('http');

// --- Config ---
const GRPC_PORT = process.env.GRPC_PORT || '9090';
const MONOLITH_URL = process.env.MONOLITH_URL || 'http://monolith:8080';
const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || 'kafka:9092').split(',');

const pool = new Pool({
  host: process.env.DB_HOST || 'booking-db',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'booking',
  user: process.env.DB_USER || 'booking',
  password: process.env.DB_PASSWORD || 'booking',
});

const kafka = new Kafka({
  clientId: 'booking-service',
  brokers: KAFKA_BROKERS,
  retry: { retries: 10, initialRetryTime: 3000 },
});
const producer = kafka.producer();
let producerReady = false;

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

// --- HTTP helper ---
function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    }).on('error', reject);
  });
}

function httpPost(url) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const opts = {
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: 'POST',
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.end();
  });
}

// --- Validation helpers ---
async function validateUser(userId) {
  const active = await httpGet(`${MONOLITH_URL}/api/users/${userId}/active`);
  if (active.body.trim() !== 'true') {
    throw new Error('User is inactive');
  }
  const blacklisted = await httpGet(`${MONOLITH_URL}/api/users/${userId}/blacklisted`);
  if (blacklisted.body.trim() === 'true') {
    throw new Error('User is blacklisted');
  }
}

async function validateHotel(hotelId) {
  const operational = await httpGet(`${MONOLITH_URL}/api/hotels/${hotelId}/operational`);
  if (operational.body.trim() !== 'true') {
    throw new Error('Hotel is not operational');
  }
  const trusted = await httpGet(`${MONOLITH_URL}/api/reviews/hotel/${hotelId}/trusted`);
  if (trusted.body.trim() !== 'true') {
    throw new Error('Hotel is not trusted based on reviews');
  }
  const fullyBooked = await httpGet(`${MONOLITH_URL}/api/hotels/${hotelId}/fully-booked`);
  if (fullyBooked.body.trim() === 'true') {
    throw new Error('Hotel is fully booked');
  }
}

async function resolveBasePrice(userId) {
  const res = await httpGet(`${MONOLITH_URL}/api/users/${userId}/status`);
  if (res.status === 200 && res.body.trim().toUpperCase() === 'VIP') {
    return 80.0;
  }
  return 100.0;
}

async function resolvePromoDiscount(promoCode, userId) {
  if (!promoCode) return 0.0;
  const res = await httpPost(
    `${MONOLITH_URL}/api/promos/validate?code=${encodeURIComponent(promoCode)}&userId=${encodeURIComponent(userId)}`
  );
  if (res.status === 200) {
    const json = JSON.parse(res.body);
    return json.discount || 0.0;
  }
  return 0.0;
}

// --- gRPC handlers ---
async function CreateBooking(call, callback) {
  try {
    const { user_id, hotel_id, promo_code } = call.request;

    await validateUser(user_id);
    await validateHotel(hotel_id);

    const basePrice = await resolveBasePrice(user_id);
    const discount = await resolvePromoDiscount(promo_code, user_id);
    const price = basePrice - discount;

    const result = await pool.query(
      `INSERT INTO booking (user_id, hotel_id, promo_code, discount_percent, price, created_at)
       VALUES ($1, $2, $3, $4, $5, now()) RETURNING *`,
      [user_id, hotel_id, promo_code || null, discount, price]
    );

    const row = result.rows[0];
    const createdAt = new Date(row.created_at).toISOString();

    const event = {
      id: String(row.id),
      user_id: row.user_id,
      hotel_id: row.hotel_id,
      promo_code: row.promo_code || '',
      discount_percent: row.discount_percent,
      price: row.price,
      created_at: createdAt,
    };

    if (producerReady) {
      try {
        await producer.send({
          topic: 'BookingCreated',
          messages: [{ value: JSON.stringify(event) }],
        });
        console.log('Kafka event sent:', event.id);
      } catch (err) {
        console.error('Kafka send failed (booking not cancelled):', err.message);
      }
    } else {
      console.warn('Kafka producer not ready, skipping event');
    }

    callback(null, {
      id: String(row.id),
      user_id: row.user_id,
      hotel_id: row.hotel_id,
      promo_code: row.promo_code || '',
      discount_percent: row.discount_percent,
      price: row.price,
      created_at: createdAt,
    });
  } catch (err) {
    console.error('CreateBooking error:', err.message);
    callback({
      code: grpc.status.INVALID_ARGUMENT,
      message: err.message,
    });
  }
}

async function ListBookings(call, callback) {
  try {
    const userId = call.request.user_id;
    let result;
    if (userId) {
      result = await pool.query('SELECT * FROM booking WHERE user_id = $1 ORDER BY id', [userId]);
    } else {
      result = await pool.query('SELECT * FROM booking ORDER BY id');
    }

    const bookings = result.rows.map((row) => ({
      id: String(row.id),
      user_id: row.user_id,
      hotel_id: row.hotel_id,
      promo_code: row.promo_code || '',
      discount_percent: row.discount_percent,
      price: row.price,
      created_at: new Date(row.created_at).toISOString(),
    }));

    callback(null, { bookings });
  } catch (err) {
    console.error('ListBookings error:', err.message);
    callback({ code: grpc.status.INTERNAL, message: err.message });
  }
}

// --- Main ---
async function main() {
  await waitForDb();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS booking (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      hotel_id TEXT NOT NULL,
      promo_code TEXT,
      discount_percent DOUBLE PRECISION,
      price DOUBLE PRECISION NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT now()
    );
  `);
  console.log('DB table ready');

  // Init Kafka producer
  try {
    await producer.connect();
    producerReady = true;
    console.log('Kafka producer connected');
  } catch (err) {
    console.error('Kafka producer connection failed:', err.message);
  }

  // Load proto
  const packageDef = protoLoader.loadSync('./booking.proto', {
    keepCase: true,
    longs: String,
    defaults: true,
  });
  const bookingProto = grpc.loadPackageDefinition(packageDef).booking;

  // Start gRPC server
  const server = new grpc.Server();
  server.addService(bookingProto.BookingService.service, {
    CreateBooking,
    ListBookings,
  });
  server.bindAsync(
    `0.0.0.0:${GRPC_PORT}`,
    grpc.ServerCredentials.createInsecure(),
    (err, port) => {
      if (err) {
        console.error('gRPC bind failed:', err);
        process.exit(1);
      }
      console.log(`gRPC server listening on port ${port}`);
    }
  );
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
