/**
 * One-time Gmail OAuth2 token generator.
 * Run locally: node get-gmail-token.js
 * Then copy the printed refresh token into your GitHub repository secrets.
 *
 * Prerequisites:
 *   1. Create a Google Cloud project at https://console.cloud.google.com
 *   2. Enable the Gmail API
 *   3. Create OAuth 2.0 credentials (Desktop application type)
 *   4. Download credentials and set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET below
 *      (or pass as environment variables)
 *
 * Usage:
 *   GMAIL_CLIENT_ID=your_id GMAIL_CLIENT_SECRET=your_secret node get-gmail-token.js
 */

import { google } from 'googleapis';
import http from 'http';
import { URL } from 'url';

const CLIENT_ID = process.env.GMAIL_CLIENT_ID;
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;
const REDIRECT_URI = 'http://localhost:3000/oauth2callback';

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('ERROR: Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET environment variables.');
  console.error('Example:');
  console.error('  GMAIL_CLIENT_ID=xxx GMAIL_CLIENT_SECRET=yyy node get-gmail-token.js');
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.metadata',
];

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: SCOPES,
  prompt: 'consent',
});

console.log('\n================================================');
console.log('Gmail OAuth2 Token Generator');
console.log('================================================');
console.log('\nStep 1: Open this URL in your browser:\n');
console.log(authUrl);
console.log('\nStep 2: Sign in and grant access.');
console.log('Step 3: You will be redirected back here automatically.\n');
console.log('Waiting for authorization...\n');

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost:3000');
    const code = url.searchParams.get('code');

    if (!code) {
      res.writeHead(400);
      res.end('Missing authorization code.');
      return;
    }

    const { tokens } = await oauth2Client.getToken(code);

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
      <html><body style="font-family:sans-serif;padding:40px;max-width:600px">
        <h2 style="color:green">✓ Authorization successful!</h2>
        <p>You can close this window and return to your terminal.</p>
      </body></html>
    `);

    console.log('================================================');
    console.log('SUCCESS! Copy these values to your GitHub Secrets:');
    console.log('================================================\n');
    console.log('Secret name:  GMAIL_CLIENT_ID');
    console.log(`Secret value: ${CLIENT_ID}\n`);
    console.log('Secret name:  GMAIL_CLIENT_SECRET');
    console.log(`Secret value: ${CLIENT_SECRET}\n`);
    console.log('Secret name:  GMAIL_REFRESH_TOKEN');
    console.log(`Secret value: ${tokens.refresh_token}\n`);
    console.log('================================================');
    console.log('Add these at:');
    console.log('https://github.com/YOUR_USERNAME/YOUR_REPO/settings/secrets/actions');
    console.log('================================================\n');

    server.close();
  } catch (err) {
    console.error('Error getting token:', err.message);
    res.writeHead(500);
    res.end('Error: ' + err.message);
    server.close();
  }
});

server.listen(3000, () => {
  console.log('Local server ready on http://localhost:3000');
});
