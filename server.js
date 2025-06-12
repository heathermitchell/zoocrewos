// WebSocket Server for ZooCrewOS 3-Way Chat
// Real-time communication between Heather, Emmy, and Galen

const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Store connected clients and their identities
const clients = new Map();
const messageHistory = [];
const MAX_HISTORY = 100;

// Serve static files
app.use(express.static('public'));
app.use(express.json());

// Team member configurations
const TEAM_MEMBERS = {
  'heather': {
    name: 'Heather',
    emoji: '🦎✨',
    color: '#8B5CF6',
    role: 'Visionary Leader'
  },
  'emmy': {
    name: 'Emmy',
    emoji: '🐕🐙', 
    color: '#F59E0B',
    role: 'Creative Strategist'
  },
  'galen': {
    name: 'Galen',
    emoji: '🐢',
    color: '#10B981',
    role: 'Systems Architect'
  }
};

// WebSocket connection handler
wss.on('connection', (ws, request) => {
  console.log('New WebSocket connection established');
  
  // Handle client messages
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data);
      handleMessage(ws, message);
    } catch (error) {
      console.error('Error parsing message:', error);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Invalid message format'
      }));
    }
  });

  // Handle disconnection
  ws.on('close', () => {
    // Find and remove disconnected client
    for (const [clientId, client] of clients.entries()) {
      if (client.ws === ws) {
        console.log(`${client.identity} disconnected`);
        clients.delete(clientId);
        
        // Notify other clients
        broadcast({
          type: 'user_disconnected',
          user: client.identity,
          timestamp: new Date().toISOString()
        }, clientId);
        break;
      }
    }
  });

  // Send connection confirmation
  ws.send(JSON.stringify({
    type: 'connection_established',
    message: 'Connected to ZooCrewOS Chat',
    timestamp: new Date().toISOString()
  }));
});

// Handle different message types
function handleMessage(ws, message) {
  const { type, ...data } = message;

  switch (type) {
    case 'identify':
      handleIdentification(ws, data);
      break;
    
    case 'chat_message':
      handleChatMessage(ws, data);
      break;
    
    case 'ping':
      ws.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
      break;
    
    case 'request_history':
      sendMessageHistory(ws);
      break;
    
    case 'typing_indicator':
      handleTypingIndicator(ws, data);
      break;
    
    default:
      ws.send(JSON.stringify({
        type: 'error',
        message: `Unknown message type: ${type}`
      }));
  }
}

// Handle user identification
function handleIdentification(ws, data) {
  const { identity, clientId } = data;
  
  if (!TEAM_MEMBERS[identity]) {
    ws.send(JSON.stringify({
      type: 'error',
      message: 'Invalid team member identity'
    }));
    return;
  }

  // Store client info
  clients.set(clientId, {
    ws,
    identity,
    connectedAt: new Date().toISOString(),
    lastSeen: new Date().toISOString()
  });

  console.log(`${identity} connected with ID: ${clientId}`);

  // Send confirmation to client
  ws.send(JSON.stringify({
    type: 'identification_confirmed',
    identity,
    teamMember: TEAM_MEMBERS[identity],
    connectedUsers: getConnectedUsers(),
    timestamp: new Date().toISOString()
  }));

  // Notify other clients
  broadcast({
    type: 'user_connected',
    user: identity,
    teamMember: TEAM_MEMBERS[identity],
    connectedUsers: getConnectedUsers(),
    timestamp: new Date().toISOString()
  }, clientId);

  // Send recent message history
  sendMessageHistory(ws);
}

// Handle chat messages
function handleChatMessage(ws, data) {
  const { message, clientId, tags = [], pinned = false } = data;
  
  // Find sender identity
  const client = clients.get(clientId);
  if (!client) {
    ws.send(JSON.stringify({
      type: 'error',
      message: 'Client not identified'
    }));
    return;
  }

  // Create message object
  const chatMessage = {
    id: generateMessageId(),
    type: 'chat_message',
    sender: client.identity,
    senderInfo: TEAM_MEMBERS[client.identity],
    message: message.trim(),
    tags,
    pinned,
    timestamp: new Date().toISOString()
  };

  // Add to message history
  messageHistory.push(chatMessage);
  
  // Keep history manageable
  if (messageHistory.length > MAX_HISTORY) {
    messageHistory.shift();
  }

  // Update client last seen
  client.lastSeen = new Date().toISOString();

  console.log(`Message from ${client.identity}: ${message.substring(0, 50)}...`);

  // Broadcast to all connected clients
  broadcast(chatMessage);
}

// Handle typing indicators
function handleTypingIndicator(ws, data) {
  const { clientId, isTyping } = data;
  
  const client = clients.get(clientId);
  if (!client) return;

  broadcast({
    type: 'typing_indicator',
    user: client.identity,
    isTyping,
    timestamp: new Date().toISOString()
  }, clientId);
}

// Send message history to a specific client
function sendMessageHistory(ws) {
  ws.send(JSON.stringify({
    type: 'message_history',
    messages: messageHistory.slice(-20), // Send last 20 messages
    timestamp: new Date().toISOString()
  }));
}

// Broadcast message to all connected clients
function broadcast(message, excludeClientId = null) {
  const messageStr = JSON.stringify(message);
  
  clients.forEach((client, clientId) => {
    if (clientId !== excludeClientId && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(messageStr);
    }
  });
}

// Get list of connected users
function getConnectedUsers() {
  return Array.from(clients.values()).map(client => ({
    identity: client.identity,
    teamMember: TEAM_MEMBERS[client.identity],
    connectedAt: client.connectedAt,
    lastSeen: client.lastSeen
  }));
}

// Generate unique message ID
function generateMessageId() {
  return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    connectedClients: clients.size,
    messageHistory: messageHistory.length,
    timestamp: new Date().toISOString()
  });
});

// API endpoint for external integrations (for AI agents)
app.post('/api/send-message', (req, res) => {
  const { identity, message, tags = [] } = req.body;
  
  if (!TEAM_MEMBERS[identity]) {
    return res.status(400).json({ error: 'Invalid identity' });
  }

  if (!message || message.trim().length === 0) {
    return res.status(400).json({ error: 'Message is required' });
  }

  // Create message object
  const chatMessage = {
    id: generateMessageId(),
    type: 'chat_message',
    sender: identity,
    senderInfo: TEAM_MEMBERS[identity],
    message: message.trim(),
    tags,
    pinned: false,
    timestamp: new Date().toISOString(),
    source: 'api'
  };

  // Add to history
  messageHistory.push(chatMessage);
  if (messageHistory.length > MAX_HISTORY) {
    messageHistory.shift();
  }

  // Broadcast to all connected clients
  broadcast(chatMessage);

  res.json({ 
    success: true, 
    messageId: chatMessage.id,
    timestamp: chatMessage.timestamp 
  });
});
// Add these endpoints to your server.js file

// Emmy AI Response Endpoint
app.post("/api/emmy-response", (req, res) => {
  try {
    const { message, sender, timestamp, type } = req.body;
    
    console.log("Emmy Response Received:", {
      sender,
      message: message ? message.substring(0, 100) + "..." : "No message",
      timestamp,
      type
    });

    // Validate required fields
    if (!message || !sender) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: message and sender"
      });
    }

    // Create message object for WebSocket broadcast
    const aiMessage = {
      id: Date.now().toString(),
      sender: sender,
      message: message,
      timestamp: timestamp || new Date().toISOString(),
      type: type || "ai_response",
      source: "n8n_emmy"
    };

    // Broadcast to all connected WebSocket clients
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({
          type: "ai_message",
          data: aiMessage
        }));
      }
    });

    // Log successful broadcast
    console.log("Emmy message broadcasted to", wss.clients.size, "clients");

    // Return success response
    res.json({
      success: true,
      message: "Emmy response processed and broadcasted",
      messageId: aiMessage.id,
      clientCount: wss.clients.size
    });

  } catch (error) {
    console.error("Emmy Response Error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to process Emmy response",
      details: error.message
    });
  }
});

// Galen AI Response Endpoint  
app.post("/api/galen-response", (req, res) => {
  try {
    const { message, sender, timestamp, type } = req.body;
    
    console.log("Galen Response Received:", {
      sender,
      message: message ? message.substring(0, 100) + "..." : "No message",
      timestamp,
      type
    });

    // Validate required fields
    if (!message || !sender) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: message and sender"
      });
    }

    // Create message object for WebSocket broadcast
    const aiMessage = {
      id: Date.now().toString(),
      sender: sender,
      message: message,
      timestamp: timestamp || new Date().toISOString(),
      type: type || "ai_response",
      source: "n8n_galen"
    };

    // Broadcast to all connected WebSocket clients
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({
          type: "ai_message",
          data: aiMessage
        }));
      }
    });

    // Log successful broadcast
    console.log("Galen message broadcasted to", wss.clients.size, "clients");

    // Return success response
    res.json({
      success: true,
      message: "Galen response processed and broadcasted",
      messageId: aiMessage.id,
      clientCount: wss.clients.size
    });

  } catch (error) {
    console.error("Galen Response Error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to process Galen response",
      details: error.message
    });
  }
});

// Optional: Health check endpoint for AI integrations
app.get("/api/ai-status", (req, res) => {
  res.json({
    success: true,
    endpoints: {
      emmy: "/api/emmy-response",
      galen: "/api/galen-response"
    },
    websocket_clients: wss.clients.size,
    server_time: new Date().toISOString()
  });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 ZooCrewOS WebSocket Server running on port ${PORT}`);
  console.log(`📡 WebSocket endpoint: ws://localhost:${PORT}`);
  console.log(`🌐 HTTP endpoint: http://localhost:${PORT}`);
  console.log(`💜 Ready for Emmy, Galen, and Heather to connect!`);
});