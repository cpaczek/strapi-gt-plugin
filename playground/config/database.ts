import path from 'node:path';
import type { Core } from '@strapi/strapi';

const database = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Database => {
  const client = env('DATABASE_CLIENT', 'sqlite');
  if (client === 'postgres' || client === 'mysql') {
    return {
      connection: {
        client,
        connection: {
          host: env('DATABASE_HOST', '127.0.0.1'),
          port: env.int('DATABASE_PORT', client === 'postgres' ? 5432 : 3306),
          database: env('DATABASE_NAME', 'editorial'),
          user: env('DATABASE_USERNAME', 'editorial'),
          password: env('DATABASE_PASSWORD', ''),
          ssl: false,
        },
        pool: { min: 0, max: 5 },
      },
    };
  }
  return {
    connection: {
      client: 'sqlite',
      connection: {
        filename: path.resolve(process.cwd(), env('DATABASE_FILENAME', '.tmp/data.db')),
      },
      useNullAsDefault: true,
    },
  };
};
export default database;
