import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { serveDir } from "https://deno.land/std@0.168.0/http/file_server.ts";
import { handleWebSocket } from "./controllers/signaling.ts";
import { handleAdmin } from "./controllers/admin.ts";

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

// Password hash (in production, use bcrypt or similar)
const ADMIN_PASSWORD = "we17me78";

// Generate secure token
function generateToken(): string {
  return crypto.randomUUID() + '_' + Date.now().toString(36);
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
    };
    
    socket.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data);
        await handleWebSocketMessage(socket, data, userIp);
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
  if (url.pathname.startsWith("/admin")) {
    // Serve admin.html for /admin path
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
      uptime: process.uptime()
    }), {
      headers: { "Content-Type": "application/json" }
    });
  }
  
  // Serve main index.html
  return serveDir(req, {
    fsRoot: "frontend",
    urlRoot: "",
    showDirListing: false,
    enableCors: true
  });
}

// Handle WebSocket messages
async function handleWebSocketMessage(socket: WebSocket, data: any, ip: string) {
  switch (data.type) {
    case "user_join":
      handleUserJoin(socket, data, ip);
      break;
      
    case "admin_auth":
      handleAdminAuth(socket, data);
      break;
      
    case "get_stats":
      handleGetStats(socket, data);
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
      
    default:
      console.log("Unknown message type:", data.type);
  }
}

// Handle user joining
function handleUserJoin(socket: WebSocket, data: any, ip: string) {
  const userId = data.userId || `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const username = data.username || `Player_${Math.random().toString(36).substr(2, 5)}`;
  
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

// Handle admin authentication
function handleAdminAuth(socket: WebSocket, data: any) {
  if (verifyAdminPassword(data.password)) {
    const token = generateToken();
    const userId = `admin_${Date.now()}`;
    
    // Find or create admin user
    let adminUser = Array.from(users.values()).find(u => 
      u.socket === socket
    );
    
    if (!adminUser) {
      adminUser = {
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
    } else {
      adminUser.isAdmin = true;
      adminUser.token = token;
    }
    
    // Store token
    adminTokens.set(token, {
      userId: adminUser.id,
      expires: Date.now() + (24 * 60 * 60 * 1000) // 24 hours
    });
    
    // Send success response
    socket.send(JSON.stringify({
      type: "auth_response",
      success: true,
      token,
      message: "Authentication successful"
    }));
    
    console.log("Admin authenticated:", adminUser.id);
  } else {
    socket.send(JSON.stringify({
      type: "auth_response",
      success: false,
      message: "Invalid password"
    }));
  }
}

// Handle admin commands
function handleAdminCommand(socket: WebSocket, data: any) {
  // Verify admin token
  const token = data.token;
  const tokenData = adminTokens.get(token);
  
  if (!tokenData || tokenData.expires < Date.now()) {
    socket.send(JSON.stringify({
      type: "command_response",
      success: false,
      message: "Invalid or expired token"
    }));
    return;
  }
  
  const adminUser = users.get(tokenData.userId);
  if (!adminUser || !adminUser.isAdmin) {
    socket.send(JSON.stringify({
      type: "command_response",
      success: false,
      message: "Unauthorized"
    }));
    return;
  }
  
  // Execute admin command
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
      // Implement winner announcement logic
      break;
      
    case "broadcast_message":
      broadcastMessage(data.data?.message || "Admin broadcast");
      break;
      
    case "update_prize_pool":
      // Implement prize pool update
      break;
      
    case "get_users":
      sendUserList(socket);
      break;
  }
  
  socket.send(JSON.stringify({
    type: "command_response",
    success: true,
    message: `Command "${data.command}" executed`
  }));
}

// Handle RTC signaling messages
function handleRTCMessage(socket: WebSocket, data: any) {
  const targetUser = users.get(data.targetUserId);
  if (targetUser && targetUser.socket.readyState === WebSocket.OPEN) {
    // Forward the RTC message to target user
    targetUser.socket.send(JSON.stringify({
      ...data,
      fromUserId: Array.from(users.entries())
        .find(([_, u]) => u.socket === socket)?.[0]
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
  // Implement game logic here
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
function handleGetStats(socket: WebSocket, data: any) {
  socket.send(JSON.stringify({
    type: "stats_update",
    data: {
      totalUsers: users.size,
      activeGames: gameState.active ? 1 : 0,
      totalRevenue: calculateRevenue(),
      serverStatus: "online"
    }
  }));
}

// Calculate revenue (mock function)
function calculateRevenue(): number {
  return users.size * 25; // Example: 25 ETB per user
}

// Broadcast user list to all users
function broadcastUserList() {
  const userList = Array.from(users.values()).map(user => ({
    id: user.id,
    username: user.username,
    status: user.status,
    ip: user.ip
  }));
  
  broadcastToAll({
    type: "users_list",
    users: userList
  });
}

// Send user list to specific socket
function sendUserList(socket: WebSocket) {
  const userList = Array.from(users.values()).map(user => ({
    id: user.id,
    username: user.username,
    status: user.status,
    ip: user.ip
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
      user.socket.send(messageStr);
    }
  });
}

// Handle disconnection
function handleDisconnection(socket: WebSocket) {
  const userId = Array.from(users.entries())
    .find(([_, u]) => u.socket === socket)?.[0];
  
  if (userId) {
    users.delete(userId);
    broadcastUserList();
    console.log("User disconnected:", userId);
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

// Start server
const port = 8080;
console.log(`Server running on http://localhost:${port}`);
serve(handler, { port });