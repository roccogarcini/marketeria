import { handlers } from "@/auth";

// Política de acceso: public (flujo NextAuth: login, callback, logout).
export const { GET, POST } = handlers;
