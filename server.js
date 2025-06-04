const express = require('express');
const { Client } = require('@notionhq/client');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Notion client
const notion = new Client({
    auth: process.env.NOTION_TOKEN
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
    
    if (textLower.includes("i'm thinking") || textLower.includes("insight")) {
        return {
            contentType: 'Lesson',
            mapLocation: 'Course 3',
            voiceMode: 'Teacher Mode'
        };
    } else if (textLower.includes("turn that into") || textLower.includes("remix")) {
        return {
            contentType: 'Social Post',
            mapLocation: 'Content Calendar',
            voiceMode: 'Creator Mode'
        };
    } else if (textLower.includes("don't know where") || textLower.includes("chirpy")) {
        return {
            contentType: 'Sticky Note',
            mapLocation: 'Sticky DB',
            voiceMode: 'Voice Memo'
        };
    } else {
        return {
            contentType: 'Concept',
            mapLocation: 'Sticky DB',
            voiceMode: 'Auto-Detect'
        };
    }
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

// API endpoint to send to Notion - FIXED VERSION
app.post('/api/send-to-notion', async (req, res) => {
    try {
        const { content, analysis } = req.body;
        
        if (!content) {
            return res.status(400).json({ error: 'Content is required' });
        }

        // Create the page with our 3 fields
        const response = await notion.pages.create({
            parent: {
                database_id: DATABASE_ID
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
                'H_Notes': {
                    rich_text: [
                        {
                            text: {
                                content: `Auto-generated via ZooCrewOS. Voice Mode: ${analysis?.voiceMode || 'Auto-Detect'}, Content Type: ${analysis?.contentType || 'Concept'}, Routed to: ${analysis?.mapLocation || 'Sticky DB'}`
                            }
                        }
                    ]
                }
            }
        });

        res.json({
            success: true,
            notionUrl: response.url,
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

// Webhook endpoint for G (and others) to post directly
app.post('/api/webhook', async (req, res) => {
    try {
        const { shortName, content, contentType, ...otherFields } = req.body;
        
        // Short name is required
        if (!shortName) {
            return res.status(400).json({ error: 'shortName is required' });
        }
        
        // Use content analysis if contentType not provided
        let analysis = {};
        if (contentType) {
            // Use provided contentType for routing
            if (contentType.toLowerCase() === 'lessons') {
                analysis = { contentType: 'Lesson', mapLocation: 'Course 3', voiceMode: 'Teacher Mode' };
            } else if (contentType.toLowerCase() === 'social') {
                analysis = { contentType: 'Social Post', mapLocation: 'Content Calendar', voiceMode: 'Creator Mode' };
            } else if (contentType.toLowerCase() === 'concept') {
                analysis = { contentType: 'Concept', mapLocation: 'Sticky DB', voiceMode: 'Auto-Detect' };
            } else {
                analysis = { contentType: 'Concept', mapLocation: 'Sticky DB', voiceMode: 'Auto-Detect' };
            }
        } else if (content) {
            // Analyze content if no contentType provided
            analysis = analyzeContent(content);
        } else {
            // Default if only shortName provided
            analysis = { contentType: 'Concept', mapLocation: 'Sticky DB', voiceMode: 'Auto-Detect' };
        }
        
        // Create Notion page
        const response = await notion.pages.create({
            parent: {
                database_id: DATABASE_ID
            },
            properties: {
                'Short Name': {
                    title: [
                        {
                            text: {
                                content: shortName
                            }
                        }
                    ]
                },
                'Description': {
                    rich_text: [
                        {
                            text: {
                                content: content || shortName
                            }
                        }
                    ]
                },
                'H_Notes': {
                    rich_text: [
                        {
                            text: {
                                content: `Auto-generated via ZooCrewOS webhook. Voice Mode: ${analysis.voiceMode}, Content Type: ${analysis.contentType}, Routed to: ${analysis.mapLocation}`
                            }
                        }
                    ]
                }
            }
        });

        res.json({
            success: true,
            notionUrl: response.url,
            message: 'Content successfully sent to Notion via webhook!',
            analysis: analysis
        });

    } catch (error) {
        console.error('Error in webhook:', error);
        res.status(500).json({
            error: 'Failed to process webhook',
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
});