import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db/prisma";
import type { RoleName } from "@/generated/prisma/client";
import {
  clearLoginFailures,
  isLockedOut,
  recordLoginFailure,
} from "@/lib/auth/lockout";
import { logger } from "@/lib/logger";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      firstName: string;
      lastName: string;
      role: RoleName;
    };
  }
  interface User {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: RoleName;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    firstName: string;
    lastName: string;
    role: RoleName;
  }
}

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;
        const email = credentials.email.trim().toLowerCase();

        if (isLockedOut(email).locked) {
          logger.warn("login attempt on locked account", { email });
          return null;
        }

        const user = await prisma.user.findUnique({
          where: { email },
          include: { role: true },
        });

        if (!user || !user.isActive) {
          recordLoginFailure(email);
          return null;
        }

        const valid = await bcrypt.compare(credentials.password, user.passwordHash);
        if (!valid) {
          const result = recordLoginFailure(email);
          if (result.locked) {
            logger.warn("account locked due to repeated failures", {
              userId: user.id,
              until: new Date(result.until).toISOString(),
            });
          }
          return null;
        }

        clearLoginFailures(email);

        return {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role.name,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.firstName = user.firstName;
        token.lastName = user.lastName;
        token.role = user.role;
      }
      return token;
    },
    async session({ session, token }) {
      session.user = {
        id: token.id,
        email: token.email!,
        firstName: token.firstName,
        lastName: token.lastName,
        role: token.role,
      };
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
    maxAge: 8 * 60 * 60, // 8 hours
  },
};
