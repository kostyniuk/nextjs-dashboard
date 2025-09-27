import type { NextAuthConfig } from 'next-auth';
 
export const authConfig = {
  pages: {
    signIn: '/login',
  },
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const isOnDashboard = nextUrl.pathname.startsWith('/dashboard');
      const isOnSeed = nextUrl.pathname.startsWith('/seed');
      
      if (isOnDashboard) {
        console.log(nextUrl);
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
