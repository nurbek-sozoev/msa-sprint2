import { ApolloServer } from '@apollo/server';
import { startStandaloneServer } from '@apollo/server/standalone';
import { buildSubgraphSchema } from '@apollo/subgraph';
import gql from 'graphql-tag';

const MONOLITH_URL = process.env.MONOLITH_URL || 'http://monolith:8080';

async function fetchHotel(id) {
  const res = await fetch(`${MONOLITH_URL}/api/hotels/${id}`);
  if (res.status === 404) return null;
  const hotel = await res.json();
  return {
    id: hotel.id,
    name: hotel.description,
    city: hotel.city,
    stars: Math.round(hotel.rating),
  };
}

const typeDefs = gql`
  type Hotel @key(fields: "id") {
    id: ID!
    name: String
    city: String
    stars: Int
  }

  type Query {
    hotelsByIds(ids: [ID!]!): [Hotel]
  }
`;

const resolvers = {
  Hotel: {
    __resolveReference: async ({ id }) => {
      return fetchHotel(id);
    },
  },
  Query: {
    hotelsByIds: async (_, { ids }) => {
      return Promise.all(ids.map((id) => fetchHotel(id)));
    },
  },
};

const server = new ApolloServer({
  schema: buildSubgraphSchema([{ typeDefs, resolvers }]),
});

startStandaloneServer(server, {
  listen: { port: 4002 },
}).then(() => {
  console.log('Hotel subgraph ready at http://localhost:4002/');
});
