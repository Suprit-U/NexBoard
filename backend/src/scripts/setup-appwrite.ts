/**
 * One-time Appwrite setup script.
 * Run: npm run setup-appwrite
 *
 * Creates the database + all collections + permission policies + indexes.
 * Safe to re-run (idempotent).
 */

import { Client, Databases, DatabasesIndexType, Permission, Role } from 'node-appwrite';
import dotenv from 'dotenv';
dotenv.config();

async function main() {
  const endpoint  = process.env.APPWRITE_ENDPOINT  || 'https://cloud.appwrite.io/v1';
  const projectId = process.env.APPWRITE_PROJECT_ID || '';
  const apiKey    = process.env.APPWRITE_API_KEY    || '';
  const dbId      = process.env.APPWRITE_DB_ID      || 'nexboard-db';
  const colSnapshots = process.env.APPWRITE_COLLECTION_SNAPSHOTS || 'snapshots';
  const colRooms     = 'rooms';
  const colChats     = 'chats';

  if (!projectId || !apiKey) {
    console.error('❌  APPWRITE_PROJECT_ID and APPWRITE_API_KEY must be set in .env');
    process.exit(1);
  }

  const client    = new Client().setEndpoint(endpoint).setProject(projectId).setKey(apiKey);
  const databases = new Databases(client);

  const anyPerms = [
    Permission.read(Role.any()),
    Permission.write(Role.any()),
    Permission.update(Role.any()),
    Permission.delete(Role.any()),
  ];

  // ─── 1. Database ──────────────────────────────────────────────
  console.log(`\n📦  Creating database "${dbId}"...`);
  try {
    await databases.create(dbId, 'NexBoard Database');
    console.log('   ✅  Database created');
  } catch (err: any) {
    // 409 = already exists, 403 = plan limit (meaning it already exists on free tier)
    if (err?.code === 409 || err?.code === 403) {
      console.log('   ℹ️   Database already exists (or plan limit) — continuing');
    } else {
      throw err;
    }
  }

  // ─── Helper ───────────────────────────────────────────────────
  async function ensureCollection(colId: string, name: string) {
    console.log(`\n📄  Creating collection "${colId}"...`);
    try {
      await databases.createCollection(dbId, colId, name, anyPerms);
      console.log('   ✅  Collection created');
    } catch (err: any) {
      if (err?.code === 409) console.log('   ℹ️   Collection already exists — skipping');
      else throw err;
    }
  }

  async function ensureAttr(colId: string, fn: string, args: any[]) {
    try {
      await (databases as any)[fn](dbId, colId, ...args);
      console.log(`   ✅  Attr "${args[0]}" created`);
    } catch (err: any) {
      if (err?.code === 409) console.log(`   ℹ️   Attr "${args[0]}" already exists`);
      else console.warn(`   ⚠️   Attr "${args[0]}": ${err?.message || err}`);
    }
  }

  async function ensureIndex(colId: string, key: string, attrs: string[], orders?: string[]) {
    try {
      await databases.createIndex(dbId, colId, key, DatabasesIndexType.Key, attrs, orders as any);
      console.log(`   ✅  Index "${key}" created`);
    } catch (err: any) {
      if (err?.code === 409) console.log(`   ℹ️   Index "${key}" already exists`);
      else console.warn(`   ⚠️   Index "${key}": ${err?.message || err}`);
    }
  }

  // ─── 2. Snapshots collection ──────────────────────────────────
  await ensureCollection(colSnapshots, 'Canvas Snapshots');
  console.log('🔧  Creating snapshots attributes...');
  await ensureAttr(colSnapshots, 'createStringAttribute', ['roomId',     64,        true]);
  // 1,000,000 chars ≈ 1 MB — enough for a complex canvas
  await ensureAttr(colSnapshots, 'createStringAttribute', ['canvasData', 1_000_000, true]);
  await ensureAttr(colSnapshots, 'createStringAttribute', ['createdAt',  64,        true]);
  await ensureAttr(colSnapshots, 'createStringAttribute', ['updatedAt',  64,        true]);
  console.log('\n🔍  Creating snapshots indexes...');
  await ensureIndex(colSnapshots, 'roomId-idx', ['roomId']);

  // ─── 3. Rooms collection ──────────────────────────────────────
  await ensureCollection(colRooms, 'Rooms');
  console.log('🔧  Creating rooms attributes...');
  await ensureAttr(colRooms, 'createStringAttribute',  ['roomId',      64,  true]);
  await ensureAttr(colRooms, 'createStringAttribute',  ['createdAt',   64,  true]);
  await ensureAttr(colRooms, 'createStringAttribute',  ['lastActive',  64,  true]);
  await ensureAttr(colRooms, 'createIntegerAttribute', ['userCount',   false]);
  await ensureAttr(colRooms, 'createBooleanAttribute', ['hasPassword', false, false]);
  console.log('\n🔍  Creating rooms indexes...');
  await ensureIndex(colRooms, 'roomId-idx', ['roomId']);

  // ─── 4. Chats collection ──────────────────────────────────────
  await ensureCollection(colChats, 'Chat Messages');
  console.log('🔧  Creating chats attributes...');
  await ensureAttr(colChats, 'createStringAttribute', ['roomId',    64,   true]);
  await ensureAttr(colChats, 'createStringAttribute', ['nickname',  64,   true]);
  await ensureAttr(colChats, 'createStringAttribute', ['color',     32,   true]);
  await ensureAttr(colChats, 'createStringAttribute', ['message',   2000, true]);
  await ensureAttr(colChats, 'createStringAttribute', ['timestamp', 64,   true]);
  console.log('\n🔍  Creating chats indexes...');
  await ensureIndex(colChats, 'roomId-idx', ['roomId']);
  // Wait for attributes to be provisioned before creating compound index
  console.log('   ⏳  Waiting 5s for attributes to provision...');
  await new Promise(r => setTimeout(r, 5000));
  await ensureIndex(colChats, 'roomId-timestamp-idx', ['roomId', 'timestamp'], ['ASC', 'ASC']);

  console.log('\n🎉  Appwrite setup complete!\n');
}

main().catch(err => {
  console.error('❌  Setup failed:', err);
  process.exit(1);
});
