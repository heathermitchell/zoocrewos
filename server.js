
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
  'G': {
    name: 'G',
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
    for (const [clientId, client] of clients.entries()) {
      if (client.ws === ws) {
        console.log(`${client.identity} disconnected`);
        clients.delete(clientId);
        broadcast({
          type: 'user_disconnected',
          user: client.identity,
          timestamp: new Date().toISOString()
        }, clientId);
        break;
      }
    }
  });

  ws.send(JSON.stringify({
    type: 'connection_established',
    message: 'Connected to ZooCrewOS Chat',
    timestamp: new Date().toISOString()
  }));
});

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

function handleIdentification(ws, data) {
  const { identity, clientId } = data;

  if (!TEAM_MEMBERS[identity]) {
    ws.send(JSON.stringify({
      type: 'error',
      message: 'Invalid team member identity'
    }));
    return;
  }

  clients.set(clientId, {
    ws,
    identity,
    connectedAt: new Date().toISOString(),
    lastSeen: new Date().toISOString()
  });

  console.log(`${identity} connected with ID: ${clientId}`);

  ws.send(JSON.stringify({
    type: 'identification_confirmed',
    identity,
    teamMember: TEAM_MEMBERS[identity],
    connectedUsers: getConnectedUsers(),
    timestamp: new Date().toISOString()
  }));

  broadcast({
    type: 'user_connected',
    user: identity,
    teamMember: TEAM_MEMBERS[identity],
    connectedUsers: getConnectedUsers(),
    timestamp: new Date().toISOString()
  }, clientId);

  sendMessageHistory(ws);
}

function handleChatMessage(ws, data) {
  const { message, clientId, tags = [], pinned = false } = data;

  const client = clients.get(clientId);
  if (!client) {
    ws.send(JSON.stringify({
      type: 'error',
      message: 'Client not identified'
    }));
    return;
  }

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

  messageHistory.push(chatMessage);
  if (messageHistory.length > MAX_HISTORY) {
    messageHistory.shift();
  }

  client.lastSeen = new Date().toISOString();

  console.log(`Message from ${client.identity}: ${message.substring(0, 50)}...`);

  broadcast(chatMessage);
}

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

function sendMessageHistory(ws) {
  ws.send(JSON.stringify({
    type: 'message_history',
    messages: messageHistory.slice(-20),
    timestamp: new Date().toISOString()
  }));
}

function broadcast(message, excludeClientId = null) {
  const messageStr = JSON.stringify(message);

  clients.forEach((client, clientId) => {
    if (clientId !== excludeClientId && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(messageStr);
    }
  });
}

function getConnectedUsers() {
  return Array.from(clients.values()).map(client => ({
    identity: client.identity,
    teamMember: TEAM_MEMBERS[client.identity],
    connectedAt: client.connectedAt,
    lastSeen: client.lastSeen
  }));
}

function generateMessageId() {
  return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    connectedClients: clients.size,
    messageHistory: messageHistory.length,
    timestamp: new Date().toISOString()
  });
});

app.post('/api/send-message', (req, res) => {
  const { identity, message, tags = [] } = req.body;

  if (!TEAM_MEMBERS[identity]) {
    return res.status(400).json({ error: 'Invalid identity' });
  }

  if (!message || message.trim().length === 0) {
    return res.status(400).json({ error: 'Message is required' });
  }

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

  messageHistory.push(chatMessage);
  if (messageHistory.length > MAX_HISTORY) {
    messageHistory.shift();
  }

  broadcast(chatMessage);

  res.json({
    success: true,
    messageId: chatMessage.id,
    timestamp: chatMessage.timestamp
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 ZooCrewOS WebSocket Server running on port ${PORT}`);
});
