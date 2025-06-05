const express = require('express');
const { Client } = require('@notionhq/client');
const cors = require('cors');
const path = require('path');
const admin = require('firebase-admin');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Notion client
const notion = new Client({
    auth: process.env.NOTION_TOKEN
});

// Initialize Firebase Admin
admin.initializeApp({
    credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
    }),
    storageBucket: 'zoocrewos-transcriptstorage.firebasestorage.app'
});

const bucket = admin.storage().bucket();

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

// Transcript upload endpoint for Firebase + Notion integration
app.post('/api/upload-transcript', async (req, res) => {
    try {
        const { 
            transcript_content, 
            agent = 'Unknown', 
            conversation_name = 'Untitled',
            short_name,
            description 
        } = req.body;
        
        if (!transcript_content) {
            return res.status(400).json({ error: 'transcript_content is required' });
        }
        
        // Generate filename: YYYY-MM-DD_AGENT_CONVO-TITLE.md
        const date = new Date();
        const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
        const cleanConvoName = conversation_name.replace(/[^a-zA-Z0-9-]/g, '-');
        const filename = `${dateStr}_${agent}_${cleanConvoName}.md`;
        
        // Upload to Firebase Storage
        const file = bucket.file(`transcripts/2025/${dateStr.substring(0, 7)}/${filename}`);
        
        await file.save(transcript_content, {
            metadata: {
                contentType: 'text/markdown',
                metadata: {
                    agent: agent,
                    conversationName: conversation_name,
                    uploadDate: date.toISOString()
                }
            }
        });
        
        // Make file publicly accessible
        await file.makePublic();
        
        // Get public URL
        const transcript_url = `https://storage.googleapis.com/zoocrewos-transcriptstorage.firebasestorage.app/transcripts/2025/${dateStr.substring(0, 7)}/${filename}`;
        
        // Create Notion entry with transcript_url
        const notionResponse = await notion.pages.create({
            parent: {
                database_id: DATABASE_ID
            },
            properties: {
                'Short Name': {
                    title: [
                        {
                            text: {
                                content: short_name || `${agent} - ${conversation_name}`
                            }
                        }
                    ]
                },
                'Description': {
                    rich_text: [
                        {
                            text: {
                                content: description || `Transcript: ${conversation_name}`
                            }
                        }
                    ]
                },
                'H_Notes': {
                    rich_text: [
                        {
                            text: {
                                content: `Auto-generated transcript upload. Agent: ${agent}, Date: ${dateStr}`
                            }
                        }
                    ]
                },
                'transcript_url': {
                    rich_text: [
                        {
                            text: {
                                content: transcript_url
                            }
                        }
                    ]
                }
            }
        });

        res.json({
            success: true,
            transcript_url: transcript_url,
            notion_url: notionResponse.url,
            filename: filename,
            message: 'Transcript successfully uploaded to Firebase and linked in Notion!'
        });

    } catch (error) {
        console.error('Error uploading transcript:', error);
        res.status(500).json({
            error: 'Failed to upload transcript',
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