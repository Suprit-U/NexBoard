import { Client, Databases, DatabasesIndexType } from 'node-appwrite';
import dotenv from 'dotenv';
dotenv.config();

const c = new Client()
  .setEndpoint(process.env.APPWRITE_ENDPOINT!)
  .setProject(process.env.APPWRITE_PROJECT_ID!)
  .setKey(process.env.APPWRITE_API_KEY!);
const d = new Databases(c);

setTimeout(async () => {
  try {
    await d.createIndex(
      process.env.APPWRITE_DB_ID!,
      process.env.APPWRITE_COLLECTION_SNAPSHOTS!,
      'roomId-index', DatabasesIndexType.Key, ['roomId']
    );
    console.log('✅ Index created');
  } catch (e: any) {
    console.log('⚠️', e.message);
  }
}, 5000);
