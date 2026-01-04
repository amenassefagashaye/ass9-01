// backend/server.ts - FIXED FOR DENO COMPATIBILITY
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { serveDir } from "https://deno.land/std@0.168.0/http/file_server.ts";

// Types
interface User {
  id: string;
  username: string;
  socket: WebSocket;
  ip: string;
  status: 'online' | 'offline';
  isAdmin: boolean;
  token?: string;
  lastSeen: number;
}

interface GameState {
  active: boolean;
  currentNumber: number | null;
  calledNumbers: number[];
  players: string[];
  winner: string | null;
}

// Global state
const users = new Map<string, User>();
const adminTokens = new Map<string, { userId: string; expires: number }>();
const gameState: GameState = {
  active: false,
  currentNumber: null,
  calledNumbers: [],
  players: [],
  winner: null
};

// Password (in production, use environment variable)
const ADMIN_PASSWORD = "we17me78";

// Generate secure token
function generateToken(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  const token = Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
  return token + '_' + Date.now().toString(36);
}

// Verify admin password
function verifyAdminPassword(password: string): boolean {
  return password === ADMIN_PASSWORD;
}

// Main server handler
async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  
  // Handle WebSocket connections
  if (req.headers.get("upgrade") === "websocket") {
    const { socket, response } = Deno.upgradeWebSocket(req);
    const userIp = req.headers.get("x-forwarded-for") || 
                   req.headers.get("x-real-ip") || 
                   "unknown";
    
    // Handle WebSocket connection
    socket.onopen = () => {
      console.log("WebSocket connection opened");
      // Send welcome message immediately
      socket.send(JSON.stringify({
        type: "welcome",
        message: "Connected to Assefa Digital Bingo Server",
        timestamp: Date.now()
      }));
    };
    
    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleWebSocketMessage(socket, data, userIp);
      } catch (error) {
        console.error("Error handling message:", error);
      }
    };
    
    socket.onclose = () => {
      handleDisconnection(socket);
    };
    
    socket.onerror = (error) => {
      console.error("WebSocket error:", error);
    };
    
    return response;
  }
  
  // Serve static files from frontend directory
  if (url.pathname === "/admin" || url.pathname === "/") {
    try {
      const html = await Deno.readTextFile("./frontend/index.html");
      return new Response(html, {
        headers: { 
          "Content-Type": "text/html",
          "Cache-Control": "no-cache"
        }
      });
    } catch (error) {
      console.error("Error reading index.html:", error);
      return new Response("Admin dashboard not found", { status: 404 });
    }
  }
  
  // Serve other static files
  if (url.pathname.startsWith("/assets/") || url.pathname.endsWith(".js") || url.pathname.endsWith(".css")) {
    return serveDir(req, {
      fsRoot: "frontend",
      urlRoot: "",
      showDirListing: false,
      enableCors: true
    });
  }
  
  // API endpoints
  if (url.pathname === "/api/stats") {
    return new Response(JSON.stringify({
      totalUsers: users.size,
      activeGames: gameState.active ? 1 : 0,
      totalRevenue: 0,
      serverStatus: "online",
      uptime: Math.floor(performance.now() / 1000) // Using performance.now() instead of process.uptime()
    }), {
      headers: { "Content-Type": "application/json" }
    });
  }
  
  // Default response
  return new Response("Assefa Digital Bingo Server", {
    headers: { "Content-Type": "text/plain" }
  });
}

// Handle WebSocket messages
function handleWebSocketMessage(socket: WebSocket, data: any, ip: string) {
  console.log("Received message type:", data.type);
  
  switch (data.type) {
    case "user_join":
      handleUserJoin(socket, data, ip);
      break;
      
    case "admin_auth":
      handleAdminAuth(socket, data);
      break;
      
    case "get_stats":
      handleGetStats(socket);
      break;
      
    case "admin_command":
      handleAdminCommand(socket, data);
      break;
      
    case "rtc_offer":
    case "rtc_answer":
    case "ice_candidate":
      handleRTCMessage(socket, data);
      break;
      
    case "call_number":
      handleCallNumber(socket, data);
      break;
      
    case "mark_number":
      handleMarkNumber(socket, data);
      break;
      
    case "announce_win":
      handleAnnounceWin(socket, data);
      break;
      
    case "client_connected":
      // Handle client connection without authentication
      const tempId = `temp_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      const tempUser: User = {
        id: tempId,
        username: "Guest",
        socket,
        ip,
        status: 'online',
        isAdmin: false,
        lastSeen: Date.now()
      };
      users.set(tempId, tempUser);
      break;
      
    default:
      console.log("Unknown message type:", data.type);
      socket.send(JSON.stringify({
        type: "error",
        message: "Unknown message type"
      }));
  }
}

// Handle user joining
function handleUserJoin(socket: WebSocket, data: any, ip: string) {
  const userId = data.userId || `user_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  const username = data.username || `Player_${Math.random().toString(36).substring(2, 5)}`;
  
  const user: User = {
    id: userId,
    username,
    socket,
    ip,
    status: 'online',
    isAdmin: false,
    lastSeen: Date.now()
  };
  
  users.set(userId, user);
  
  // Send welcome message
  socket.send(JSON.stringify({
    type: "welcome",
    message: "Welcome to Assefa Digital Bingo!",
    userId,
    gameState
  }));
  
  // Broadcast user list update
  broadcastUserList();
}

// Handle admin authentication - SIMPLIFIED AND FIXED
function handleAdminAuth(socket: WebSocket, data: any) {
  console.log("Admin auth attempt, password provided:", data.password ? "Yes" : "No");
  console.log("Expected password:", ADMIN_PASSWORD);
  
  if (verifyAdminPassword(data.password)) {
    console.log("Password verification SUCCESS");
    
    const token = generateToken();
    const userId = `admin_${Date.now()}`;
    
    // Remove any existing temp user for this socket
    const existingUserId = Array.from(users.entries())
      .find(([_, u]) => u.socket === socket)?.[0];
    if (existingUserId) {
      users.delete(existingUserId);
    }
    
    // Create admin user
    const adminUser: User = {
      id: userId,
      username: "Admin",
      socket,
      ip: "admin",
      status: 'online',
      isAdmin: true,
      token,
      lastSeen: Date.now()
    };
    
    users.set(userId, adminUser);
    
    // Store token
    adminTokens.set(token, {
      userId: adminUser.id,
      expires: Date.now() + (24 * 60 * 60 * 1000) // 24 hours
    });
    
    console.log("Admin user created:", userId);
    
    // Send success response
    socket.send(JSON.stringify({
      type: "auth_response",
      success: true,
      token,
      message: "Authentication successful"
    }));
    
    // Send initial stats
    handleGetStats(socket);
    
  } else {
    console.log("Password verification FAILED");
    console.log("Received:", data.password);
    console.log("Expected:", ADMIN_PASSWORD);
    
    socket.send(JSON.stringify({
      type: "auth_response",
      success: false,
      message: "Invalid password"
    }));
  }
}

// Handle admin commands
function handleAdminCommand(socket: WebSocket, data: any) {
  // Check if user is admin
  const user = Array.from(users.values()).find(u => u.socket === socket);
  
  if (!user || !user.isAdmin) {
    socket.send(JSON.stringify({
      type: "command_response",
      success: false,
      message: "Unauthorized - Not an admin"
    }));
    return;
  }
  
  // Execute admin command
  console.log("Executing admin command:", data.command);
  
  switch (data.command) {
    case "start_game":
      gameState.active = true;
      gameState.currentNumber = null;
      gameState.calledNumbers = [];
      gameState.winner = null;
      broadcastGameState();
      break;
      
    case "pause_game":
      gameState.active = false;
      broadcastGameState();
      break;
      
    case "reset_game":
      gameState.active = false;
      gameState.currentNumber = null;
      gameState.calledNumbers = [];
      gameState.winner = null;
      broadcastGameState();
      break;
      
    case "announce_winner":
      const winnerName = data.data?.winner || "Anonymous";
      broadcastMessage(`🎉 Winner announced: ${winnerName}!`);
      break;
      
    case "broadcast_message":
      const broadcastMsg = data.data?.message || "Admin broadcast";
      broadcastMessage(broadcastMsg);
      break;
      
    case "update_prize_pool":
      const amount = data.data?.amount || 0;
      broadcastMessage(`💰 Prize pool updated to ${amount} ETB`);
      break;
      
    case "get_users":
      sendUserList(socket);
      break;
  }
  
  socket.send(JSON.stringify({
    type: "command_response",
    success: true,
    message: `Command "${data.command}" executed successfully`
  }));
}

// Handle RTC signaling messages
function handleRTCMessage(socket: WebSocket, data: any) {
  const targetUser = users.get(data.targetUserId);
  if (targetUser && targetUser.socket.readyState === WebSocket.OPEN) {
    // Forward the RTC message to target user
    const fromUserId = Array.from(users.entries())
      .find(([_, u]) => u.socket === socket)?.[0];
    
    targetUser.socket.send(JSON.stringify({
      ...data,
      fromUserId: fromUserId
    }));
  }
}

// Handle number calling
function handleCallNumber(socket: WebSocket, data: any) {
  if (!gameState.active) return;
  
  const number = data.number;
  if (number >= 1 && number <= 90 && !gameState.calledNumbers.includes(number)) {
    gameState.calledNumbers.push(number);
    gameState.currentNumber = number;
    
    // Broadcast to all users
    broadcastToAll({
      type: "number_called",
      number,
      calledNumbers: gameState.calledNumbers
    });
  }
}

// Handle number marking
function handleMarkNumber(socket: WebSocket, data: any) {
  // Update user's game state
  // This would be implemented based on your game logic
  console.log("Number marked:", data);
}

// Handle win announcement
function handleAnnounceWin(socket: WebSocket, data: any) {
  const user = Array.from(users.values()).find(u => u.socket === socket);
  if (user && data.pattern) {
    gameState.winner = user.id;
    
    broadcastToAll({
      type: "winner_announced",
      winner: {
        id: user.id,
        username: user.username,
        pattern: data.pattern
      }
    });
  }
}

// Handle get stats
function handleGetStats(socket: WebSocket) {
  // Calculate revenue
  const revenue = calculateRevenue();
  
  socket.send(JSON.stringify({
    type: "stats_update",
    data: {
      totalUsers: users.size,
      activeGames: gameState.active ? 1 : 0,
      totalRevenue: revenue,
      serverStatus: "online",
      timestamp: Date.now()
    }
  }));
  
  // Also send user list
  sendUserList(socket);
}

// Calculate revenue (mock function)
function calculateRevenue(): number {
  return Array.from(users.values())
    .filter(user => !user.id.startsWith('temp_'))
    .length * 25; // Example: 25 ETB per user
}

// Broadcast user list to all users
function broadcastUserList() {
  const userList = Array.from(users.values())
    .filter(user => !user.id.startsWith('temp_'))
    .map(user => ({
      id: user.id,
      username: user.username,
      status: user.status,
      ip: user.ip,
      isAdmin: user.isAdmin
    }));
  
  broadcastToAll({
    type: "users_list",
    users: userList
  });
}

// Send user list to specific socket
function sendUserList(socket: WebSocket) {
  const userList = Array.from(users.values())
    .filter(user => !user.id.startsWith('temp_'))
    .map(user => ({
      id: user.id,
      username: user.username,
      status: user.status,
      ip: user.ip,
      isAdmin: user.isAdmin
    }));
  
  socket.send(JSON.stringify({
    type: "users_list",
    users: userList
  }));
}

// Broadcast game state
function broadcastGameState() {
  broadcastToAll({
    type: "game_state",
    state: gameState
  });
}

// Broadcast message to all users
function broadcastMessage(message: string) {
  broadcastToAll({
    type: "broadcast",
    message,
    timestamp: Date.now()
  });
}

// Broadcast to all connected users
function broadcastToAll(message: any) {
  const messageStr = JSON.stringify(message);
  users.forEach(user => {
    if (user.socket.readyState === WebSocket.OPEN) {
      try {
        user.socket.send(messageStr);
      } catch (error) {
        console.error("Error sending to user:", user.id, error);
      }
    }
  });
}

// Handle disconnection
function handleDisconnection(socket: WebSocket) {
  const userId = Array.from(users.entries())
    .find(([_, u]) => u.socket === socket)?.[0];
  
  if (userId) {
    users.delete(userId);
    console.log("User disconnected:", userId);
    
    // Broadcast updated user list
    setTimeout(() => broadcastUserList(), 100);
  }
}

// Cleanup expired tokens periodically
setInterval(() => {
  const now = Date.now();
  adminTokens.forEach((value, key) => {
    if (value.expires < now) {
      adminTokens.delete(key);
    }
  });
}, 60 * 1000); // Every minute

// Cleanup temporary users periodically
setInterval(() => {
  const now = Date.now();
  users.forEach((user, userId) => {
    if (userId.startsWith('temp_') && (now - user.lastSeen) > 5 * 60 * 1000) {
      users.delete(userId);
      console.log("Cleaned up temporary user:", userId);
    }
  });
}, 2 * 60 * 1000); // Every 2 minutes

// Start server
const port = parseInt(Deno.env.get("PORT") || "8080");
console.log(`🚀 Server starting on http://localhost:${port}`);
console.log(`🔐 Admin password: ${ADMIN_PASSWORD}`);
console.log(`📁 Serving frontend from: ./frontend/`);

// Handle Deno permissions
try {
  await serve(handler, { port });
} catch (error) {
  console.error("Failed to start server:", error);
  Deno.exit(1);
}
