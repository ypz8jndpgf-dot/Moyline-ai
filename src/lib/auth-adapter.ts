/**
 * Minimal Auth.js (NextAuth v5) Adapter backed by a JSON file.
 * Only implements what the Email provider + JWT session strategy needs:
 * users, verification tokens. (No database sessions.)
 *
 * Same serverless-ephemerality caveat as the rest of /data — see store.ts.
 */
import type { Adapter, AdapterUser, VerificationToken } from "next-auth/adapters";
import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";

const DATA_DIR = path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "auth.json");

interface AuthDB {
  users: Record<string, AdapterUser>;
  tokens: VerificationToken[];
}

async function readDB(): Promise<AuthDB> {
  try {
    const raw = await fs.readFile(FILE, "utf8");
    return JSON.parse(raw) as AuthDB;
  } catch {
    return { users: {}, tokens: [] };
  }
}

async function writeDB(db: AuthDB): Promise<void> {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(FILE, JSON.stringify(db, null, 2), "utf8");
  } catch {
    /* ephemeral fs — ignore */
  }
}

export function fileAdapter(): Adapter {
  return {
    async createUser(data) {
      const db = await readDB();
      const user: AdapterUser = { ...data, id: data.id || randomUUID(), emailVerified: null };
      db.users[user.id!] = user;
      await writeDB(db);
      return user;
    },
    async getUser(id) {
      const db = await readDB();
      return db.users[id] || null;
    },
    async getUserByEmail(email) {
      const db = await readDB();
      return Object.values(db.users).find((u) => u.email?.toLowerCase() === email.toLowerCase()) || null;
    },
    async updateUser(data) {
      const db = await readDB();
      const existing = db.users[(data as AdapterUser).id!];
      if (!existing) throw new Error("User not found");
      const updated = { ...existing, ...data } as AdapterUser;
      db.users[updated.id!] = updated;
      await writeDB(db);
      return updated;
    },
    async deleteUser(id) {
      const db = await readDB();
      delete db.users[id];
      await writeDB(db);
    },
    async linkAccount() {
      return undefined as never;
    },
    async unlinkAccount() {},
    async createVerificationToken(token) {
      const db = await readDB();
      // prune expired
      db.tokens = db.tokens.filter((t) => new Date(t.expires) > new Date());
      db.tokens.push(token);
      await writeDB(db);
      return token;
    },
    async useVerificationToken({ identifier, token }) {
      const db = await readDB();
      const idx = db.tokens.findIndex((t) => t.identifier === identifier && t.token === token);
      if (idx === -1) return null;
      const [found] = db.tokens.splice(idx, 1);
      await writeDB(db);
      return new Date(found.expires) > new Date() ? found : null;
    },
  };
}
