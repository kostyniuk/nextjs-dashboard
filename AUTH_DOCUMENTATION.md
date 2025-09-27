# Authentication and Authorization Documentation

## Overview

This Next.js dashboard application uses **NextAuth.js v5 (beta)** for authentication and authorization. The system provides secure user authentication with PostgreSQL database integration and route protection through middleware.

## Table of Contents

1. [Authentication Setup](#authentication-setup)
2. [Middleware Protection](#middleware-protection)
3. [Checking Authentication Status](#checking-authentication-status)
4. [Authentication Flow](#authentication-flow)
5. [Authorization Levels](#authorization-levels)
6. [Database Integration](#database-integration)
7. [Key Files](#key-files)
8. [Usage Examples](#usage-examples)
9. [Current Limitations](#current-limitations)

## Authentication Setup

### Main Configuration (`auth.ts`)

The authentication system is configured in the main `auth.ts` file:

```typescript
import NextAuth, { User } from 'next-auth';
import { authConfig } from './auth.config';
import Credentials from 'next-auth/providers/credentials';
import { z } from 'zod';
import postgres from 'postgres';
import bcrypt from 'bcrypt';

const sql = postgres(process.env.POSTGRES_URL!, { ssl: 'require' });

async function getUser(email: string): Promise<User | undefined> {
  try {
    const user = await sql<User[]>`SELECT * FROM users WHERE email=${email}`;
    return user[0];
  } catch (error) {
    console.error('Failed to fetch user:', error);
    throw new Error('Failed to fetch user.');
  }
}

export const { auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [Credentials({
    async authorize(credentials) {
      const parsedCredentials = z.object({ 
        email: z.string().email(), 
        password: z.string().min(6) 
      }).safeParse(credentials);
      
      if (parsedCredentials.success) {
        const { email, password } = parsedCredentials.data;
        const user = await getUser(email);
        if (!user) return null;
        const passwordsMatch = await bcrypt.compare(password, user.password);
        if (passwordsMatch) return user;
      }
      
      return null;
    }
  })],
});
```

### Route Protection (`auth.config.ts`)

```typescript
import type { NextAuthConfig } from 'next-auth';

export const authConfig = {
  pages: {
    signIn: '/login', // Custom login page
  },
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const isOnDashboard = nextUrl.pathname.startsWith('/dashboard');
      const isOnSeed = nextUrl.pathname.startsWith('/seed');
      
      if (isOnDashboard) {
        if (isLoggedIn) return true;
        return false; // Redirect unauthenticated users to login page
      } else if (isOnSeed) {
        return true; // Allow access to seed route without authentication
      } else if (isLoggedIn) {
        return Response.redirect(new URL('/dashboard', nextUrl));
      }
      return true;
    },
  },
  providers: [], 
} satisfies NextAuthConfig;
```

## Middleware Protection

### Middleware Configuration (`middleware.ts`)

```typescript
import NextAuth from 'next-auth';
import { authConfig } from './auth.config';

export default NextAuth(authConfig).auth;

export const config = {
  // https://nextjs.org/docs/app/building-your-application/routing/middleware#matcher
  matcher: ['/((?!api|_next/static|_next/image|.*\\.png$).*)'],
};
```

The middleware:
- Runs on **every request** matching the specified pattern
- Protects `/dashboard/*` routes (requires authentication)
- Allows `/seed` routes without authentication
- Redirects authenticated users away from login page to dashboard
- Redirects unauthenticated users from protected routes to login

## Checking Authentication Status

### In Server Components

To check if someone is logged in and get user details in server components, use the `auth()` function:

```typescript
import { auth } from '@/auth';

export default async function MyServerComponent() {
  const session = await auth();
  
  if (!session) {
    // User is not logged in
    return <div>Please log in</div>;
  }
  
  // User is logged in
  const user = session.user;
  console.log('Logged in user:', user.email, user.name);
  
  return <div>Welcome, {user.name}!</div>;
}
```

### In Client Components

For client components, use the `useSession` hook:

```typescript
'use client';
import { useSession } from 'next-auth/react';

export default function MyClientComponent() {
  const { data: session, status } = useSession();
  
  if (status === 'loading') {
    return <div>Loading...</div>;
  }
  
  if (!session) {
    return <div>Please log in</div>;
  }
  
  // User is logged in
  const user = session.user;
  return <div>Welcome, {user.name}!</div>;
}
```

## Authentication Flow

### 1. Login Process

1. User visits `/login` page
2. `LoginForm` component (client-side) calls `authenticate` server action
3. Server action calls `signIn('credentials', formData)`
4. NextAuth validates credentials against database
5. If valid, session is created and user is redirected to dashboard

### 2. Session Management

- NextAuth handles session storage (typically in cookies)
- Middleware checks authentication on every request
- Protected routes require valid session

### 3. Logout Process

1. `SideNav` component has a sign-out form
2. Calls `signOut({ redirectTo: '/' })` server action
3. Session is destroyed and user redirected to home

## Authorization Levels

The current system has basic authorization:

- **Unauthenticated users:** Can access `/login`, `/seed`, and public routes
- **Authenticated users:** Can access all dashboard routes (`/dashboard/*`)
- **No role-based permissions:** All authenticated users have the same access level

## Database Integration

### User Schema

The authentication system integrates with PostgreSQL using the following user schema:

```typescript
export type User = {
  id: string;
  name: string;
  email: string;
  password: string; // Hashed with bcrypt
};
```

### Database Operations

- User credentials are stored in the `users` table
- Passwords are hashed using bcrypt
- User lookup happens during login via `getUser(email)` function

## Key Files

| File | Purpose |
|------|---------|
| `auth.ts` | Main auth configuration and database integration |
| `auth.config.ts` | Route protection rules |
| `middleware.ts` | Request-level authentication checks |
| `app/lib/actions.ts` | Server actions for login/logout |
| `app/ui/login-form.tsx` | Client-side login form |
| `app/ui/dashboard/sidenav.tsx` | Logout functionality |
| `app/login/page.tsx` | Login page component |

## Usage Examples

### Login Form Implementation

```typescript
'use client';

import { authenticate } from '@/app/lib/actions';
import { useActionState } from 'react';

export default function LoginForm() {
  const [errorMessage, formAction, isPending] = useActionState(
    authenticate,
    undefined,
  );  
  
  return (
    <form action={formAction} className="space-y-3">
      {/* Form fields */}
      <input type="email" name="email" required />
      <input type="password" name="password" required />
      <button type="submit" aria-disabled={isPending}>
        Log in
      </button>
      {errorMessage && <p className="text-red-500">{errorMessage}</p>}
    </form>
  );
}
```

### Server Action for Authentication

```typescript
'use server';

import { AuthError } from 'next-auth';
import { signIn } from '@/auth';

export async function authenticate(
  prevState: string | undefined,
  formData: FormData,
) {
  try {
    await signIn('credentials', formData);
  } catch (error) {
    if (error instanceof AuthError) {
      switch (error.type) {
        case 'CredentialsSignin':
          return 'Invalid credentials.';
        default:
          return 'Something went wrong.';
      }
    }
    throw error;
  }
}
```

### Logout Implementation

```typescript
import { signOut } from '@/auth';

export default function SideNav() {
  const handleSignOut = async () => {
    'use server';
    await signOut({ redirectTo: '/' });
  };

  return (
    <div>
      {/* Navigation items */}
      <form action={handleSignOut}>
        <button type="submit">Sign Out</button>
      </form>
    </div>
  );
}
```

## Current Limitations

The current implementation is quite basic:

- ❌ No role-based access control
- ❌ No user-specific data filtering
- ❌ No session refresh mechanism
- ❌ Limited to email/password authentication only
- ❌ No password reset functionality
- ❌ No account registration flow

## Dependencies

Key dependencies for the authentication system:

```json
{
  "next-auth": "5.0.0-beta.29",
  "bcrypt": "^5.1.1",
  "postgres": "^3.4.6",
  "zod": "^3.25.17"
}
```

## Environment Variables

Required environment variables:

```env
POSTGRES_URL=your_postgres_connection_string
NEXTAUTH_SECRET=your_secret_key
NEXTAUTH_URL=http://localhost:3000
```

## Security Considerations

- Passwords are hashed using bcrypt
- HTTPS should be used in production
- Session cookies are secure by default
- Middleware provides request-level protection
- Database queries use parameterized statements

## Future Enhancements

Consider implementing:

- Role-based access control (RBAC)
- Multi-factor authentication (MFA)
- Social authentication providers
- Password reset functionality
- User registration flow
- Session management improvements
- API route protection
- User-specific data filtering
