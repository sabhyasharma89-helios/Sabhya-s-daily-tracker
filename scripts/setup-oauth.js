#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════
   setup-oauth.js — One-time Gmail OAuth2 Setup

   Run this locally once to generate your Gmail refresh token.
   Then add it (and your other credentials) as GitHub Secrets.

   Usage:
     GMAIL_CLIENT_ID=xxx GMAIL_CLIENT_SECRET=yyy node setup-oauth.js
   ══════════════════════════════════════════════════════════════════ */

'use strict';

const { google } = require('googleapis');
const readline   = require('readline');
const http       = require('http');
const url        = require('url');

const CLIENT_ID     = process.env.GMAIL_CLIENT_ID;
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;
const REDIRECT_URI  = 'http://localhost:3999/oauth2callback';
const SCOPES        = ['https://www.googleapis.com/auth/gmail.readonly'];

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error(`
ERROR: Missing credentials.

Set these environment variables before running:
  GMAIL_CLIENT_ID=your_client_id
  GMAIL_CLIENT_SECRET=your_client_secret

How to get them:
  1. Go to https://console.cloud.google.com
  2. Create a new project (or select existing)
  3. Enable the Gmail API
  4. Go to APIs & Services → Credentials
  5. Create OAuth 2.0 Client ID → Desktop App
  6. Download the credentials JSON
`);
  process.exit(1);
}

async function main() {
  const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });

  console.log('\n══════════════════════════════════════════════');
  console.log('  Sabhya\'s Tracker — Gmail OAuth2 Setup');
  console.log('══════════════════════════════════════════════\n');
  console.log('Step 1: Open this URL in your browser:\n');
  console.log(' ', authUrl);
  console.log('\nStep 2: Sign in with your Gmail account and grant access.');
  console.log('\nWaiting for OAuth callback on http://localhost:3999...\n');

  // Start a local server to catch the redirect
  const code = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const params = new url.URL(req.url, 'http://localhost:3999').searchParams;
      const code   = params.get('code');
      const error  = params.get('error');

      res.writeHead(200, { 'Content-Type': 'text/html' });
      if (code) {
        res.end('<html><body style="font-family:sans-serif;padding:40px"><h2>✓ Authorised!</h2><p>You can close this tab and return to the terminal.</p></body></html>');
        server.close();
        resolve(code);
      } else {
        res.end(`<html><body><h2>Error: ${error}</h2></body></html>`);
        server.close();
        reject(new Error(error || 'No code received'));
      }
    });

    server.listen(3999);
    server.on('error', reject);
  });

  const { tokens } = await oauth2Client.getToken(code);

  console.log('\n══════════════════════════════════════════════');
  console.log('  SUCCESS! Add these as GitHub Secrets:');
  console.log('══════════════════════════════════════════════\n');
  console.log('Go to: Your GitHub repo → Settings → Secrets → Actions\n');
  console.log(`GMAIL_CLIENT_ID     = ${CLIENT_ID}`);
  console.log(`GMAIL_CLIENT_SECRET = ${CLIENT_SECRET}`);
  console.log(`GMAIL_REFRESH_TOKEN = ${tokens.refresh_token}`);
  console.log('\nAlso add:');
  console.log('ANTHROPIC_API_KEY   = your_claude_api_key_from_console.anthropic.com');
  console.log('\n══════════════════════════════════════════════\n');
}

main().catch(console.error);
