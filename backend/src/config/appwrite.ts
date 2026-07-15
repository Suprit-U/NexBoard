import { Client, Databases, ID, Query } from 'node-appwrite';

const client = new Client()
  .setEndpoint(process.env.APPWRITE_ENDPOINT || 'https://cloud.appwrite.io/v1')
  .setProject(process.env.APPWRITE_PROJECT_ID || '')
  .setKey(process.env.APPWRITE_API_KEY || '');

const DATABASE_ID = process.env.APPWRITE_DB_ID || 'nexboard-db';
const COLLECTION_SNAPSHOTS = process.env.APPWRITE_COLLECTION_SNAPSHOTS || 'snapshots';

const databases = new Databases(client);

export { databases, DATABASE_ID, COLLECTION_SNAPSHOTS, ID, Query };
