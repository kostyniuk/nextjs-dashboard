# NextAuth.js v5 Internal Workings - How It Really Works

## Overview

This document explains exactly how NextAuth.js v5 works internally, focusing on the stateless JWT-based authentication system used in this Next.js dashboard application.

## Table of Contents

1. [Stateless JWT Authentication](#stateless-jwt-authentication)
2. [Cookie Management](#cookie-management)
3. [The `auth` Object Explained](#the-auth-object-explained)
6. [Security Implementation](#security-implementation)
7. [Code Examples](#code-examples)

## Stateless JWT Authentication

### What Makes It Stateless

NextAuth.js v5 uses **JSON Web Tokens (JWTs)** for session management, making it truly stateless:

- ✅ **No database lookups** for authentication checks
- ✅ **No external service calls** for session validation
- ✅ **No session storage** on the server
- ✅ **Works completely offline** once logged in
- ✅ **User data embedded in the token** itself

### JWT Structure

When a user logs in, NextAuth.js creates a JWT with this structure:

```json
{
  "header": {
    "alg": "HS256",
    "typ": "JWT"
  },
  "payload": {
    "sub": "user_123",                    // User ID
    "name": "John Doe",                   // User's name
    "email": "john@example.com",          // User's email
    "iat": 1640995200,                    // Issued at timestamp
    "exp": 1643673600,                    // Expiration (30 days default)
    "jti": "unique_token_id"              // JWT ID
  },
  "signature": "HMACSHA256_signature_here"
}
```

## Cookie Management

### Cookie Creation

Upon successful login, NextAuth.js sets an HTTP-only cookie:

```markdown:/Users/kostyniuk/engineering/next/nextjs-dashboard/NEXTAUTH_INTERNAL_WORKINGS.md
<code_block_to_apply_changes_from>
```
Name: next-auth.session-token
Value: eyJhbGciOiJkaXIiLCJlbmMiOiJBMjU2R0NNIn0... (encrypted JWT)
Properties:
  - HttpOnly: true     // Cannot be accessed by JavaScript (XSS protection)
  - Secure: true       // Only sent over HTTPS (in production)
  - SameSite: Lax      // CSRF protection
  - Path: /            // Available on all paths
  - Max-Age: 2592000   // 30 days expiration
```

### Cookie Reading

On every request, NextAuth.js:
1. Reads the `next-auth.session-token` cookie from request headers
2. Decodes the JWT (base64 decoding - no network call)
3. Verifies the signature using `NEXTAUTH_SECRET`
4. Checks expiration timestamp
5. Returns user data from JWT payload

### How the `auth` Object is Created

In your middleware (`auth.config.ts`):

```typescript
authorized({ auth, request: { nextUrl } }) {
  const isLoggedIn = !!auth?.user; // ← This is where the magic happens!
}
```

Here's exactly what NextAuth.js does internally:

```typescript
// Internal NextAuth.js process (simplified)
function createAuthObject(request) {
  // 1. Read cookie from request headers
  const cookieValue = request.headers.cookie
    .split(';')
    .find(c => c.trim().startsWith('next-auth.session-token='))
    ?.split('=')[1];
    
  if (!cookieValue) return null;
  
  // 2. Decode JWT (no network call - just base64 decoding)
  const [header, payload, signature] = cookieValue.split('.');
  const decodedPayload = JSON.parse(atob(payload));
  
  // 3. Verify signature (no network call - just cryptographic math)
  const expectedSignature = HMACSHA256(
    header + '.' + payload,
    process.env.NEXTAUTH_SECRET
  );
  
  if (expectedSignature !== signature) return null;
  
  // 4. Check expiration (no network call - just timestamp comparison)
  if (Date.now() / 1000 > decodedPayload.exp) return null;
  
  // 5. Return auth object with user data from JWT
  return {
    user: {
      id: decodedPayload.sub,
      name: decodedPayload.name,
      email: decodedPayload.email
    },
    session: {
      user: {
        id: decodedPayload.sub,
        name: decodedPayload.name,
        email: decodedPayload.email
      },
      expires: new Date(decodedPayload.exp * 1000).toISOString()
    }
  };
}
```

### Auth Object Structure

When user is authenticated:
```typescript
auth = {
  user: {
    id: "user_123",
    name: "John Doe",
    email: "john@example.com"
  },
  session: {
    user: {
      id: "user_123", 
      name: "John Doe",
      email: "john@example.com"
    },
    expires: "2024-01-15T10:30:00.000Z"
  }
}
```

When user is NOT authenticated:
```typescript
auth = null
```

## Security Implementation

### Secret Key Management

The `NEXTAUTH_SECRET` environment variable is used for:

```env
# .env.local
NEXTAUTH_SECRET=your-super-secret-key-here
```

**Important**: This is NOT "server state" - it's just configuration data used for cryptographic operations.

### Security Features

1. **HTTP-only cookies**: Cannot be accessed by JavaScript (XSS protection)
2. **Secure flag**: Only sent over HTTPS in production
3. **SameSite protection**: CSRF protection
4. **JWT expiration**: Automatic session expiration (30 days default)
5. **Signed tokens**: JWT signature verification prevents tampering
6. **No sensitive data in JWT**: Only user ID, name, and email

### What the Secret Key Does

```typescript
// When creating JWT (during login)
const signature = HMACSHA256(
  base64(header) + "." + base64(payload),
  NEXTAUTH_SECRET  // ← Used to sign the token
);

// When verifying JWT (on every request)
const expectedSignature = HMACSHA256(
  base64(header) + "." + base64(payload), 
  NEXTAUTH_SECRET  // ← Same secret to verify authenticity
);

if (expectedSignature === jwt.signature) {
  // Token is authentic - user data is valid
  return { user: jwt.payload.user };
}
```

## Code Examples

### Server Component Usage

```typescript
import { auth } from '@/auth';

export default async function MyServerComponent() {
  const session = await auth(); // ← Reads JWT from cookie, no database call!
  
  if (!session) {
    return <div>Please log in</div>;
  }
  
  return <div>Welcome, {session.user.name}!</div>;
}
```

### Client Component Usage

```typescript
'use client';
import { useSession } from 'next-auth/react';

export default function MyClientComponent() {
  const { data: session, status } = useSession();
  
  if (status === 'loading') return <div>Loading...</div>;
  if (!session) return <div>Please log in</div>;
  
  return <div>Welcome, {session.user.name}!</div>;
}
```

## Database Usage

### When Database IS Accessed

The database is only used during:

1. **Initial Login** (`auth.ts`):
   ```typescript
   async authorize(credentials) {
     const user = await getUser(email); // ← Database call
     const passwordsMatch = await bcrypt.compare(password, user.password);
     return passwordsMatch ? user : null;
   }
   ```

2. **Sign Out** (optional - can invalidate tokens):
   ```typescript
   await signOut({ redirectTo: '/' }); // Clears cookie
   ```

### When Database is NOT Accessed

- ✅ **Every middleware check** - uses JWT only
- ✅ **Every server component** - uses JWT only  
- ✅ **Every client component** - uses JWT only
- ✅ **Route protection** - uses JWT only
- ✅ **Session validation** - uses JWT only

## Performance Benefits

### Stateless Advantages

- **No database load** for authentication checks
- **No external service dependencies** 
- **Works in environments with intermittent connectivity**
- **Horizontally scalable** (no shared session state)
- **Fast authentication** (just JWT validation)

### Comparison: Stateful vs Stateless

**Stateful (Database Sessions)**:
```typescript
// Requires network calls on every request
const session = await db.sessions.findById(sessionId); // Database call
const user = await db.users.findById(session.userId);   // Database call
```

**Your Stateless JWT**:
```typescript
// No network calls needed
const jwt = decodeCookie(cookie); // Just decode
const isValid = verifySignature(jwt, secret); // Just crypto math
const user = jwt.payload.user; // Data already in token
```

## Summary

NextAuth.js v5 provides **truly stateless authentication**:

- ✅ **JWT-based sessions** with user data embedded
- ✅ **HTTP-only cookies** for secure storage
- ✅ **Cryptographic signature verification** using `NEXTAUTH_SECRET`
- ✅ **Complete offline capability** once logged in
- ✅ **No database lookups** for authentication checks
- ✅ **Fast and scalable** authentication system

The "server" I mentioned earlier is just your Next.js application process doing cryptographic math with a secret key - no external dependencies or state storage required!

This makes your authentication system both secure and performant, working seamlessly online and offline.
```
