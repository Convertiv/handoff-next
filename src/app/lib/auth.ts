import { DrizzleAdapter } from '@auth/drizzle-adapter';
import NextAuth, { type NextAuthConfig } from 'next-auth';
import type { Session } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import GitHub from 'next-auth/providers/github';
import Google from 'next-auth/providers/google';
import { eq } from 'drizzle-orm';
import { getDb } from './db';
import * as schema from './db/schema';
import { usePostgres } from './db/dialect';
import { verifyPassword } from './passwords';
import { logEvent } from './server/event-log';

/** Login providers (GitHub, Google) — used to decide session strategy. */
function loginOauthProviders(): NextAuthConfig['providers'] {
  const list: NextAuthConfig['providers'] = [];
  if (process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET) {
    list.push(GitHub({ clientId: process.env.AUTH_GITHUB_ID, clientSecret: process.env.AUTH_GITHUB_SECRET }));
  }
  if (process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET) {
    list.push(Google({ clientId: process.env.AUTH_GOOGLE_ID, clientSecret: process.env.AUTH_GOOGLE_SECRET }));
  }
  return list;
}

/** Linked-account providers (Figma) — for API access, not login. */
function linkedAccountProviders(): NextAuthConfig['providers'] {
  const list: NextAuthConfig['providers'] = [];
  if (process.env.AUTH_FIGMA_ID && process.env.AUTH_FIGMA_SECRET) {
    list.push({
      id: 'figma',
      name: 'Figma',
      type: 'oauth',
      checks: ['state'],
      clientId: process.env.AUTH_FIGMA_ID,
      clientSecret: process.env.AUTH_FIGMA_SECRET,
      authorization: {
        url: 'https://www.figma.com/oauth',
        params: {
          scope: 'files:read',
          response_type: 'code',
        },
      },
      token: {
        url: 'https://api.figma.com/v1/oauth/token',
      },
      userinfo: {
        url: 'https://api.figma.com/v1/me',
      },
      profile(profile: { id?: string; email?: string; handle?: string; img_url?: string }) {
        const profileId = String(profile.id ?? profile.email ?? profile.handle ?? '');
        return {
          id: profileId || 'figma-user',
          name: profile.handle ?? profile.email ?? 'Figma User',
          email: profile.email ?? null,
          image: profile.img_url ?? null,
        };
      },
    } as NextAuthConfig['providers'][number]);
  }
  return list;
}

// Lazily evaluate DB and providers so this module can be imported at build time
// without triggering database connections or NextAuth initialization errors.
// `typeof window === 'undefined'` guards were insufficient on their own because
// Next.js static analysis runs in a Node environment where window is always undefined.
function getAuthDb() {
  return usePostgres() ? getDb() : null;
}
function getAuthProviders() {
  if (typeof process === 'undefined') return { loginOauth: [], linkedOauth: [] };
  return { loginOauth: loginOauthProviders(), linkedOauth: linkedAccountProviders() };
}

/**
 * NextAuth (Auth.js v5).
 *
 * Lazy-initialized so module import never fails — important for Next.js build-time
 * page collection (e.g. /_not-found) where invalid env vars (AUTH_URL, NEXTAUTH_URL,
 * AUTH_REDIRECT_PROXY_URL) would throw "TypeError: Invalid URL" during module load
 * and crash the whole build. With lazy init, build collection sees no module
 * side-effects; first real request initializes NextAuth.
 *
 * - Adapter is enabled whenever any OAuth providers exist (for account linking/storage).
 * - Sessions always use JWT so Edge middleware can read `request.auth` / admin gates work on Vercel.
 *   (Database sessions + `getToken()` break `/admin` when GitHub/Google OAuth env vars are set.)
 * - Linked-account providers (Figma) use the adapter for token storage only.
 */
type NextAuthInstance = ReturnType<typeof NextAuth>;
let cachedNextAuth: NextAuthInstance | null = null;

function buildNextAuth(): NextAuthInstance {
  const db = getAuthDb();
  const { loginOauth, linkedOauth } = getAuthProviders();
  const hasAnyOAuth = loginOauth.length > 0 || linkedOauth.length > 0;
  const useAdapter = Boolean(db && hasAnyOAuth);

  return NextAuth({
    trustHost: true,
    pages: {
      signIn: '/login',
    },
    adapter:
      useAdapter && db
        ? // schema-active + dual DB: adapter types expect one dialect; runtime matches `getDb()`.
          DrizzleAdapter(db as never, {
            usersTable: schema.users,
            accountsTable: schema.accounts,
            sessionsTable: schema.sessions,
            verificationTokensTable: schema.verificationTokens,
          } as never)
        : undefined,
    session: { strategy: 'jwt' },
  providers: [
    ...loginOauth,
    ...linkedOauth,
    Credentials({
      id: 'handoff-credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        const conn = getDb();
        const email = String(credentials?.email ?? '')
          .trim()
          .toLowerCase();
        const password = String(credentials?.password ?? '');
        if (!email || !password) return null;

        const [u] = await conn.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
        if (!u?.passwordHash) return null;
        const ok = await verifyPassword(password, u.passwordHash);
        if (!ok) return null;

        return {
          id: u.id,
          email: u.email,
          name: u.name ?? u.email,
          role: u.role ?? 'member',
          image: u.image,
        };
      },
    }),
  ],
  callbacks: {
    async signIn() {
      return true;
    },
    async jwt({ token, user, account }) {
      if (account?.provider === 'figma') {
        return token;
      }
      if (user) {
        token.sub = (user as { id?: string }).id ?? token.sub;
        token.role = (user as { role?: string }).role ?? 'member';
        if (user.email) token.email = user.email;
      } else if (token.sub && token.role === undefined) {
        const conn = getDb();
        if (conn) {
          const [row] = await conn.select({ role: schema.users.role }).from(schema.users).where(eq(schema.users.id, token.sub as string)).limit(1);
          token.role = row?.role ?? 'member';
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = (token.sub as string) ?? '';
        session.user.role = (token.role as string) ?? 'member';
      }
      return session;
    },
  },
  events: {
    async signIn(message) {
      const actorUserId = message.user?.id ?? null;
      const provider = message.account?.provider ?? 'unknown';
      await logEvent({
        category: 'auth',
        eventType: 'login.sign_in',
        status: 'success',
        actorUserId,
        route: '/api/auth',
        provider,
        metadata: {
          provider,
          isNewUser: Boolean(message.isNewUser),
          email: message.user?.email ?? null,
        },
      });
    },
  },
    secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
  });
}

function getNextAuth(): NextAuthInstance {
  if (!cachedNextAuth) {
    cachedNextAuth = buildNextAuth();
  }
  return cachedNextAuth;
}

/** GET/POST handlers for `/api/auth/[...nextauth]`. Initialized lazily. */
export const handlers = {
  GET: (...args: Parameters<NextAuthInstance['handlers']['GET']>) => getNextAuth().handlers.GET(...args),
  POST: (...args: Parameters<NextAuthInstance['handlers']['POST']>) => getNextAuth().handlers.POST(...args),
};

export const signIn: NextAuthInstance['signIn'] = (...args) => getNextAuth().signIn(...args);
export const signOut: NextAuthInstance['signOut'] = (...args) => getNextAuth().signOut(...args);

/** Postgres: NextAuth session. Local hybrid mode (no DATABASE_URL): no session. */
export async function auth(): Promise<Session | null> {
  if (!usePostgres()) return null;
  return (await getNextAuth().auth()) as Session | null;
}
