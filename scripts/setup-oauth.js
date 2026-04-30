/**
 * One-time OAuth setup script.
 * Run locally with: node scripts/setup-oauth.js
 * This generates the GMAIL_REFRESH_TOKEN you need to add to GitHub Secrets.
 */

'use strict';

const { google } = require('googleapis');
const readline = require('readline');

const CLIENT_ID     = process.env.GMAIL_CLIENT_ID     || '';
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET || '';

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('\nMissing GMAIL_CLIENT_ID or GMAIL_CLIENT_SECRET environment variables.');
  console.error('Set them before running this script:');
  console.error('  export GMAIL_CLIENT_ID=your_client_id');
  console.error('  export GMAIL_CLIENT_SECRET=your_client_secret');
  console.error('  node scripts/setup-oauth.js\n');
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  'urn:ietf:wg:oauth:2.0:oob'
);

const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: SCOPES,
  prompt: 'consent'
});

console.log('\n=== Gmail OAuth Setup ===\n');
console.log('1. Open this URL in your browser:\n');
console.log(authUrl);
console.log('\n2. Authorize the application and copy the authorization code.\n');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

rl.question('3. Paste the authorization code here: ', async (code) => {
  rl.close();
  try {
    const { tokens } = await oauth2Client.getToken(code.trim());
    console.log('\n=== SUCCESS ===');
    console.log('\nAdd the following secrets to your GitHub repository');
    console.log('(Settings → Secrets and variables → Actions → New repository secret):\n');
    console.log(`GMAIL_CLIENT_ID      = ${CLIENT_ID}`);
    console.log(`GMAIL_CLIENT_SECRET  = ${CLIENT_SECRET}`);
    console.log(`GMAIL_REFRESH_TOKEN  = ${tokens.refresh_token}`);
    console.log('\nKeep these values secure and never commit them to the repository.\n');
  } catch (err) {
    console.error('\nFailed to exchange code for tokens:', err.message);
    process.exit(1);
  }
});
