const axios = require('axios');
import admin from 'firebase-admin';

console.log('Initializing Firebase Admin SDK...');
// Initialize Firebase Admin SDK
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

console.log('Firebase Admin SDK initialized successfully.');

const db = admin.firestore();

export default async function handler(req, res) {
  // Enable CORS for local development
  const allowedOrigins = [
    'http://localhost:5173',
    'https://dice-mice-character-creator.vercel.app',
  ];
  const origin = req.headers.origin;

  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end(); // Handle preflight request
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { code } = req.query;
  if (!code) {
    return res.status(400).json({ error: 'Missing authorization code' });
  }

  try {
    console.log('Exchanging code for access token...');

    // Exchange code for an access token
    const tokenResponse = await axios.post(
      'https://discord.com/api/oauth2/token',
      new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: process.env.DISCORD_REDIRECT_URI,
      }).toString(),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }
    );

    const { access_token } = tokenResponse.data;
    if (!access_token) {
      console.error('Failed to retrieve access token:', tokenResponse.data);
      return res.status(500).json({ error: 'Failed to retrieve access token' });
    }

    // Fetch user info from Discord
    const userResponse = await axios.get('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${access_token}` },
    });

    console.log('Discord user data:', userResponse.data);

    const discordUser = userResponse.data;

    // Generate a Firebase custom token
    const firebaseToken = await admin.auth().createCustomToken(discordUser.id, {
      username: discordUser.username,
      avatar: discordUser.avatar,
    });

    try {
      console.log('Generating Firebase token for user:', discordUser.id);
      const firebaseToken = await admin
        .auth()
        .createCustomToken(discordUser.id, {
          username: discordUser.username,
          avatar: discordUser.avatar,
        });
      console.log('Firebase token generated:', firebaseToken);
    } catch (error) {
      console.error('Error generating Firebase token:', error);
      return res.status(500).json({
        error: 'Failed to generate Firebase token',
        details: error.toString(),
      });
    }

    console.log('Saving user data in Firestore...');
    // Save user data in Firestore (or update if they exist)
    const userRef = db.collection('players').doc(discordUser.id);
    await userRef.set(
      {
        id: discordUser.id,
        username: discordUser.username,
        email: discordUser.email || '', // Discord does not always provide an email
        avatar: discordUser.avatar,
        lastLogin: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true } // Only update fields that change
    );
    console.log('User data saved successfully.');

    return res.json({ firebaseToken });
  } catch (error) {
    console.error('Error during Discord OAuth:', error);
    return res.status(500).json({ error: 'Authentication failed' });
  }
}
