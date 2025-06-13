// ZooCrewOS Railway Server - Complete Integration
// WebSocket + Firebase + Notion + n8n Integration

const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const path = require('path');

// Firebase Admin SDK
const admin = require('firebase-admin');

// Notion Client
const { Client } = require('@notionhq/client');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Initialize Firebase Admin
let firebaseApp;
try {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
  firebaseApp = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: `${serviceAccount.project_id}.appspot.com`
  });
  console.log('✅ Firebase Admin initialized successfully');
} catch (error) {
  console.error('❌ Firebase initialization failed:', error.message);
}

// Initialize Notion Client
const notion = new Client({
  auth: process.env.NOTION_TOKEN
});

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

  // Save to Firebase Storage (async, don't wait)
  saveConversationToFirebase().catch(err => 
    console.error('Firebase save error:', err.message)
  );
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

// Firebase Storage Functions
async function saveConversationToFirebase() {
  if (!firebaseApp || messageHistory.length === 0) return;

  try {
    const bucket = admin.storage().bucket();
    const timestamp = new Date().toISOString();
    const filename = `conversations/chat_${timestamp.split('T')[0]}_${Date.now()}.json`;
    
    const conversationData = {
      timestamp,
      messages: messageHistory,
      participants: getConnectedUsers(),
      messageCount: messageHistory.length
    };

    const file = bucket.file(filename);
    await file.save(JSON.stringify(conversationData, null, 2), {
      metadata: {
        contentType: 'application/json'
      }
    });

    console.log('✅ Conversation saved to Firebase:', filename);
    return filename;
  } catch (error) {
    console.error('❌ Firebase save error:', error.message);
    throw error;
  }
}

// Notion Integration Functions
async function saveToNotion(content, analysis = {}) {
  try {
    const response = await notion.pages.create({
      parent: {
        database_id: process.env.NOTION_DATABASE_ID
      },
      properties: {
        'Short Name': {
          title: [
            {
              text: {
                content: content.substring(0, 100) + (content.length > 100 ? '...' : '')
              }
            }
          ]
        },
        'Description': {
          rich_text: [
            {
              text: {
                content: content
              }
            }
          ]
        },
        'H Notes': {
          rich_text: [
            {
              text: {
                content: `Auto-generated via ZooCrewOS. Analysis: ${JSON.stringify(analysis)}`
              }
            }
          ]
        }
      }
    });

    console.log('✅ Content saved to Notion:', response.id);
    return response;
  } catch (error) {
    console.error('❌ Notion save error:', error.message);
    throw error;
  }
}

// API Endpoints

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    connectedClients: clients.size,
    messageHistory: messageHistory.length,
    services: {
      firebase: !!firebaseApp,
      notion: !!process.env.NOTION_TOKEN,
      websocket: wss.clients.size
    },
    timestamp: new Date().toISOString()
  });
});

// Manual message sending (for n8n integration)
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

// Helper function to extract message from different AI response formats
function extractMessage(data) {
  // Handle OpenAI simplified output format (Galen)
  if (typeof data.message === 'string') {
    return data.message;
  }
  
  // Handle Anthropic format (Emmy)
  if (data.content && Array.isArray(data.content) && data.content[0] && data.content[0].text) {
    return data.content[0].text;
  }
  
  // Handle direct message string
  if (typeof data === 'string') {
    return data;
  }
  
  // Fallback: look for any text content
  if (data.text) {
    return data.text;
  }
  
  return null;
}

// Emmy AI Response Endpoint (for n8n)
app.post('/api/emmy-response', (req, res) => {
  try {
    const extractedMessage = extractMessage(req.body);
    const { timestamp } = req.body;

    if (!extractedMessage) {
      console.log('Emmy request body:', JSON.stringify(req.body, null, 2));
      return res.status(400).json({
        success: false,
        error: 'Message could not be extracted from request',
        receivedData: req.body
      });
    }

    const aiMessage = {
      id: generateMessageId(),
      type: 'chat_message',
      sender: 'emmy',
      senderInfo: TEAM_MEMBERS['emmy'],
      message: extractedMessage.trim(),
      tags: ['ai-response'],
      pinned: false,
      timestamp: timestamp || new Date().toISOString(),
      source: 'n8n'
    };

    messageHistory.push(aiMessage);
    if (messageHistory.length > MAX_HISTORY) {
      messageHistory.shift();
    }

    broadcast(aiMessage);

    console.log('✅ Emmy AI response processed:', extractedMessage.substring(0, 50) + '...');

    res.json({
      success: true,
      messageId: aiMessage.id,
      timestamp: aiMessage.timestamp
    });

  } catch (error) {
    console.error('❌ Emmy response error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process Emmy response',
      details: error.message
    });
  }
});

// Galen AI Response Endpoint (for n8n)
app.post('/api/galen-response', (req, res) => {
  try {
    const extractedMessage = extractMessage(req.body);
    const { timestamp } = req.body;

    if (!extractedMessage) {
      console.log('Galen request body:', JSON.stringify(req.body, null, 2));
      return res.status(400).json({
        success: false,
        error: 'Message could not be extracted from request',
        receivedData: req.body
      });
    }

    const aiMessage = {
      id: generateMessageId(),
      type: 'chat_message',
      sender: 'galen',
      senderInfo: TEAM_MEMBERS['galen'],
      message: extractedMessage.trim(),
      tags: ['ai-response'],
      pinned: false,
      timestamp: timestamp || new Date().toISOString(),
      source: 'n8n'
    };

    messageHistory.push(aiMessage);
    if (messageHistory.length > MAX_HISTORY) {
      messageHistory.shift();
    }

    broadcast(aiMessage);

    console.log('✅ Galen AI response processed:', extractedMessage.substring(0, 50) + '...');

    res.json({
      success: true,
      messageId: aiMessage.id,
      timestamp: aiMessage.timestamp
    });

  } catch (error) {
    console.error('❌ Galen response error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process Galen response',
      details: error.message
    });
  }
});

// Content capture endpoint (like the original chirpee functionality)
app.post('/api/capture-content', async (req, res) => {
  try {
    const { content, tags = [] } = req.body;

    if (!content || content.trim().length === 0) {
      return res.status(400).json({ error: 'Content is required' });
    }

    // Save to Notion
    const notionResponse = await saveToNotion(content, { tags });

    // Save conversation snapshot to Firebase
    const firebaseFile = await saveConversationToFirebase();

    res.json({
      success: true,
      notionId: notionResponse.id,
      firebaseFile,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Content capture error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to capture content'
    });
  }
});

// AI Status endpoint
app.get('/api/ai-status', (req, res) => {
  res.json({
    success: true,
    endpoints: {
      emmy: '/api/emmy-response',
      galen: '/api/galen-response'
    },
    websocket_clients: wss.clients.size,
    services: {
      firebase: !!firebaseApp,
      notion: !!process.env.NOTION_TOKEN
    },
    server_time: new Date().toISOString()
  });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 ZooCrewOS Server running on port ${PORT}`);
  console.log(`📡 WebSocket ready for real-time chat`);
  console.log(`🔥 Firebase integration: ${firebaseApp ? 'ACTIVE' : 'INACTIVE'}`);
  console.log(`📝 Notion integration: ${process.env.NOTION_TOKEN ? 'ACTIVE' : 'INACTIVE'}`);
  console.log(`💜 Ready for Emmy, Galen, and Heather!`);
});