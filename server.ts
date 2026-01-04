import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleWebSocket } from "./controllers/signaling.ts";
import { handleAdmin } from "./controllers/admin.ts";
import { serveDir } from "https://deno.land/std@0.168.0/http/file_server.ts";

// Global state
const users = new Map();
const adminTokens = new Map();
const gameState = {
  active: false,
  currentNumber: null,
  calledNumbers: [],
  players: [],
  winner: null
};

// Main handler
async function handler(req: Request): Promise<Response> {
  const { pathname } = new URL(req.url);

  // WebSocket route
  if (pathname === "/ws") {
    // Only upgrade WebSocket requests
    if (req.headers.get("upgrade") !== "websocket") {
      return new Response("Expected websocket", { status: 400 });
    }
    const { socket, response } = Deno.upgradeWebSocket(req);
    handleWebSocket(socket, users, gameState); // your existing logic
    return response;
  }

  // Admin route
  if (pathname.startsWith("/admin")) {
    return handleAdmin(req, adminTokens);
  }

  // Serve static files
  return serveDir(req, { fsRoot: "./public", showDirListing: false });
}

// Deno Deploy uses serve(handler) without port
serve(handler);
