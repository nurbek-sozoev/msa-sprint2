import { ApolloServer } from '@apollo/server';
import { startStandaloneServer } from '@apollo/server/standalone';
import { buildSubgraphSchema } from '@apollo/subgraph';
import gql from 'graphql-tag';
import { GraphQLError } from 'graphql';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';

const BOOKING_GRPC_ADDR = process.env.BOOKING_GRPC_ADDR || 'booking-service:9090';

const packageDefinition = protoLoader.loadSync('booking.proto', {
  keepCase: true,
  longs: String,
  defaults: true,
});
const bookingProto = grpc.loadPackageDefinition(packageDefinition).booking;
const bookingClient = new bookingProto.BookingService(
  BOOKING_GRPC_ADDR,
  grpc.credentials.createInsecure(),
);

const typeDefs = gql`
  type Booking @key(fields: "id") {
    id: ID!
    userId: String!
    hotelId: String!
    promoCode: String
    discountPercent: Int
    hotel: Hotel
  }

  extend type Hotel @key(fields: "id") {
    id: ID! @external
  }

  type Query {
    bookingsByUser(userId: String!): [Booking]
  }
`;

const resolvers = {
  Query: {
    bookingsByUser: async (_, { userId }, { req }) => {
      const headerUserId = req.headers['userid'];
      if (!headerUserId || headerUserId !== userId) {
        throw new GraphQLError('Access denied', {
          extensions: { code: 'FORBIDDEN' },
        });
      }

      return new Promise((resolve, reject) => {
        bookingClient.ListBookings({ user_id: userId }, (err, response) => {
          if (err) {
            reject(err);
            return;
          }
          const bookings = (response.bookings || []).map((b) => ({
            id: b.id,
            userId: b.user_id,
            hotelId: b.hotel_id,
            promoCode: b.promo_code,
            discountPercent: Math.round(Number(b.discount_percent)),
          }));
          resolve(bookings);
        });
      });
    },
  },
  Booking: {
    hotel: (booking) => {
      return { __typename: 'Hotel', id: booking.hotelId };
    },
  },
};

const requestLogger = {
  async requestDidStart({ request }) {
    const query = request.query?.replace(/\s+/g, ' ').trim();
    console.log(`[request] query=${query}`);
    return {
      async willSendResponse({ response }) {
        const hasErrors = response.body?.singleResult?.errors?.length > 0;
        console.log(`[response] errors=${hasErrors}`);
      },
    };
  },
};

const server = new ApolloServer({
  schema: buildSubgraphSchema([{ typeDefs, resolvers }]),
  plugins: [requestLogger],
});

startStandaloneServer(server, {
  listen: { port: 4001 },
  context: async ({ req }) => ({ req }),
}).then(() => {
  console.log('Booking subgraph ready at http://localhost:4001/');
});
