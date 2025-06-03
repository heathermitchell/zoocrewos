// server.js
const express = require('express');
const { Client } = require('@notionhq/client');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Notion client
const notion = new Client({
  auth: process.env.NOTION_TOKEN || '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'
});

const DATABASE_ID = '200d36e54a7280efa27def519aa21671';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Serve the main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Smart content analysis function
function analyzeContent(text) {
  const textLower = text.toLowerCase();
  
  if (textLower.includes("i'm thinking") || textLower.includes("insight") || textLower.includes("concept")) {
    return {
      contentType: 'Lesson',
      stage: 'Idea',
      theme: 'Identity',
      mapLocation: 'Course 3',
      voiceMode: 'Teacher Mode',
      whoItsFor: 'Heart-led entrepreneurs struggling with authentic expression',
      whyItMatters: 'Helps people move past perfectionism to authentic voice'
    };
  } else if (textLower.includes("turn that into") || textLower.includes("caption") || textLower.includes("post")) {
    return {
      contentType: 'Social Post',
      stage: 'Development',
      theme: 'Visibility',
      mapLocation: 'Content Calendar',
      voiceMode: 'Creator Mode',
      whoItsFor: 'Social media audience seeking authentic content',
      whyItMatters: 'Bridges the gap between insights and shareable content'
    };
  } else if (textLower.includes("don't know where") || textLower.includes("before i forget") || textLower.includes("random")) {
    return {
      contentType: 'Sticky Note',
      stage: 'Idea',
      theme: 'Voice',
      mapLocation: 'Sticky DB',
      voiceMode: 'Voice Memo',
      whoItsFor: 'Future Heather who needs this insight',
      whyItMatters: 'Captures fleeting insights before they disappear'
    };
  } else if (textLower.includes("claude") || textLower.includes("assistant") || textLower.includes("story")) {
    return {
      contentType: 'Blog',
      stage: 'Development',
      theme: 'Voice',
      mapLocation: 'Content Calendar',
      voiceMode: 'Storyteller Mode',
      whoItsFor: 'Entrepreneurs curious about AI collaboration',
      whyItMatters: 'Shows the human side of working with AI tools'
    };
  } else {
    return {
      contentType: 'Concept',
      stage: 'Idea',
      theme: 'Strategy',
      mapLocation: 'Sticky DB',
      voiceMode: 'Auto-Detect',
      whoItsFor: 'To be determined',
      whyItMatters: 'General insight worth preserving'
    };
  }
}

// Generate unique Content ID
function generateContentId() {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substr(2, 5);
  return `${timestamp}_${random}`;
}

// API endpoint to analyze content
app.post('/api/analyze', (req, res) => {
  const { content } = req.body;
  
  if (!content || content.length < 5) {
    return res.json({ error: 'Content too short for analysis' });
  }
  
  const analysis = analyzeContent(content);
  res.json({
    ...analysis,
    preview: content.substring(0, 100) + (content.length > 100 ? '...' : ''),
    confidence: content.length > 20 ? 'High' : 'Medium'
  });
});

// API endpoint to send to Notion
app.post('/api/send-to-notion', async (req, res) => {
  try {
    const { content, analysis } = req.body;
    
    if (!content) {
      return res.status(400).json({ error: 'Content is required' });
    }
    
    const contentAnalysis = analysis || analyzeContent(content);
    const contentId = generateContentId();
    
    // Create the Notion page
    const response = await notion.pages.create({
      parent: {
        database_id: DATABASE_ID
      },
      properties: {
        'Content ID': {
          title: [
            {
              text: {
                content: contentId
              }
            }
          ]
        },
        'Content Type': {
          select: {
            name: contentAnalysis.contentType
          }
        },
        'Short Name': {
          rich_text: [
            {
              text: {
                content: content.substring(0, 50) + (content.length > 50 ? '...' : '')
              }
            }
          ]
        },
        'Title Status': {
          select: {
            name: 'Working'
          }
        },
        'Status': {
          select: {
            name: 'Draft'
          }
        },
        'Stage': {
          select: {
            name: contentAnalysis.stage
          }
        },
        'Theme': {
          select: {
            name: contentAnalysis.theme
          }
        },
        'Map Location': {
          rich_text: [
            {
              text: {
                content: contentAnalysis.mapLocation
              }
            }
          ]
        },
        'Who It\'s For': {
          rich_text: [
            {
              text: {
                content: contentAnalysis.whoItsFor
              }
            }
          ]
        },
        'Why It Matters': {
          rich_text: [
            {
              text: {
                content: contentAnalysis.whyItMatters
              }
            }
          ]
        },
        'Big Idea': {
          rich_text: [
            {
              text: {
                content: content
              }
            }
          ]
        },
        'Source Type': {
          select: {
            name: 'ZooCrewOS'
          }
        },
        'Capture Date': {
          date: {
            start: new Date().toISOString().split('T')[0]
          }
        },
        'Processing Status': {
          select: {
            name: 'Routed'
          }
        },
        'Original Context': {
          rich_text: [
            {
              text: {
                content: `Voice Mode: ${contentAnalysis.voiceMode}, Location: Tucson, Project: Course 3`
              }
            }
          ]
        }
      }
    });
    
    res.json({
      success: true,
      notionUrl: response.url,
      contentId: contentId,
      message: 'Content successfully sent to Notion!'
    });
    
  } catch (error) {
    console.error('Error creating Notion page:', error);
    res.status(500).json({
      error: 'Failed to create Notion page',
      details: error.message
    });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ZooCrewOS is alive and ready!' });
});

app.listen(PORT, () => {
  console.log(`🎯 ZooCrewOS running on port ${PORT}`);
  console.log(`🚀 Visit: http://localhost:${PORT}`);
});